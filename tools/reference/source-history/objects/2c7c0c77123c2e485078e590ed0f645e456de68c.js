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
import { shipObserved, installationKnown, observedAt } from './intelligence.js';

const paint = withRelief(new THREE.MeshLambertMaterial({ vertexColors: true }));
// The unified oblique camera reveals hull volume. Materials remain Lambert;
// gameplay hull and landing tests remain entirely independent of this model.
const shipPaint = withRelief(new THREE.MeshLambertMaterial({ vertexColors: true }), 0);
const solid = hex => new THREE.MeshLambertMaterial({ color: hex });
const hangarMat = paint, rubbleMat = withRelief(solid('#343534')), dark = solid('#263743'), cabin = withRelief(solid('#839296'));
const friend = new THREE.MeshBasicMaterial({ color: '#62ddba' });
const hostile = new THREE.MeshBasicMaterial({ color: '#ee7964' });
// One surface draw carries both the thin hull-water contact shadow and the
// moving wake. No noise texture, shadow-map sampling or additional mesh pass.
const wakeMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { moving:{value:1}, time:{value:0} },
  vertexShader: `varying vec2 vUv;
    void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vUv; uniform float moving,time;
    void main() {
      // Coordinates normalized to hull width/length. Bow is negative z.
      float x=(vUv.x-.5)*1.45, z=(.5-vUv.y)*1.9+.2;
      float h;
      if(z<-.35) h=mix(0.0,.36,clamp((z+.5)/.15,0.0,1.0));
      else if(z<-.15) h=mix(.36,.45,(z+.35)/.20);
      else if(z<.43) h=.45;
      else h=mix(.45,.288,clamp((z-.43)/.07,0.0,1.0));
      float lateral=abs(x)-h;
      float hullLength=smoothstep(-.54,-.485,z)*(1.0-smoothstep(.49,.54,z));
      float contact=(1.0-smoothstep(-.01,.075,lateral))*hullLength*.35;
      // Narrow broken bow/sheer foam ties the hull to water without a white
      // selection outline. The interior is depth-occluded by the real hull.
      float edgeFoam=smoothstep(-.01,.015,lateral)*(1.0-smoothstep(.015,.06,lateral));
      edgeFoam*=smoothstep(-.51,-.45,z)*(1.0-smoothstep(-.1,.35,z));
      float aft=clamp((z-.4)/.72,0.0,1.0);
      float spread=mix(.25,.57,aft);
      float envelope=(1.0-smoothstep(.25,1.0,abs(x)/spread));
      envelope*=smoothstep(.40,.52,z)*(1.0-smoothstep(.52,1.12,z));
      // Short transverse eddies keep the trail connected. Longitudinal
      // sinusoids previously split the wake into two searchlight-like beams.
      float churn=.78+.22*sin(z*69.0-time*3.0+x*x*31.0)*sin(z*41.0+x*7.0-time*2.0);
      float stern=(1.0-smoothstep(.10,.30,abs(x)))*smoothstep(.43,.51,z)*(1.0-smoothstep(.51,.68,z));
      float foam=moving*(envelope*churn*.34+stern*.12+edgeFoam*.24);
      float alpha=contact+foam*(1.0-contact);
      if(alpha<.006) discard;
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
  add(geometry, hex, position = [0, 0, 0], rotation = null) {
    const c = new THREE.Color(hex);
    if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    geometry.translate(...position);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.list.push(geometry.index ? geometry.toNonIndexed() : geometry);
    return this;
  }
  box(dimensions, position, hex) { return this.add(new THREE.BoxGeometry(...dimensions), hex, position); }
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
  plane(width, depth, position, hex) {
    return this.add(new THREE.PlaneGeometry(width, depth), hex, position, [-Math.PI / 2, 0, 0]);
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
    this.list.push(g.toNonIndexed());g.dispose();return this;
  }
  roof(width, depth, base, rise, position, hex) {
    const shape = new THREE.Shape();
    shape.moveTo(-width/2, base); shape.lineTo(0, base+rise); shape.lineTo(width/2, base); shape.closePath();
    return this.add(new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled:false}), hex,
      [position[0],position[1],position[2]-depth/2]);
  }
  // CPU-baked panel/grain variation: identical runtime vertex-colour shader,
  // no texture sample or procedural fragment noise. Changes every 14 world units
  // rather than subpixel speckle, preserving the low-resolution phone tier.
  panel(width,depth,position,hex,seed=1) {
    const segments=Math.max(1,Math.ceil(depth/14));
    const g=new THREE.PlaneGeometry(width,depth,1,segments).rotateX(-Math.PI/2);
    g.translate(...position);
    const base=new THREE.Color(hex),colors=[];
    for(let i=0;i<g.attributes.position.count;i++) {
      const row=Math.floor(i/2),noise=Math.sin(row*17.17+seed*9.31)*43758.5453;
      const factor=.965+(noise-Math.floor(noise))*.07+(i%2?-.012:.012);
      colors.push(base.r*factor,base.g*factor,base.b*factor);
    }
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
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
// A broad flight deck is not the destroyer's pointed waterline outline.
// Its rounded bow shoulders and clipped stern remain inside the physical hull.
function flightDeck(width, length, height) {
  const w=width/2,l=length/2,shape=new THREE.Shape();
  shape.moveTo(-w*.62,l);shape.lineTo(w*.62,l);
  shape.quadraticCurveTo(w,l,w,l*.80);shape.lineTo(w,-l*.84);
  shape.quadraticCurveTo(w,-l*.96,w*.78,-l);shape.lineTo(-w*.78,-l);
  shape.quadraticCurveTo(-w,-l*.96,-w,-l*.84);shape.lineTo(-w,l*.80);
  shape.quadraticCurveTo(-w,l,-w*.62,l);shape.closePath();
  return new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,curveSegments:5});
}
function carrierHull(width,length) {
  const w=width/2,l=length/2,shape=new THREE.Shape();
  shape.moveTo(0,l);shape.bezierCurveTo(w*.32,l*.96,w,l*.56,w,l*.22);
  shape.lineTo(w,-l*.64);shape.quadraticCurveTo(w,-l*.94,w*.60,-l);
  shape.lineTo(-w*.60,-l);shape.quadraticCurveTo(-w,-l*.94,-w,-l*.64);
  shape.lineTo(-w,l*.22);shape.bezierCurveTo(-w,l*.56,-w*.32,l*.96,0,l);
  const contour=shape.getPoints(7);contour.pop();
  const vertices=[],uv=[],indices=[],rings=[[.82,.96,.7],[1,1,6.8],[.98,.995,9.4]];
  for(const [sx,sz,y] of rings)for(const p of contour){vertices.push(p.x*sx,y,-p.y*sz);uv.push(p.x/width+.5,p.y/length+.5);}
  const n=contour.length;
  for(let r=0;r<rings.length-1;r++)for(let i=0;i<n;i++){
    const a=r*n+i,b=(r+1)*n+i,c=r*n+(i+1)%n,d=(r+1)*n+(i+1)%n;
    indices.push(a,b,c,c,b,d);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
}
function shipTemplate(carrier, enemy = false) {
  const group = new THREE.Group();
  const length = carrier ? CONFIG.carrier.length : CONFIG.ship.length;
  const width = carrier ? CONFIG.carrier.width : CONFIG.ship.width;
  const parts = new Parts();
  if(carrier) {
    // Narrow curved steel hull under a genuinely overhanging flight deck.
    // Three waterline sections provide bilge/sheer volume without extra draws.
    parts.add(carrierHull(width*.84,length),'#3a505b');
    parts.add(flightDeck(width*.96,length*.94,.8),'#21343c',[0,9.1,0],[-Math.PI/2,0,0]);
    parts.add(flightDeck(width,length*.95,1.1),'#64777b',[0,9.9,0],[-Math.PI/2,0,0]);
    parts.add(flightDeck(width*.957,length*.938,.15),'#807258',[0,11.03,0],[-Math.PI/2,0,0]);
    // Long, recessed hangar-side openings sit under the deck overhang.
    for(const x of [-width*.421,width*.421])for(const z of [-42,4,49]) {
      parts.box([.25,3.6,25],[x,6.7,z],'#223841');
      parts.box([.45,.5,26],[x,8.7,z],'#64767c');
    }
  } else {
    parts.add(hullOutline(width*.9,length,8),'#233843',[0,1,0],[-Math.PI/2,0,0]);
    parts.add(hullOutline(width,length*.95,2,.7),'#43565b',[0,8.7,0],[-Math.PI/2,0,0]);
    parts.add(hullOutline(width*.92,length*.925,.15),DECK,[0,11.03,0],[-Math.PI/2,0,0]);
  }
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
      parts.plane(20,22,[-17,11.34,z],'#535b50');
      parts.plane(17.5,19.5,[-17,11.36,z-.7],'#777562');
      parts.plane(15.5,.7,[-17,11.38,z+8.5],'#8c8972');
      parts.plane(.45,15,[-17,11.4,z],'#696d5b');
    }
    // Flight-deck markings have hierarchy: boundary, center, landing wires.
    for (let z = -84; z < 93; z += 24) parts.plane(1.5,10,[-3,11.5,z],'#bdbba0');
    for (const x of [-25, 20]) parts.plane(.9,156,[x,11.5,4],'#b2b39a');
    for (const z of [56, 64, 72]) {
      parts.plane(42,.7,[-2,11.55,z],'#263b3e');
      parts.plane(42,.3,[-2,11.56,z-.7],'#b5b5a1');
    }
    for (const x of [-18,-12,-6,6,12,18]) parts.plane(2.5,10,[x,11.5,-78],'#ded7b8');
    // Island contact shadow/overhangs are geometric tonal bands, not a
    // floating rectangle. Nested decks stay readable under vertical camera.
    // Stepped island contact silhouette, following bridge/funnel rather than
    // reading as another rectangular deck panel. Kept inside the hull edge.
    parts.polygon([[16,-39],[33,-39],[33,12],[22,12],[22,7],[17,7],[17,-2],[12,-2],[12,-22],[16,-26]],11.57,'#2d3c3c');
    parts.polygon([[20,-36],[33,-36],[33,9],[24,9],[24,3],[20,3]],11.59,'#1e3034');
    // Compact forward bridge, aft funnel and thin mast read as one island,
    // with glazing on real vertical faces rather than a blue roof rectangle.
    parts.steelBox([12,10,43],[26,17,-14],'#4e626b');
    parts.steelBox([14,1.0,45],[26,22.4,-14],'#7f9294');
    parts.steelBox([13,6,20],[26,25.6,-25],'#536c77');
    parts.box([13.2,2, .35],[26,26.4,-35.15],'#203b48');
    for(const x of [19.35,32.65])parts.box([.35,2,17],[x,26.4,-25],'#294651');
    for(const x of [22,26,30])parts.box([.6,2.2,.5],[x,26.4,-35.3],'#83979a');
    parts.steelBox([14.5,.8,21.5],[26,29.0,-25],'#a0afa9');
    parts.panel(12.5,19.5,[26,29.42,-25],'#758b8b',31);
    // A substantial single uptake with a recessed dark mouth, not a second
    // tiny roof block. The cap lip shares the steel palette of the island.
    parts.steelBox([9,12,14],[26,28,-3],'#526971');
    parts.steelBox([10,.8,15],[26,34.2,-3],'#819391');
    parts.plane(7.3,11.8,[26,34.62,-3],'#1a2a30');
    parts.box([1.2,15,1.2],[26,36,-18],'#354c57');
    parts.box([12,.7,.9],[26,41.5,-18],'#829693');
    for(const z of [-65,-42,21,44,70])for(const x of [-32,32]) {
      parts.box([3.4,1.2,7],[x,11.5,z],'#52636a');
      parts.cylinder(1.2,1.2,[x,12.5,z],'#192b35',6);
    }
    for(const z of [-92,89])parts.plane(7,3,[-2,11.6,z],'#bcaf83');
    for (const z of [-60,5,60]) for (const x of [-30,30]) parts.box([1.5,.8,1.5],[x,12,z],light);
    group.add(parts.mesh(true,shipPaint));
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
    group.add(parts.mesh(true,shipPaint));
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
  const hangarParts = new Parts()
    .box([35,12,40],[0,-3,0],'#858779')
    .roof(38,43,3,8,[0,0,0],'#4a5d63')
    .box([1.2,.7,43],[0,11.3,0],'#a1aaa2')
    .box([1.5,.8,43],[-18.5,3.2,0],'#293c41')
    .box([1.5,.8,43],[18.5,3.2,0],'#738486')
    .box([.7,9,30],[-17.8,-3,0],'#263c42');
  for(const x of [-1,1]) {
    const g=new THREE.PlaneGeometry(17.4,40);
    g.rotateX(-Math.PI/2);g.rotateZ(-x*Math.atan2(8,19));
    hangarParts.add(g,x<0?'#657d80':'#4c646b',[x*9.5,7.18,0]);
  }
  for(const z of [-13,0,13])hangarParts.box([4,2.2,5],[0,12,z],'#6f8488');
  const hangarGeometry = hangarParts.mesh(false).geometry, beaconGeometry = new THREE.BoxGeometry(8,1,8);
  const length = CONFIG.airfield?.length ?? 300, width = CONFIG.airfield?.width ?? 70;
  // Runway, markings, approach arrow and aprons: one mesh shared by every airfield.
  const runwayParts = new Parts();
  // A designed airfield footprint: narrow gravel verge, dark shoulder,
  // weathered center asphalt and parallel service apron. No visual tile floats
  // across the runway; these stay within the existing cleared installation.
  runwayParts.plane(width+12,length+12,[0,8.65,0],'#777763');
  runwayParts.box([width,.5,length],[0,9,0],'#303d3d');
  runwayParts.plane(width-7,length-5,[0,9.31,0],'#455250');
  runwayParts.plane(width-13,length-7,[0,9.32,0],'#4e5953');
  runwayParts.plane(65,length*.64,[width/2+34,8.8,0],'#686e60');
  runwayParts.plane(57,length*.60,[width/2+34,8.9,0],'#828675');
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
            const hangar = lit(hangarGeometry, hangarMat);
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
