// Batched 3D tracers and particles. Buffers grow only when needed, not per frame.
import * as THREE from 'three';
import { CONFIG } from './config.js';

// Small deterministic sprite atlas baked once on the CPU. Billowing silhouettes
// and directional smoke shading cost one texture tap per particle pixel, with
// no per-pixel noise or extra particle passes on mobile GPUs.
let particleAtlas;
let coloredAtlas = false;
let atlasReady;
export function preloadEffectAtlas() {
  if (atlasReady) return atlasReady;
  atlasReady = new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => { done = true; resolve(false); }, 2500);
    new THREE.TextureLoader().load(new URL('../assets/effects/effects-atlas-512.webp', import.meta.url).href, texture => {
      if (done) { texture.dispose(); return; }
      done = true; clearTimeout(timer);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      particleAtlas = texture; coloredAtlas = true; resolve(true);
    }, undefined, () => { if (!done) { done = true; clearTimeout(timer); resolve(false); } });
  });
  return atlasReady;
}
function effectAtlas() {
  if (particleAtlas) return particleAtlas;
  const tile = 64, width = tile * 2, data = new Uint8Array(width * width * 4);
  const clamp01 = n => Math.max(0, Math.min(1, n));
  const smooth = (a, b, n) => { const t = clamp01((n-a)/(b-a)); return t*t*(3-2*t); };
  const cloud = (x,y) => {
    let sum=0;
    for (const [cx,cy,r,w] of [[-.25,-.08,.46,1],[.15,-.22,.42,.9],[.25,.19,.43,.8],[-.18,.31,.38,.7],[0,0,.54,.5]]) {
      const d=Math.hypot(x-cx,y-cy)/r;
      sum += (1-smooth(.1,1,d))*w;
    }
    return clamp01(sum*.62);
  };
  for(let kind=0;kind<4;kind++) for(let y=0;y<tile;y++) for(let x=0;x<tile;x++) {
    const u=(x+.5)/tile*2-1,v=(y+.5)/tile*2-1,r=Math.hypot(u,v);
    let alpha,light=1;
    if(kind===2) {
      alpha=cloud(u,v)*(1-smooth(.8,.98,r));
      // Light comes from the same upper-left direction as the world sun.
      light=.58+.34*clamp01(.5+(cloud(u+.08,v+.08)-cloud(u-.08,v-.08))*2);
    } else if(kind===1) {
      // A broken pressure front supports the hot core without reading as a
      // target-selection circle. All irregularity is baked, never animated noise.
      const angle=Math.atan2(v,u);
      const edge=r+.025*Math.sin(angle*7)+.018*Math.sin(angle*13);
      alpha=(1-smooth(.83,.97,edge))*smooth(.72,.83,edge);
      alpha*=.35+.65*smooth(-.7,.8,Math.sin(angle*5+.4));
    } else if(kind===3) {
      alpha=(1-smooth(.84,.98,r))*smooth(.66,.82,r);
      alpha*=.5+.5*smooth(-.25,.8,Math.sin(u*19+v*11)*Math.sin(v*23-u*8));
    } else {
      const core=1-smooth(0,.28,r);
      const halo=(1-smooth(.12,.9,r))*.28;
      alpha=clamp01(core+halo);
      light=core;
    }
    const o=(((kind>>1)*tile+y)*width+(kind%2)*tile+x)*4;
    data[o]=data[o+1]=data[o+2]=Math.round(light*255);data[o+3]=Math.round(alpha*255);
  }
  particleAtlas=new THREE.DataTexture(data,width,width,THREE.RGBAFormat);
  particleAtlas.magFilter=THREE.LinearFilter;particleAtlas.minFilter=THREE.LinearFilter;
  particleAtlas.generateMipmaps=false;particleAtlas.needsUpdate=true;
  return particleAtlas;
}

