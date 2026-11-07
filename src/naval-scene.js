// Low-poly ship meshes, airfields and installations, built once and reused.
//
// Every static part is merged into one vertex-coloured mesh per object, so a
// carrier is one draw call instead of thirty. Only parts that move or change
// state stay separate: turrets and radar dishes rotate, hangars collapse as
// an airfield takes damage, beacons and flags recolour with ownership.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { withRelief } from './projection.js';
import { noiseTexture, NOISE_GLSL } from './noise.js';
import { shipObserved, installationKnown, observedAt } from './intelligence.js';

const paint = withRelief(new THREE.MeshLambertMaterial({ vertexColors: true }));
// Keep the accepted matte Lambert palette; depth comes from directional
// self-occlusion rather than brighter rims or additional specular response.
// Conservative local-space bounds of existing opaque superstructure, not new
// collision geometry. Exactly three analytic occluders per vessel material.
const CARRIER_OCCLUDERS = [
  [[23.5,11,-35],[36.5,25,7]],
  [[22,26,-31.5],[38,32.8,-12.5]],
  [[27,25,-7],[35,33.4,3]],
];
const DESTROYER_OCCLUDERS = [
  [[-8.5,10,-24],[8.5,22,4]],
  [[-10,20,-23.5],[10,26.8,-8.5]],
  [[-4,13.5,3],[4,24.8,27]],
];
function navalMaterial(occluders = []) {
  const material = new THREE.MeshLambertMaterial({vertexColors:true});
  const vec = values => `vec3(${values.map(v=>Number(v).toFixed(4)).join(',')})`;
  const sun = vec(new THREE.Vector3(...CONFIG.render.sunOffset).normalize().toArray());
  const calls = occluders.map(([lo,hi])=>`shipOcclusion=max(shipOcclusion,shipBoxOcclusion(vShipPosition,localSun,${vec(lo)},${vec(hi)}));`).join('\n');
  material.onBeforeCompile = shader => {
    if(occluders.length) {
      const varyings='varying vec3 vShipPosition; varying vec3 vShipSun;\n';
      shader.vertexShader=varyings+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vShipPosition=transformed;
        // Inverse rotation/scale: fixed world sun stays correct as each vessel
        // turns or sinks. No per-vessel uniforms, uploads or material clones.
        vec3 shipWorldSun=${sun};
        vShipSun=vec3(dot(modelMatrix[0].xyz,shipWorldSun)/dot(modelMatrix[0].xyz,modelMatrix[0].xyz),
          dot(modelMatrix[1].xyz,shipWorldSun)/dot(modelMatrix[1].xyz,modelMatrix[1].xyz),
          dot(modelMatrix[2].xyz,shipWorldSun)/dot(modelMatrix[2].xyz,modelMatrix[2].xyz));`);
      shader.fragmentShader=varyings+`
        float shipBoxOcclusion(vec3 p, vec3 d, vec3 lo, vec3 hi) {
          // A receiver on/inside its own conservative box must never shadow
          // itself. Other boxes can still shadow that receiver normally.
          if(all(greaterThanEqual(p,lo-vec3(.06))) && all(lessThanEqual(p,hi+vec3(.06))))return 0.0;
          vec3 safeD=(step(vec3(0.0),d)*2.0-1.0)*max(abs(d),vec3(.00001));
          vec3 a=(lo-p)/safeD,b=(hi-p)/safeD;
          vec3 nearT=min(a,b),farT=max(a,b);
          float entry=max(max(nearT.x,nearT.y),nearT.z);
          float leave=min(min(farT.x,farT.y),farT.z);
          if(entry<=.06 || leave<=entry)return 0.0;
          // Finite intersection depth gives a narrow, distance-growing edge
          // transition rather than an opaque projected rectangle.
          return smoothstep(0.0,max(.6,entry*.045),leave-entry);
        }
      `+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float shipOcclusion=0.0;
        if(vShipPosition.y<34.0) {
          vec3 localSun=normalize(vShipSun);
          ${calls}
        }
        reflectedLight.directDiffuse*=1.0-.82*shipOcclusion;
        // Retain sky fill; only slight contact attenuation of indirect light.
        reflectedLight.indirectDiffuse*=1.0-.08*shipOcclusion;`);
    }
  };
  material.customProgramCacheKey=()=> 'naval-shadow-v1-'+JSON.stringify(occluders);
  return material;
}
const shipPaint=navalMaterial(), carrierPaint=navalMaterial(CARRIER_OCCLUDERS), destroyerPaint=navalMaterial(DESTROYER_OCCLUDERS);
const solid = hex => new THREE.MeshLambertMaterial({ color: hex });
const hangarMat = paint, rubbleMat = withRelief(solid('#343534')), dark = solid('#263743'), cabin = withRelief(solid('#839296'));
const friend = new THREE.MeshBasicMaterial({ color: '#62ddba' });
const hostile = new THREE.MeshBasicMaterial({ color: '#ee7964' });
// A single linear modulation atlas, shared by existing merged batches. White
// tiles preserve the original vertex colors on untextured markings/details.
const SURFACE_TILES={wood:0,roof:1,concrete:2,asphalt:3,steel:4};
let surfaceReady, surfaceMode='vertex-color-fallback';
export function preloadNavalMaterials() {
  if(surfaceReady)return surfaceReady;
  surfaceReady=new Promise(resolve=>{
    let done=false;
    const timer=setTimeout(()=>{done=true;resolve(false);},2500);
    new THREE.TextureLoader().load(new URL('../assets/materials/naval-surfaces.png',import.meta.url).href,texture=>{
      if(done){texture.dispose();return;}
      done=true;clearTimeout(timer);
      texture.colorSpace=THREE.NoColorSpace; // scalar linear albedo modulation
      texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
      texture.generateMipmaps=true;
      for(const material of [paint,shipPaint,carrierPaint,destroyerPaint]){material.map=texture;material.needsUpdate=true;}
      surfaceMode='single-atlas-linear-512';resolve(true);
    },undefined,()=>{if(!done){done=true;clearTimeout(timer);resolve(false);}});
  });
  return surfaceReady;
}
function surfaceUV(geometry, tile) {
  const pos=geometry.attributes.position,normals=geometry.attributes.normal,uv=new Float32Array(pos.count*2);
  geometry.computeBoundingBox();const lo=geometry.boundingBox.min,hi=geometry.boundingBox.max;
  const index=SURFACE_TILES[tile];
  for(let i=0;i<pos.count;i++) {
    if(index===undefined){uv[i*2]=.875;uv[i*2+1]=.125;continue;}
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
    let u,v;
    if(tile==='wood'){u=x/CONFIG.carrier.width+.5;v=z/CONFIG.carrier.length+.5;}
    else {
      const nx=Math.abs(normals.getX(i)),ny=Math.abs(normals.getY(i)),nz=Math.abs(normals.getZ(i));
      if(ny>=nx&&ny>=nz){u=(x-lo.x)/Math.max(.001,hi.x-lo.x);v=(z-lo.z)/Math.max(.001,hi.z-lo.z);}
      else if(nx>nz){u=(z-lo.z)/Math.max(.001,hi.z-lo.z);v=(y-lo.y)/Math.max(.001,hi.y-lo.y);}
      else{u=(x-lo.x)/Math.max(.001,hi.x-lo.x);v=(y-lo.y)/Math.max(.001,hi.y-lo.y);}
    }
    u=Math.max(0,Math.min(1,u));v=Math.max(0,Math.min(1,v));
    uv[i*2]=((index%4)*128+8.5+u*111)/512;
    uv[i*2+1]=1-(Math.floor(index/4)*128+8.5+v*111)/512;
  }
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));return geometry;
}
// One surface draw carries both the thin hull-water contact shadow and the
// moving wake. One shared noise tap replaces periodic sine bands; no new
// texture allocation, shadow-map sampling or additional mesh pass.
const wakeMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { moving:{value:1}, time:{value:0}, noiseTex:{value:noiseTexture()} },
  vertexShader: `varying vec2 vUv;
    void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vUv;
uniform float moving,time;
${NOISE_GLSL}
void main() {
  float x=(vUv.x-.5)*1.45,z=(.5-vUv.y)*1.9+.2;
  float hullHalf;
  if(z<-.35)hullHalf=mix(0.0,.36,clamp((z+.5)/.15,0.0,1.0));
  else if(z<-.15)hullHalf=mix(.36,.45,(z+.35)/.20);
  else if(z<.43)hullHalf=.45;
  else hullHalf=mix(.45,.288,clamp((z-.43)/.07,0.0,1.0));
  float lateral=abs(x)-hullHalf;
  float hullLength=smoothstep(-.54,-.485,z)*(1.0-smoothstep(.49,.54,z));
  float contact=(1.0-smoothstep(-.01,.075,lateral))*hullLength*.35;
  // Shared noise's independent R/A fields supply non-repeating eddies and
  // shoulder breakup with ONE tap; no periodic sinusoids or train of puffs.
  vec4 churn=vnoise4(vec2(x*11.0+13.7,z*19.0-time*.95+7.3));
  float along=clamp((z-.44)/.68,0.0,1.0);
  float tail=1.0-smoothstep(.66,1.12,z);
  float start=smoothstep(.43,.52,z);
  float width=mix(.24,.43,along)+(churn.a-.5)*.05;
  float center=1.0-smoothstep(width*.25,width,abs(x));
  // A connected whitewater base never falls to zero between noise cells.
  float body=center*start*tail*(.31+.13*churn.r)*(1.0-.35*along);
  float stern=(1.0-smoothstep(.09,.24,abs(x)))*smoothstep(.44,.51,z)*(1.0-smoothstep(.53,.69,z))*.16;
  // Weak broad shoulders blend into the aerated trail, never bright rails.
  float shoulderAt=.25+along*.30+(churn.a-.5)*.035;
  float shoulder=1.0-smoothstep(.025,.09+along*.055,abs(abs(x)-shoulderAt));
  shoulder*=start*tail*(1.0-along)*(.025+.055*churn.a);
  float edge=smoothstep(-.01,.015,lateral)*(1.0-smoothstep(.015,.06,lateral))*hullLength;
  float bow=edge*(1.0-smoothstep(-.1,.35,z))*.20;
  float ripple=edge*(.018+.018*churn.r);
  float foam=ripple+moving*(body+stern+shoulder+bow);
  float alpha=contact+foam*(1.0-contact);
  if(alpha<.006)discard;
  vec3 color=mix(vec3(.015,.06,.065),vec3(.65,.85,.81),foam/max(alpha,.001));
  gl_FragColor=vec4(color,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,

});
const HULL = '#314453', DECK = '#6c7270', WOOD = '#8b8060', CABIN = '#839296', DARK = '#263743', WHITE = '#ece5bf';
const FRIEND = '#62ddba', HOSTILE = '#ee7964', RUNWAY = '#4d5753';

// Collects coloured parts and merges them into one geometry.
class Parts {
  constructor() { this.list = []; }
  add(geometry, hex, position = [0, 0, 0], rotation = null, tile = null) {
    const c = new THREE.Color(hex);
    if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    geometry.translate(...position);
    surfaceUV(geometry,tile);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.list.push(geometry.index ? geometry.toNonIndexed() : geometry);
    return this;
  }
  box(dimensions, position, hex, tile=null) { return this.add(new THREE.BoxGeometry(...dimensions), hex, position, null, tile); }
  // Chamfered steel catches the directional sun without a PBR fragment pass.
  // Kept inside the requested box bounds, including its bevel vertices.
  steelBox(dimensions, position, hex) {
    const [w,h,d]=dimensions,b=Math.min(.7,h*.22,w*.08,d*.08);
    const shape=new THREE.Shape();
    shape.moveTo(-w/2+b,-d/2+b);shape.lineTo(w/2-b,-d/2+b);
    shape.lineTo(w/2-b,d/2-b);shape.lineTo(-w/2+b,d/2-b);shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:h-2*b,bevelEnabled:true,
      bevelSegments:1,bevelSize:b,bevelThickness:b,steps:1});
    return this.add(g,hex,[position[0],position[1]-h/2+b,position[2]],[-Math.PI/2,0,0]);
  }
  // Opaque contact/deck detail is merged with its owner: no transparent pass.
  plane(width, depth, position, hex, tile=null) {
    return this.add(new THREE.PlaneGeometry(width, depth), hex, position, [-Math.PI / 2, 0, 0], tile);
  }
  cylinder(radius, height, position, hex, segments = 8) {
    return this.add(new THREE.CylinderGeometry(radius, radius, height, segments), hex, position);
  }
  polygon(points, height, hex) {
    const shape=new THREE.Shape(points.map(([x,z])=>new THREE.Vector2(x,-z)));
    return this.add(new THREE.ShapeGeometry(shape),hex,[0,height,0],[-Math.PI/2,0,0]);
  }
  // A baked tonal stain, feathered into a known solid pavement colour. Unlike
  // alpha decals this remains in the existing opaque vertex-colour batch.
  patch(width,depth,position,centerHex,edgeHex) {
    const g=new THREE.CircleGeometry(1,12).rotateX(-Math.PI/2);
    g.scale(width/2,1,depth/2); g.translate(...position);
    const center=new THREE.Color(centerHex),edge=new THREE.Color(edgeHex),colors=[];
    for(let i=0;i<g.attributes.position.count;i++)colors.push(...(i?edge:center).toArray());
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    surfaceUV(g,null);
    this.list.push(g.toNonIndexed());g.dispose();return this;
  }
  roof(width, depth, base, rise, position, hex, tile=null) {
    const shape = new THREE.Shape();
    shape.moveTo(-width/2, base); shape.lineTo(0, base+rise); shape.lineTo(width/2, base); shape.closePath();
    return this.add(new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled:false}), hex,
      [position[0],position[1],position[2]-depth/2],null,tile);
  }
  // CPU-baked panel variation complements the shared atlas without procedural
  // fragment noise. Vertex modulation changes every 14 world units
  // rather than subpixel speckle, preserving the low-resolution phone tier.
  panel(width,depth,position,hex,seed=1,tile='wood') {
    const segments=Math.max(1,Math.ceil(depth/14));
    const g=new THREE.PlaneGeometry(width,depth,1,segments).rotateX(-Math.PI/2);
    g.translate(...position);
    const base=new THREE.Color(hex),colors=[];
    for(let i=0;i<g.attributes.position.count;i++) {
      const row=Math.floor(i/2),noise=Math.sin(row*17.17+seed*9.31)*43758.5453;
      const factor=.965+(noise-Math.floor(noise))*.07+(i%2?-.012:.012);
      colors.push(base.r*factor,base.g*factor,base.b*factor);
    }
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));surfaceUV(g,tile);
    this.list.push(g.toNonIndexed());g.dispose();return this;
  }
  mesh(shadows = true, material = paint) {
    const geometry = mergeGeometries(this.list);
    for (const part of this.list) part.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    return mesh;
  }
}
function hullOutline(width, length, height, bevel = 0) {
  const shape = new THREE.Shape();
  [[0, length / 2], [width * .4, length * .35], [width / 2, length * .15],
    [width / 2, -length * .43], [width * .32, -length / 2], [-width * .32, -length / 2],
    [-width / 2, -length * .43], [-width / 2, length * .15], [-width * .4, length * .35]]
    .forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {depth:height,bevelEnabled:bevel>0,bevelSegments:1,bevelSize:bevel,bevelThickness:bevel*.4});
}
function shipTemplate(carrier, enemy = false) {
  const group = new THREE.Group();
  const length = carrier ? CONFIG.carrier.length : CONFIG.ship.length;
  const width = carrier ? CONFIG.carrier.width : CONFIG.ship.width;
  const parts = new Parts();
  // Dark sheer line and stepped deck edge separate hull, deck and sea even
  // without shadow maps. All silhouettes retain the physical hull dimensions.
  parts.add(hullOutline(width * .9, length, 8), '#233843', [0, 1, 0], [-Math.PI / 2, 0, 0]);
  // The bevel extends .28 above the extrusion; its upper face must stay
  // below the wood overlay at 11.18, or it occludes the bow and planking.
  parts.add(hullOutline(width, length * .95, 2, .7), '#43565b', [0, 8.7, 0], [-Math.PI / 2, 0, 0]);
  parts.add(hullOutline(width * .92, length * .925, .15), carrier ? '#807258' : DECK, [0, 11.03, 0], [-Math.PI / 2, 0, 0],carrier?'wood':'steel');
  const light = enemy ? HOSTILE : FRIEND;
  if (carrier) {
    // Broad panels read at 0.65x. Very fine texture would shimmer on a phone.
    for(let x=-24,i=0;x<=24;x+=8,i++) {
      parts.panel(7.6,122,[x,11.24,30],i%3===0?'#82745b':i%3===1?'#7c7058':'#807259',i+1);
    }
    parts.plane(39,166,[-3,11.28,7],'#6f6854');
    const grain=['#7d725c','#80745c','#7a705a','#7f735b'];
    for(let i=0;i<11;i++)parts.panel(3.35,165,[-20.3+i*3.5,11.30,7],grain[i%grain.length],i+13);
    // Broad scuffed touchdown band; feathered into its surrounding panel.
    parts.patch(20,55,[-3,11.32,55],'#686651','#7d725b');
    // Elevator outlines, inset panels and a narrow structural lip provide
    // depth from above without increasing the number of materials/draws.
    for(const z of [-52,51]) {
      parts.plane(20,22,[-17,11.34,z],'#2b3c3e');
      parts.plane(17.5,19.5,[-17,11.36,z-.7],'#777562');
      parts.plane(15.5,1.2,[-17,11.38,z+8.5],'#8c8972');
      for(const x of [-22,-17,-12])parts.plane(.65,15,[x,11.4,z],'#626454');
    }
    // Flight-deck markings have hierarchy: boundary, center, landing wires.
    for (let z = -84; z < 93; z += 24) parts.plane(1.5,10,[-3,11.5,z],'#d4d0ae');
    for (const x of [-25, 20]) parts.plane(.9,156,[x,11.5,4],'#c8c5a4');
    for (const z of [56, 64, 72]) {
      parts.plane(42,1.2,[-2,11.55,z],'#263b3e');
      parts.plane(42,.45,[-2,11.56,z-.7],'#b5b5a1');
    }
    for (const x of [-18,-12,-6,6,12,18]) parts.plane(2.5,10,[x,11.5,-78],'#ded7b8');
    // Island contact shadow/overhangs are geometric tonal bands, not a
    // floating rectangle. Nested decks stay readable under vertical camera.
    // Stepped island contact silhouette, following bridge/funnel rather than
    // reading as another rectangular deck panel. Kept inside the hull edge.
    parts.polygon([[16,-39],[33,-39],[33,12],[22,12],[22,7],[17,7],[17,-2],[12,-2],[12,-22],[16,-26]],11.57,'#2d3c3c');
    parts.polygon([[20,-36],[33,-36],[33,9],[24,9],[24,3],[20,3]],11.59,'#1e3034');
    parts.steelBox([13,14,42],[30,18,-14],'#51666e');
    parts.steelBox([15,1.3,44],[30,25.6,-14],'#9aaba6');
    parts.steelBox([16,6,19],[30,29,-22],'#637b82');
    parts.steelBox([17.5,.8,21],[30,32.4,-22],'#b1bab0');
    parts.panel(15.7,19.2,[30,32.82,-22],'#8e9d96',31,'steel');
    // Bridge glazing and funnel caps contrast with the roof rather than
    // depending on vertical faces that the camera cannot see.
    parts.plane(12,4,[30,32.9,-29],'#203c48');
    parts.plane(10,1,[30,33.0,-30.2],'#709a9b');
    parts.steelBox([8,8,10],[31,29,-2],'#65767c');
    parts.box([6,1,8],[31,33.4,-2],'#202e33');
    parts.box([2,21,2],[30,40,-12],'#263a42');
    parts.box([20,1,1.3],[30,48,-12],'#a0aaa1');
    for(const z of [-65,-42,21,44,70])for(const x of [-32,32]) {
      parts.box([3.4,1.2,7],[x,11.5,z],'#52636a');
      parts.cylinder(1.2,1.2,[x,12.5,z],'#192b35',6);
    }
    for(const z of [-92,89])parts.plane(7,3,[-2,11.6,z],'#bcaf83');
    for (const z of [-60,5,60]) for (const x of [-30,30]) parts.box([1.5,.8,1.5],[x,12,z],light);
    group.add(parts.mesh(true,carrierPaint));
  } else {
    parts.plane(23,35,[0,11.3,-8],'#253b40');
    parts.steelBox([17, 12, 28], [0, 16, -10], '#5e7278');
    parts.steelBox([20, 6, 15], [0, 23, -16], DECK);
    parts.steelBox([21, .8, 16], [0, 26.4, -16], '#b1bbb0');
    parts.plane(14,3,[0,26.9,-21],'#254652');
    for(const z of [8,22]) { parts.cylinder(5,11,[0,19,z],'#4a6068'); parts.cylinder(3.6,.6,[0,24.8,z],'#1a2a31'); }
    for(const x of [-10,10])parts.box([3,2,27],[x,12,14],'#939b8c');
    parts.box([7, 12, 9], [0, 19, 13], DARK);
    parts.box([2, 18, 2], [0, 30, -3], DARK);
    parts.box([12, .2, 8], [0, 11.3, 48], light);
    group.add(parts.mesh(true,destroyerPaint));
    for (const z of [-37, 35]) {
      const turret = new Parts().box([13, 5, 11], [0, 0, 0], HULL).box([2, 2, 18], [0, 2, -10], DARK).mesh(true,shipPaint);
      turret.name = 'Turret'; turret.position.set(0, 12, z); group.add(turret);
    }
  }
  return group;
}

// A loaded merchant hull: crates on deck, a funnel aft, no guns.
function transportTemplate() {
  const group = new THREE.Group(), V = CONFIG.convoy, parts = new Parts();
  parts.add(hullOutline(V.width * .9, V.length, 7), '#4a4238', [0, 1, 0], [-Math.PI / 2, 0, 0]);
  parts.add(hullOutline(V.width, V.length * .95, 2), '#7d7462', [0, 8, 0], [-Math.PI / 2, 0, 0]);
  for (const [z, w] of [[-4, 12], [8, 11], [18, 9]]) parts.box([w, 5, 8], [0, 12, z], '#8a6d47');
  parts.box([9, 9, 12], [0, 14, -18], CABIN);
  parts.box([3, 12, 3], [0, 19, -24], DARK);
  group.add(parts.mesh(true,shipPaint));
  return group;
}

export function createNavalScene(scene) {
  const templates = { carrier: shipTemplate(true), enemyCarrier: shipTemplate(true, true), destroyer: shipTemplate(false), enemyDestroyer: shipTemplate(false, true), transport: transportTemplate() };
  const ships = new Map(), zones = new Map(), airfields = new Map(), bombs = new Map();
  const bombGeometry = new THREE.SphereGeometry(3, 6, 4);
  const bombRing = new THREE.RingGeometry(14, 16, 24).rotateX(-Math.PI / 2);
  const wakeGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ringGeometry = new THREE.RingGeometry(CONFIG.conquest.captureRadius - 2, CONFIG.conquest.captureRadius, 64).rotateX(-Math.PI / 2);
  const flagGeometry = new THREE.BoxGeometry(24, 12, .8);
  // Three distinct service buildings retain the existing anchors, envelopes,
  // draw count and damage slots. Their roofs differ before tiny texture detail.
  const maintenance=new Parts().box([35,12,40],[0,-3,0],'#858779','steel');
  const arch=new THREE.Shape();arch.moveTo(-19,3);arch.lineTo(19,3);
  arch.absellipse(0,3,19,9,0,Math.PI,false);arch.closePath();
  maintenance.add(new THREE.ExtrudeGeometry(arch,{depth:43,bevelEnabled:false,curveSegments:8}),'#526b73',[0,0,-21.5],null,'roof');
  maintenance.box([29,9,.5],[0,-3,-20.3],'#263b42');
  for(const x of [-14.5,0,14.5])maintenance.box([.8,9,.7],[x,-3,-20.7],'#7c8c89');
  const operations=new Parts().box([31,10,36],[0,-4,0],'#858779','steel')
    .roof(34,39,1,5,[0,0,0],'#566d70','roof')
    .box([9,10,10],[10,6,11],'#6c7c7b','steel')
    .box([9.4,2,.4],[10,9,5.8],'#294852')
    .box([10,1,11],[10,11.5,11],'#9aa49b')
    .box([5,7,.5],[-8,-5,-18.3],'#2b4145');
  const stores=new Parts().box([35,8,40],[0,-5,0],'#7a7e6c','steel')
    .roof(27,43,-1,7,[-5,0,0],'#57665d','roof')
    .roof(10,40,-1,3,[13,0,0],'#677261','roof')
    .box([10,6,.4],[-6,-5,-20.3],'#35473f')
    .box([6,4,5],[14,-7,-18],'#5a624c');
  const hangarGeometries=[maintenance,operations,stores].map(parts=>parts.mesh(false).geometry);
  const beaconGeometry=new THREE.BoxGeometry(8,1,8);
  const length = CONFIG.airfield?.length ?? 300, width = CONFIG.airfield?.width ?? 70;
  // Runway, markings, approach arrow and aprons: one mesh shared by every airfield.
  const runwayParts = new Parts();
  // A designed airfield footprint: narrow gravel verge, dark shoulder,
  // weathered center asphalt and parallel service apron. No visual tile floats
  // across the runway; these stay within the existing cleared installation.
  runwayParts.plane(width+12,length+12,[0,8.65,0],'#777763');
  runwayParts.box([width,.5,length],[0,9,0],'#303d3d');
  runwayParts.plane(width-7,length-5,[0,9.31,0],'#455250');
  runwayParts.plane(width-13,length-7,[0,9.32,0],'#4e5953','asphalt');
  runwayParts.plane(65,length*.64,[width/2+34,8.8,0],'#686e60');
  runwayParts.plane(57,length*.60,[width/2+34,8.9,0],'#828675','concrete');
  // Slab joints remain low contrast, unlike the previous checkerboard farms.
  for(let z=-80;z<=80;z+=20)runwayParts.plane(57,.55,[width/2+34,9.02,z],'#656f64');
  runwayParts.plane(.7,180,[width/2+11,9.08,0],'#b5aa76');
  for(const z of [-65,0,65]) {
    runwayParts.plane(25,19,[width/2+6,9.36,z],'#626d62');
    runwayParts.plane(28,.8,[width/2+7,9.42,z],'#beb580');
    // Static contact occlusion is part of the shared runway batch.
    runwayParts.plane(42,47,[width/2+35,9.1,z+2.5],'#4b5750');
    runwayParts.plane(38,43,[width/2+33,9.15,z],'#303f3c');
    runwayParts.box([7,4,8],[width/2+59,11,z+14],'#5d6350');
    runwayParts.box([7,.6,8],[width/2+59,13.3,z+14],'#92917b');
  }
  for(const z of [-65,0,65]) {
    runwayParts.patch(19,12,[width/2+11,9.43,z],'#59665a','#626d62');
    runwayParts.patch(8,5,[width/2+55,9.10,z-12],'#667061','#828675');
  }
  for(let i=0;i<4;i++) {
    const x=width/2+56+(i%2)*6,z=-91+Math.floor(i/2)*6;
    runwayParts.cylinder(2.3,4,[x,11,z],'#52615b',6);
    runwayParts.cylinder(2,.4,[x,13.3,z],'#949c89',6);
  }
  // Tire wear is broad and quiet; center/threshold lines remain the highest
  // contrast marks. Three geometry strips cost less than per-pixel noise.
  for(const x of [-9,9])for(const end of [-1,1])runwayParts.plane(3.5,54,[x,9.38,end*77],'#3d4845');
  for(const x of [-width/2+4,width/2-4])runwayParts.plane(.9,length-20,[x,9.44,0],'#c1c1a8');
  for(let z=-length/2+25;z<length/2;z+=35)runwayParts.plane(1.7,16,[0,9.45,z],WHITE);
  for(const end of [-1,1])for(const x of [-21,-13,13,21])runwayParts.plane(3.5,14,[x,9.46,end*(length/2-18)],WHITE);
  const arrow = new THREE.Shape();
  [[0,20],[12,3],[4,3],[4,-18],[-4,-18],[-4,3],[-12,3]].forEach(([x,y],i)=>i?arrow.lineTo(x,y):arrow.moveTo(x,y));
  arrow.closePath();
  runwayParts.add(new THREE.ShapeGeometry(arrow),WHITE,[0,9.7,length/2-52],[-Math.PI/2,0,0]);
  const runwayGeometry = runwayParts.mesh(false).geometry;
  const radarGeometry = new Parts().box([32, 18, 26], [70, 17, 0], CABIN).box([3, 42, 3], [70, 43, 0], DARK).box([2, 28, 2], [70, 62, 0], DARK).mesh().geometry;
  const dishGeometry = new THREE.BoxGeometry(45, 20, 3);
  const portGeometry = new Parts().box([110, 5, 30], [0, 9, 0], WOOD).box([18, 5, 80], [-42, 9, 28], WOOD).box([18, 5, 80], [42, 9, 28], WOOD)
    .box([32, 24, 35], [-30, 20, -42], CABIN).box([32, 24, 35], [15, 20, -42], CABIN).box([4, 58, 4], [65, 36, 0], DARK).box([54, 4, 4], [45, 64, 0], DARK).mesh().geometry;
  const poleGeometry = new THREE.CylinderGeometry(1, 1, 28, 6);
  const lit = (geometry, material) => { const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; };
  return {
    ships, zones, airfields, bombs,
    get materialMode(){return surfaceMode;},
    update(game) {
      wakeMat.uniforms.time.value=game.time;
      const liveShips = new Set([...game.ships, ...(game.convoys || [])].filter(s => s.active !== false && !(s.hp <= 0 && s.sinking > CONFIG.ship.sinkingSeconds)));
      for (const [s, visual] of ships) if (!liveShips.has(s)) { scene.remove(visual.root, visual.wake); ships.delete(s); }
      for (const s of liveShips) {
        if (!ships.has(s)) {
          const root = templates[s.kind === 'transport' ? 'transport' : s.team === 'jp' ? (s.kind === 'carrier' ? 'enemyCarrier' : 'enemyDestroyer') : s.kind].clone(true);
          root.name = s.kind === 'transport' ? 'SupplyTransport' : s.kind === 'carrier' ? (s.team === 'jp' ? 'EnemyCarrier' : 'FriendlyCarrier') : 'PatrolDestroyer';
          const wake = new THREE.Mesh(wakeGeometry, wakeMat);
          // One shared material, one draw per visible vessel. Updating this
          // scalar at draw time avoids per-vessel shader/material instances.
          wake.onBeforeRender=()=>{
            wakeMat.uniforms.moving.value=wake.userData.moving?1:0;
            wakeMat.uniformsNeedUpdate=true;
          };
          ships.set(s, { root, wake, turrets: root.children.filter(node => node.name === 'Turret') }); scene.add(root, wake);
        }
        const v = ships.get(s), sink = s.hp <= 0 ? s.sinking / CONFIG.ship.sinkingSeconds : 0;
        v.root.visible = shipObserved(game, s);
        v.root.position.set(s.x, -sink * 28, s.y);
        v.root.rotation.set(0, -s.a - Math.PI / 2, sink * .35);
        for (const turret of v.turrets) turret.rotation.y = -(s.gunAngle ?? s.a) + s.a;
        v.wake.visible = v.root.visible && s.hp > 0;
        // Freshly activated/restored fleets can be rendered before their first
        // simulation update assigns moving. Treat only explicit false as a
        // landing hold; undefined must not erase the entire cruising wake.
        v.wake.userData.moving=s.fleet ? s.fleet.moving !== false : s.team === 'jp';
        v.wake.position.set(s.x-Math.cos(s.a)*s.length*.2,.3,s.y-Math.sin(s.a)*s.length*.2);
        v.wake.rotation.y = v.root.rotation.y;
        v.wake.scale.set(s.width*1.45,1,s.length*1.9);
      }
      const liveFields = new Set(game.airfields || []);
      for (const [field, visual] of airfields) if (!liveFields.has(field)) { scene.remove(visual.root); airfields.delete(field); }
      for (const field of liveFields) {
        if (!airfields.has(field)) {
          const root = new THREE.Group(); root.name = 'Airfield-' + field.id;
          root.add(new THREE.Mesh(runwayGeometry, paint));
          const hangars = [];
          for (const z of [-65, 0, 65]) {
            const hangar = lit(hangarGeometries[hangars.length], hangarMat);
            hangar.position.set(width / 2 + 33, 18, z);
            hangars.push(hangar); root.add(hangar);
          }
          const beacon = new THREE.Mesh(beaconGeometry, friend);
          beacon.position.set(-width / 2 - 8, 10, -length / 2 + 10); root.add(beacon);
          airfields.set(field, { root, hangars, beacon }); scene.add(root);
        }
        const v = airfields.get(field);
        v.root.visible = field.owner === 'us' || observedAt(game, field);
        v.root.position.set(field.x, 0, field.y);
        v.root.rotation.y = -field.a - Math.PI / 2;
        v.beacon.material = field.owner === 'us' ? friend : hostile;
        const intact = Math.ceil(3 * Math.max(0, field.hp) / field.maxHp);
        v.hangars.forEach((hangar, i) => {
          hangar.scale.y = i < intact ? 1 : .15;
          hangar.position.y = i < intact ? 18 : 10;
          hangar.material = i < intact ? hangarMat : rubbleMat;
        });
      }
      const liveBombs = new Set(game.bombs || []);
      for (const [bomb, visual] of bombs) if (!liveBombs.has(bomb)) { scene.remove(visual.root); bombs.delete(bomb); }
      for (const bomb of liveBombs) {
        if (!bombs.has(bomb)) {
          const root = new THREE.Group(); root.name = 'FallingBomb';
          const body = new THREE.Mesh(bombGeometry, dark); body.scale.z = 2; root.add(body);
          const marker = new THREE.Mesh(bombRing, friend); marker.position.y = 10; root.add(marker);
          bombs.set(bomb, { root, body, marker }); scene.add(root);
        }
        const v = bombs.get(bomb), remaining = Math.max(0, Math.min(1, bomb.life / (bomb.maxLife || 1)));
        v.root.position.set(bomb.x, 0, bomb.y);
        v.body.position.y = 10 + CONFIG.render.flightHeight * remaining;
        v.marker.position.set((bomb.vx || 0) * Math.max(0, bomb.life), 10, (bomb.vy || 0) * Math.max(0, bomb.life));
        v.marker.scale.setScalar(.4 + remaining * .6);
      }
      const liveZones = new Set(game.territories);
      for (const [t, visual] of zones) if (!liveZones.has(t)) { scene.remove(visual.group); zones.delete(t); }
      for (const t of liveZones) {
        if (!zones.has(t)) {
          const group = new THREE.Group(); group.position.set(t.x, 0, t.y);
          const ring = new THREE.Mesh(ringGeometry, hostile); ring.position.y = 9; group.add(ring);
          const pole = lit(poleGeometry, cabin); pole.position.set(-100, 28, 0); group.add(pole);
          const flag = new THREE.Mesh(flagGeometry, hostile); flag.position.set(-88, 40, 0); group.add(flag);
          let dish = null;
          if (t.role === 'radar') {
            group.add(lit(radarGeometry, paint));
            dish = lit(dishGeometry, cabin); dish.name = 'RadarDish'; dish.position.set(70, 62, 0); group.add(dish);
          } else if (t.role === 'port') {
            // Pier points into water at the shared physical coastline.
            const coast = t.portShore, port = lit(portGeometry, paint);
            port.position.set(coast?.x || 0, 0, coast?.y || 0);
            port.rotation.y = Math.PI / 2 - (coast?.a || 0);
            group.add(port);
          }
          group.name = 'Territory-' + t.name; zones.set(t, { group, ring, flag, dish }); scene.add(group);
        }
        const v = zones.get(t);
        v.group.visible = installationKnown(game, t) && (t.owner === 'us' || observedAt(game, t));
        const mat = t.owner === 'us' ? friend : hostile;
        v.ring.material = mat; v.flag.material = mat;
        v.ring.visible = t.owner !== 'us';
        if (v.dish) v.dish.rotation.y = game.time * .5;
      }
    },
  };
}
