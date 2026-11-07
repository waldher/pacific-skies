// Shallow oblique relief for static scenery. Ground-plane XY stays unchanged;
// raised walls/roofs reveal their sides without tilting the flight/control plane.
// Lighting remains physical world-space lighting; only projected position changes.
export function withRelief(material, groundHeight = 8.5) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      float reliefHeight = max(0.0, (modelMatrix * vec4(transformed, 1.0)).y - ${Number(groundHeight).toFixed(3)});
      mvPosition.xy += vec2(0.28, 0.48) * reliefHeight;
      gl_Position = projectionMatrix * mvPosition;
    `);
  };
  material.customProgramCacheKey = () => 'static-relief-v1-' + groundHeight;
  return material;
}
