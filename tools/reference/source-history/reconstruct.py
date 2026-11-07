#!/usr/bin/env python3
"""Verify or reconstruct an exact captured Pacific Skies source tree."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

BASE = Path(__file__).resolve().parent
REPO = BASE.parents[2]
ROOTS = ["src", "assets", "vendor", "index.html"]
CACHE = {}


def safe_path(relative):
    path = (REPO / relative).resolve()
    if not path.is_relative_to(REPO):
        raise ValueError("Archive path escapes repository")
    return path


def read_entry(entry):
    sha = entry["gitBlobSha"]
    if sha in CACHE:
        return CACHE[sha]
    storage = entry["storage"]
    if storage["kind"] == "git-object":
        result = subprocess.run(["git", "-C", str(REPO), "cat-file", "blob", sha],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            data = result.stdout
        else:
            current = safe_path(entry["path"])
            if not current.is_file():
                raise RuntimeError("Missing published Git object " + sha +
                                   "; fetch commit " + storage["reachableFrom"] +
                                   " in a full repository clone.")
            data = current.read_bytes()
    elif storage["kind"] == "file":
        data = safe_path(storage["file"]).read_bytes()
    elif storage["kind"] == "parts":
        manifest_path = safe_path(storage["manifest"])
        manifest = json.loads(manifest_path.read_text())
        pieces = []
        for part in manifest["parts"]:
            piece = (manifest_path.parent / part["file"]).read_bytes()
            if len(piece) != part["bytes"] or hashlib.sha256(piece).hexdigest() != part["sha256"]:
                raise ValueError("Archive part integrity failure: " + part["file"])
            pieces.append(piece)
        data = b"".join(pieces)
    else:
        raise ValueError("Unknown storage type")
    git_sha = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"] or git_sha != sha:
        raise ValueError("Source integrity failure: " + entry["path"] +
                         "; a shallow clone may need the published object anchor fetched.")
    CACHE[sha] = data
    return data


def verify(name, record, output=None):
    manifest_path = safe_path(record["manifest"])
    if hashlib.sha256(manifest_path.read_bytes()).hexdigest() != record["manifestSha256"]:
        raise ValueError("Manifest integrity failure: " + name)
    manifest = json.loads(manifest_path.read_text())
    files = {entry["path"]: entry for entry in manifest["files"]}
    digest = hashlib.sha256()
    for root in ROOTS:
        for path in sorted(p for p in files if p == root or p.startswith(root + "/")):
            data = read_entry(files[path])
            digest.update(path.encode() + b"\0" + data + b"\0")
    if digest.hexdigest() != record["sourceHash"] or digest.hexdigest() != manifest["sourceHash"]:
        raise ValueError("Aggregate sourceHash mismatch: " + name)
    if output is not None:
        output = output.resolve()
        if output.exists() and any(output.iterdir()):
            raise ValueError("Output directory must be absent or empty")
        output.mkdir(parents=True, exist_ok=True)
        for path, entry in files.items():
            target = (output / path).resolve()
            if not target.is_relative_to(output):
                raise ValueError("Source path escapes output")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(read_entry(entry))
    print(name + " " + digest.hexdigest() + (" reconstructed" if output else " verified"))


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("snapshot", nargs="?")
parser.add_argument("--output", type=Path, help="Absent or empty destination; source tree only")
parser.add_argument("--verify-all", action="store_true", help="Verify all retained source manifests without writing")
args = parser.parse_args()
index = json.loads((BASE / "index.json").read_text())
if args.verify_all:
    if args.output or args.snapshot:
        parser.error("--verify-all cannot be combined with a snapshot/output")
    for name, record in index["snapshots"].items():
        verify(name, record)
else:
    if args.snapshot not in index["snapshots"]:
        parser.error("Choose a retained snapshot from index.json; unresolved states cannot be reconstructed")
    verify(args.snapshot, index["snapshots"][args.snapshot], args.output)
