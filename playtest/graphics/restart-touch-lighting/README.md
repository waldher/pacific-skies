# Touch lighting experiment after workspace recovery

The recovered candidate 17 source is the exact `candidate-17` snapshot in `tools/reference/source-history`. This directory preserves a proposed patch and its restored fixed-scene capture harness. Apply the patch from the reconstructed runtime root with `git apply`. Copy the harness into `playtest/graphics.cjs` in an isolated test checkout with the repository's capture dependencies and helpers.

The patch disables PMREM environment lighting on coarse-pointer devices while retaining direct and hemisphere lighting and the desktop environment. This checkpoint predates review and performance acceptance. The PR's active runtime remains candidate 14. No evidence from the lost candidate 18 is attributed to this new experiment.
