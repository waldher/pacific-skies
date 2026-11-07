import * as THREE from '../vendor/three/three.module.min.js';
let atlas=null,loading=null;
let shadowStamps;
export const hasCanopyMaterial=()=>!!atlas;
export function preloadCanopyMaterial() {
  if(loading)return loading;
  loading=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2500);
    try {
      const response=await fetch(new URL('../assets/foliage/canopy-atlas-512.webp',import.meta.url),{signal:controller.signal});
      if(!response.ok)throw Error('Canopy atlas unavailable');
      const bitmap=await createImageBitmap(await response.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
      atlas=new THREE.Texture(bitmap);atlas.flipY=false;atlas.colorSpace=THREE.SRGBColorSpace;
      atlas.magFilter=THREE.LinearFilter;atlas.minFilter=THREE.LinearMipmapLinearFilter;
      atlas.generateMipmaps=true;atlas.needsUpdate=true;return true;
    }catch{return false;}finally{clearTimeout(timer);}
  })();return loading;
}
// One shared opaque cutout material per land factory, one shared texture per
// module lifetime. Chunk disposal frees geometry only, never the shared atlas.
export function canopyMaterial() {
  return atlas?new THREE.MeshBasicMaterial({map:atlas,vertexColors:true,alphaTest:.38,side:THREE.FrontSide,depthWrite:true}):null;
}

// Reuse the same foliage cutout in the terrain bake. Four tiny Canvas2D
// stamps avoid per-tree masks and never become GPU textures.
function makeShadowStamps(image) {
  const size = 32;
  return Array.from({ length: 4 }, (_, variant) => {
    const stamp = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size) : document.createElement('canvas');
    stamp.width = stamp.height = size;
    const ctx = stamp.getContext('2d');
    const left = (variant % 2) * 256 + 1;
    const top = Math.floor(variant / 2) * 256 + 1;
    ctx.drawImage(image, left, top, 254, 254, 0, 0, size, size);
    // Downsampling naturally softens small leaf gaps before tinting the mask.
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = 'rgba(10,19,19,.36)';
    ctx.fillRect(0, 0, size, size);
    return stamp;
  });
}

export function paintCanopyShadow(ctx, x, y, radius, variant) {
  if (!atlas) return false;
  if (shadowStamps === undefined) {
    try { shadowStamps = makeShadowStamps(atlas.image); }
    catch { shadowStamps = null; }
  }
  if (!shadowStamps) return false;
  const extent = radius * 1.10;
  ctx.drawImage(shadowStamps[variant], x - extent, y - extent, extent * 2, extent * 2);
  return true;
}
export class CanopyBatch {
  constructor(){this.positions=[];this.uvs=[];this.colors=[];this.indices=[];}
  add(x,y,height,radius,variant,tint) {
    const n=this.positions.length/3,r=radius*1.10;
    // Fixed world orientation preserves the atlas's baked upper-left light.
    const points=[[x-r,height,y-r],[x-r,height,y+r],[x+r,height,y+r],[x+r,height,y-r]];
    const col=variant%2,row=Math.floor(variant/2),pad=1/512;
    const u0=col*.5+pad,v0=row*.5+pad,u1=(col+1)*.5-pad,v1=(row+1)*.5-pad;
    const uv=[[u0,v0],[u0,v1],[u1,v1],[u1,v0]];
    const max=Math.max(...tint,.001),color=tint.map(c=>.88+.12*c/max);
    for(let i=0;i<4;i++){this.positions.push(...points[i]);this.uvs.push(...uv[i]);this.colors.push(...color);}
    this.indices.push(n,n+1,n+2,n,n+2,n+3);
  }
  build(){
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(this.positions,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uvs,2));
    g.setAttribute('color',new THREE.Float32BufferAttribute(this.colors,3));
    g.setIndex(this.indices);return g;
  }
}
