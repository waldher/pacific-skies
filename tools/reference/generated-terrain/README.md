# Generated terrain source archive

The original generated `assets/terrain/grass-soil-v1.png` is preserved byte-for-byte
as eight raw binary parts because the publication connector stalled on its single
4 MB payload. This is an archival packaging change only. Candidate 6 runtime loads
`assets/terrain/grass-soil-v1.webp`; no JavaScript or loaded asset changes here.

Run `python tools/reference/generated-terrain/reconstruct.py` from any directory to
restore the exact original path, or pass `--output /some/path.png`. The script checks
all part lengths/hashes and the reconstructed SHA-256 before writing. `manifest.json`
records the original path, byte count, SHA-256 and part order. Existing different
files are never overwritten.

Historical screenshots and reports remain unchanged. Their source hashes included
the original PNG. On this packaging commit, reconstructing that PNG restores the
historical runtime/assets tree and source hash; this archive lives outside the
source-hash helper's inputs. The checked-in packaging state has a different source
hash until reconstruction. No historical evidence hash has been rewritten, and this
checkpoint does not pass acceptance or claim reference superiority.

Generation prompt/provenance remains in `assets/terrain/README.md`. The packaging
base is local commit `93ae2bfa77137bb31e44648afde9db33061658e7`.
