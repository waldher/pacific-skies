# Restart checkpoint

Three same-model-family agent judges independently viewed all 45 randomized stills and 36 sampled motion frames each. Mean weighted visual scores were 7.416, 7.263, and 7.400 for both recovered candidate 17 and touch lighting. The same panel gave the frozen reference set means of 8.720, 8.460, and 8.535. The challenger does not pass the visual gate. Motion passed the sampled checks with visible wake, shoreline, and HUD caveats.

Provisional 60-sample SwiftShader runs lowered native stress p95 from 46.5 to 27.6 ms versus candidate 17. The original baseline ran that scene at 24.5 ms. These runs do not establish phone FPS or pass the matched performance gate. The PNGs are not included in this checkpoint; their hashes, reports, identity mapping, and raw ratings are retained.

The next experimental patch, `ocean-ripple-resume/ocean-candidate.patch`, applies after `renderer.patch` and includes the exact small runtime texture as a binary diff. The generated source image is not included here. Candidate 17 remains pinned at the private preview. This PR keeps candidate 14 as the active source tree.