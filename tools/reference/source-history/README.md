# Exact captured source history

The public PR uses checkpoint commits, so local experiment commit IDs alone would
not preserve every earlier code version. This archive retains exact source trees
by content hash without duplicating large unchanged assets in each round.

`index.json` identifies snapshots, their manifests and unresolved states. Each
manifest lists every file in the original `sourceHash` scope (`src`, `assets`,
`vendor`, `index.html`) with byte count, Git blob SHA and SHA-256. Historical bytes
not already reachable from published commit
`59802ea25474edbe4943507ddd414607b0541227` are kept once under `objects/`.
The original generated terrain PNG is restored from its existing verified parts.
Unchanged published objects are read from Git, or from a matching working-tree file.
Use a full clone; a shallow checkout may need that published commit fetched first.

```sh
python tools/reference/source-history/reconstruct.py --verify-all
python tools/reference/source-history/reconstruct.py candidate-14 --output /tmp/pacific-candidate14
```

Every file is verified before the aggregate source hash is checked. Reconstruction
requires an absent or empty output directory and writes the original source/assets
only, without mutating the current checkout. The captured harness suite hash and
capture-report hash are recorded, but this is not a replacement for installing the
correct test harness/dependencies or a guarantee of identical GPU output on a
different browser/device.

The original baseline and candidate 1 include their manual-frame instrumentation.
The candidate-1 worktree's exact bytes are archived even though no standalone local
source commit identified that state. Historical report/source hashes are unchanged.

Two dirty intermediate states could not be matched exactly: candidate 3 and the
early provisional transit probe. They remain explicitly unresolved in `index.json`;
no exact reconstruction claim is made for them. Their screenshots/reviews/reports
remain preserved. This limitation does not turn any failed gate into acceptance.
