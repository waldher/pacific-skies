import { insidePolygon } from './surface.js';
import { simpleCoast } from './coast-refinement.js';
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function intersect(a,b,c,d) {
  if(Math.max(a[0],b[0])<Math.min(c[0],d[0])||Math.max(c[0],d[0])<Math.min(a[0],b[0])||Math.max(a[1],b[1])<Math.min(c[1],d[1])||Math.max(c[1],d[1])<Math.min(a[1],b[1]))return false;
  return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;
}
function boundariesIntersect(a,b) {
  return a.some((p,i)=>b.some((q,j)=>intersect(p,a[(i+1)%a.length],q,b[(j+1)%b.length])));
}
export function acceptsRidgeHole(ring,outer,holes) {
  if(!simpleCoast(ring)||!ring.every(p=>insidePolygon(p[0],p[1],outer))||boundariesIntersect(ring,outer))return false;
  return holes.every(h=>!boundariesIntersect(ring,h)&&!insidePolygon(ring[0][0],ring[0][1],h)&&!insidePolygon(h[0][0],h[0][1],ring));
}
export function smoothRidge(ridge) {
  const normals=ridge.vertices.map(()=>[0,0,0]),indices=[];
  for(let [a,b,c] of ridge.triangles) {
    const p=ridge.vertices[a],q=ridge.vertices[b],r=ridge.vertices[c],u=q.map((v,k)=>v-p[k]),v=r.map((v,k)=>v-p[k]);
    let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    if(n[1]<0){[b,c]=[c,b];n=n.map(v=>-v);}
    indices.push(a,b,c);for(const k of[a,b,c])for(let axis=0;axis<3;axis++)normals[k][axis]+=n[axis];
  }
  normals.forEach((n,k)=>{
    if(ridge.vertices[k][1]===0){n[0]=0;n[1]=1;n[2]=0;return;}
    const length=Math.hypot(...n)||1;for(let axis=0;axis<3;axis++)n[axis]/=length;
  });
  return {normals,indices};
}
// ShapeGeometry is in local XY and rotated -PI/2 aroundX at world groundHeight.
// Convert raised world X/height/Z vertices and normals into that same frame.
export function mergeTerrainSurface(base,patches) {
  const positions=Array.from(base.position),normals=Array.from(base.normal),uv=Array.from(base.uv),indices=Array.from(base.index);
  for(const {ridge,x,y} of patches) {
    const offset=positions.length/3,smooth=smoothRidge(ridge);
    ridge.vertices.forEach(([vx,h,vz],i)=>{
      positions.push(x+vx,-(y+vz),h);uv.push(x+vx,-(y+vz));
      const [nx,ny,nz]=smooth.normals[i];normals.push(nx,-nz,ny);
    });
    for(const i of smooth.indices)indices.push(offset+i);
  }
  return {position:new Float32Array(positions),normal:new Float32Array(normals),uv:new Float32Array(uv),index:new (positions.length/3>65535?Uint32Array:Uint16Array)(indices)};
}
