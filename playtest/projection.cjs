// CPU-only: test the actual Three camera, inverse and frustum against HUD math.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),context=vm.createContext({console}),cache=new Map();
async function load(f){if(cache.has(f))return cache.get(f);const m=new vm.SourceTextModule(fs.readFileSync(f,'utf8'),{context,identifier:f});cache.set(f,m);return m;}
async function ns(f){const m=await load(path.join(root,f));await m.link((s,p)=>load(path.resolve(path.dirname(p.identifier),s)));await m.evaluate();return m.namespace;}
(async()=>{
 const T=await ns('vendor/three/three.core.min.js');
 const {OBLIQUE,applyObliqueProjection,projectWorld,recordVisualHeight,visualHeight,withRelief}=await ns('src/projection.js');
 const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
 for(const view of [{W:852,H:393},{W:393,H:852}])for(const cam of [{x:0,y:0},{x:8311,y:-9123}]){
  const camera=new T.OrthographicCamera(-view.W/2,view.W/2,view.H/2,-view.H/2,1,2000);
  camera.up.set(0,0,-1);camera.position.set(cam.x,OBLIQUE.cameraHeight,cam.y);camera.lookAt(cam.x,0,cam.y);camera.updateMatrixWorld();
  applyObliqueProjection(camera);
  const first=camera.projectionMatrix.clone();applyObliqueProjection(camera);assert.deepEqual(camera.projectionMatrix.elements,first.elements);
  const frustum=new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  for(const h of [0,9,11.5,15,32,48,160])for(const [dx,dy] of [[0,0],[71,-90],[-109,71]]){
   const point=new T.Vector3(cam.x+dx,h,cam.y+dy),ndc=point.clone().project(camera);
   const screen=projectWorld(point.x,point.z,h,cam,view);
   near(screen[0],(ndc.x+1)*view.W/2);near(screen[1],(1-ndc.y)*view.H/2);
   if(h===0){near(screen[0],dx+view.W/2);near(screen[1],dy+view.H/2);}
   const roundtrip=ndc.clone().unproject(camera);near(roundtrip.x,point.x);near(roundtrip.y,point.y);near(roundtrip.z,point.z);
   assert.equal(frustum.containsPoint(point),Math.abs(ndc.x)<=1&&Math.abs(ndc.y)<=1&&Math.abs(ndc.z)<=1);
  }
  // An elevated object just beyond the ground edge is still in the frustum
  // when the shear brings it into view. Culling uses the modified matrix.
  const high=new T.Vector3(cam.x-view.W/2-10,48,cam.y);
  assert.ok(frustum.containsPoint(high));
 }
 const entity={altitude:15};near(visualHeight(entity,32),15);recordVisualHeight(entity,22);near(visualHeight(entity,32),22);
 const mat={};assert.equal(withRelief(mat,8.5),mat);assert.equal(mat.onBeforeCompile,undefined);
 console.log('PASS affine projection: ground invariance, altitude/HUD agreement, resize idempotence, inverse, elevated frustum and visual clearance');
})().catch(e=>{console.error(e);process.exitCode=1});
