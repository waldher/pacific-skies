# Follow-up diagnostics

One 60-sample paired fleet shader trial preserved every decoded RGB pixel across all ten fixed scenes. The same-suite fallback fleet p50 fell 6.2 to 5.5 ms and p95 fell 15.1 to 8.6 ms. This is an exploratory pair with a slow control tail, so it does not establish repeatable savings or pass the matched performance gate. The original matched fallback fleet baseline was 5.6 ms p95. Other scene results are mixed. No separate new still rating is inferred from identical pixels.

The RAF/compositor diagnostic ran against exact combined runtime 3c87e6492c91 in the native profile. Artifact hashes verified and capture errors are empty. The additional observer recorded 165 callbacks with a maximum 571 ms gap, while the longest compositor gap was 555 ms. Both observers show timing interruptions in this run. The measurements do not isolate renderer work or prove handset display drops. Continuous video and human listening gates remain open.
