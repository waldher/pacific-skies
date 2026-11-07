#!/usr/bin/env python3
"""Restore the exact generated source PNG; runtime uses the smaller WebP."""
import argparse
import hashlib
import json
from pathlib import Path

base = Path(__file__).resolve().parent
manifest = json.loads((base / "manifest.json").read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, default=base.parents[2] / manifest["originalPath"])
args = parser.parse_args()
parts = []
for item in manifest["parts"]:
    data = (base / item["file"]).read_bytes()
    if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
        raise SystemExit("Part integrity failure: " + item["file"])
    parts.append(data)
data = b"".join(parts)
if len(data) != manifest["originalBytes"] or hashlib.sha256(data).hexdigest() != manifest["originalSha256"]:
    raise SystemExit("Reconstructed source integrity failure")
if args.output.exists() and args.output.read_bytes() != data:
    raise SystemExit("Refusing to overwrite a different existing file: " + str(args.output))
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_bytes(data)
print(str(args.output) + " SHA-256 " + manifest["originalSha256"])
