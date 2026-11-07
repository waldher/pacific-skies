# Naval surface atlas

`naval-surfaces.png` is a deterministic, code-authored 512×512 RGBA8 scalar
albedo modulation atlas. Regenerate from the repository root:

```sh
python tools/build-surface-atlas.py
```

Tiles are 128×128 with eight-pixel extruded gutters: wood, roof sheets,
concrete, asphalt and steel. Remaining tiles are pure white. Markings,
glazing and untextured details use the center of the bottom-right white tile.
Values are linear multipliers, so the texture uses `NoColorSpace`, not sRGB.
Existing vertex colors and Lambert illumination supply the surface colors.

One texture is shared by the existing naval and installation batches. Mipmaps
bring its decoded memory to approximately 1.33 MiB; there are no extra material
batches or draw calls. Loading has a 2.5-second deadline; failure retains vertex
colors. `graphics.naval.materialMode` reports whether the atlas loaded.

The three service buildings keep the original three damage slots, anchors and
maximum footprint. Their silhouettes distinguish maintenance, operations and
stores; hit detection and building-collapse scaling are unchanged.
