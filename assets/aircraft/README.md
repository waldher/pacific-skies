# Aircraft

Original procedurally modeled, stylized aircraft created for this project:

- `F4U_Corsair.glb`: inverted gull wings, navy finish, US markings; 1,991 triangles.
- `Mitsubishi_Zero.glb`: rounded wings, light finish, red roundels; 1,919 triangles.

These are approximations for an arcade game, not exact historical replicas.
GLB / glTF 2.0; +Y up, nose -Z. Embedded PBR materials, no external textures.
The `Airframe` and `Propeller` nodes are required by `src/aircraft.js`.
Propeller pivots are at the nose, allowing animation about local Z.

The loader merges static parts by material once, keeps the propeller separate,
and shares geometry across enemies. Both aircraft are scaled to the original
48-world-unit wingspan; physics and hitboxes remain in the existing XY plane.
Models fly at a visual height of 32 units in Three.js's XZ plane.