export function createEffects(scene, renderer) {
  const tracerMaterial = new THREE.MeshBasicMaterial({ color: 'white' });
  const tracerGeometry = new THREE.BoxGeometry(1, 1, 1);
  let tracers, capacity = 0;
  const dummy = new THREE.Object3D();
  const ally = new THREE.Color('#ffe28a'), enemy = new THREE.Color('#ff7b6b');
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(400 * 3);
  const sizes = new Float32Array(400);
  const colors = new Float32Array(400 * 4);
  const rings = new Float32Array(400);
  const trails = new Float32Array(400 * 2);
  for (const [name, array, size] of [['position', positions, 3], ['size', sizes, 1], ['color', colors, 4], ['ring', rings, 1], ['trail', trails, 2]]) {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
  }
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { dpr: { value: 1 }, atlas: { value: effectAtlas() }, colored: { value: coloredAtlas ? 1 : 0 } },
    vertexShader: `attribute float size; attribute vec4 color; attribute float ring; attribute vec2 trail;
      varying vec2 trailShape;
      varying vec4 tint; varying float spriteKind; uniform float dpr;
      void main() {
        tint = color; spriteKind = ring; trailShape = trail;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * dpr;
      }`,
    fragmentShader: `varying vec2 trailShape; varying vec4 tint; varying float spriteKind; uniform sampler2D atlas; uniform float colored;
      void main() {
        vec2 tile=vec2(mod(spriteKind,2.0),floor(spriteKind*.5));
        vec2 coord=gl_PointCoord;
        if(trailShape.y>1.01) {
          float c=cos(trailShape.x),s=sin(trailShape.x);
          vec2 q=mat2(c,-s,s,c)*(coord-.5);
          q.y*=trailShape.y;
          coord=q+.5;
          if(any(lessThan(coord,vec2(0.0)))||any(greaterThan(coord,vec2(1.0)))) discard;
        }
        vec4 sprite=texture2D(atlas,(tile+coord)*.5);
        float alpha=tint.a*sprite.a;
        if(alpha<.01) discard;
        vec3 color=tint.rgb;
        if(colored>.5) {
          color=sprite.rgb*tint.rgb;
          if(spriteKind<.5) color*=1.4;
        } else if(spriteKind<.5) color=mix(tint.rgb,vec3(2.6,1.8,.9),sprite.r);
        else if(spriteKind>1.5 && spriteKind<2.5) color*=sprite.rgb;
        gl_FragColor=vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const particles = new THREE.Points(geometry, material);
  particles.frustumCulled = false;
  scene.add(particles);
  return {
    update(game) {
      const count = game.bullets.length + game.ebullets.length + game.torpedoes.length;
      if (count > capacity) {
        if (tracers) { scene.remove(tracers); tracers.dispose(); }
        capacity = Math.max(64, 2 ** Math.ceil(Math.log2(count)));
        tracers = new THREE.InstancedMesh(tracerGeometry, tracerMaterial, capacity);
        tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        tracers.frustumCulled = false;
        scene.add(tracers);
      }
      if (tracers) {
        let i = 0;
        for (const [bullets, color] of [[game.bullets, ally], [game.ebullets, enemy], [game.torpedoes, ally]]) {
          for (const b of bullets) {
            dummy.position.set(b.x - b.vx * .008, b.distance !== undefined ? 2 : (b.renderAltitude ?? b.altitude ?? CONFIG.render.flightHeight - 1), b.y - b.vy * .008);
            dummy.rotation.set(0, -Math.atan2(b.vy, b.vx), 0);
            dummy.scale.set(b.distance !== undefined ? 24 : Math.hypot(b.vx, b.vy) * .016, 1, b.distance !== undefined ? 4 : 2.5);
            dummy.updateMatrix();
            tracers.setMatrixAt(i, dummy.matrix); tracers.setColorAt(i++, color);
          }
        }
        tracers.count = count;
        tracers.instanceMatrix.needsUpdate = true;
        if (tracers.instanceColor) tracers.instanceColor.needsUpdate = true;
      }
      const n = Math.min(400, game.particles.length);
      for (let i = 0; i < n; i++) {
        const p = game.particles[i], t = p.life / p.max;
        const splash = p.kind === 'splash';
        const trail = p.kind === 'smoke' && Number.isFinite(p.trailAngle);
        trails.set([p.trailAngle || 0, trail ? 1.8 : 1], i * 2);
        positions.set([p.x, p.altitude ?? (splash ? 1.5 : CONFIG.render.flightHeight), p.y], i * 3);
        rings[i] = splash ? 3 : p.kind === 'ring' ? 1 : p.kind === 'smoke' ? 2 : 0;
        sizes[i] = 2 * p.size * (splash ? 1.8 - t : p.kind === 'ring' ? 1.6 - t : p.kind === 'smoke' ? (2 - t) * 1.45 : t + .4);
        if (trail) sizes[i] *= 1.8;
        if (p.kind === 'smoke') colors.set(coloredAtlas ? [.8, .84, .88, t * .3] : [.31, .33, .35, t * .65], i * 4);
        else if (splash) colors.set([.85, .95, 1, t * .8], i * 4);
        else if (p.kind === 'ring') colors.set([1, .7, .35, t * t * .32], i * 4);
        else colors.set(coloredAtlas ? [1, 1, 1, Math.min(1,t*1.8)] : [1, .3 + t * .45, .08, t], i * 4);
      }
      geometry.setDrawRange(0, n);
      for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
      material.uniforms.dpr.value = renderer.getPixelRatio();
    },
  };
}
