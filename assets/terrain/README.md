# Terrain diffuse material

The generated `grass-soil-v1` diffuse/albedo material is **not a game
screenshot, background scene, or substitute for rendered benchmark evidence**.

- Generated with the built-in `image_gen` tool on 2026-11-06.
- Source output: `exec-4047ec27-f600-443c-bb3a-4c753372b1b6.png`.
- Original: 1254 × 1254, RGB PNG (~3.9 MB), archived losslessly in `tools/reference/generated-terrain/`.
- Intended source scale: 40 × 40 metres; candidate6 tiles at 240 world units
  to preserve visible material structure at the phone capture scale.
- Inspected: muted grass/straw/soil, flat top-down diffuse view; no buildings,
  people, trees, rocks, roads, UI or text. Seamless tiling is requested, but
  candidate screenshot inspection must check visible repetition/seams.

`preloadTerrainMaterial()` in `src/land.js` optionally loads this image before
chunk construction. An error or 2.5-second timeout selects the procedural
fallback for the whole session. The material is composited with biome tint into
the existing bounded terrain bake; fields, coast detail and baked shadows are
painted afterwards. No additional per-frame sampler taps or materials result.
Runtime uses `grass-soil-v1.webp`: 768 × 768, quality 84, 149,756 bytes
(about 96% smaller than the PNG), roughly 2.25 MiB decoded CPU memory.
The original PNG is retained as lossless archival chunks, not requested by the game.
For historical source audits, run `python tools/reference/generated-terrain/reconstruct.py --output assets/terrain/grass-soil-v1.png`; normal runtime needs only the WebP.
Source SHA-256: `94f983033befc90b59854d377adbc1803e395eb35af6465d5456b12850592c15`.
Production conversion: ImageMagick resize to 768 × 768, WebP quality 84.

## Generation prompt

Use case: photorealistic-natural. Asset type: actual tileable game terrain
diffuse/albedo material, not a game screenshot or concept scene. Generate one
square seamless top-down orthographic aerial texture representing a 40 metre by
40 metre patch of temperate coastal grass and worn earth. Muted olive-green short
grass, interwoven small areas of dry straw, thin brown-grey exposed soil and
natural worn patches. Authentic fine-scale natural ground variation with clear
material structure, medium-low contrast, restrained desaturated colors. Flat
uniform diffuse illumination suitable for relighting by a game engine; no baked
directional lighting, no cast shadows, no specular highlights, no vignette.
Texture fills every pixel edge-to-edge and all four edges should tile seamlessly.
No trees, bushes, rocks, stones, roads, paths, tracks, buildings, water, people,
objects, text, UI, labels or borders. High-detail albedo only; perfectly
perpendicular top view, no horizon or perspective.
