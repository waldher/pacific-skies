// Tiny bounded lighting probe: baked once, then sampled only by existing PBR
// aircraft. No capture cube, runtime scene passes, external asset or cache.
import * as THREE from 'three';
import { CONFIG } from './config.js';
const WIDTH = 128, HEIGHT = 64;

export function bakeEnvironmentPixels() {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  const sun = new THREE.Vector3(...CONFIG.render.sunOffset).normalize();
  const zenith = new THREE.Color('#799fba'), horizon = new THREE.Color('#d2daca');
  const sea = new THREE.Color(CONFIG.render.ocean.deep), cloud = new THREE.Color('#eef0e3');
  const color = new THREE.Color();
  for (let y=0;y<HEIGHT;y++) for (let x=0;x<WIDTH;x++) {
    const v=(y+.5)/HEIGHT, u=(x+.5)/WIDTH;
    // Equirectangular UV convention: v=1 points upward.
    const latitude=(v-.5)*Math.PI, h=Math.sin(latitude), radius=Math.cos(latitude);
    const longitude=(u-.5)*Math.PI*2, dx=radius*Math.cos(longitude), dz=radius*Math.sin(longitude);
    if(h>=0) color.copy(horizon).lerp(zenith,Math.pow(h,.55));
    else color.copy(horizon).lerp(sea,Math.min(1,-h*5));
    // Broad soft solar/cloud highlight, aligned with the game's actual sun.
    const alignment=Math.max(0,dx*sun.x+h*sun.y+dz*sun.z);
    const glow=Math.pow(alignment,18)*.36*Math.max(0,h);
    color.lerp(cloud,glow);
    const i=(y*WIDTH+x)*4;
    data[i]=Math.round(color.r*255);data[i+1]=Math.round(color.g*255);data[i+2]=Math.round(color.b*255);data[i+3]=255;
  }
  return { data, width: WIDTH, height: HEIGHT };
}

export function createEnvironment(renderer, scene) {
  const fallback = reason => ({ mode:'hemisphere-fallback', reason, bytes:0, dispose(){} });
  // PMREM's output is half-float. Decline before allocating on unsupported
  // devices, retaining the existing hemisphere and directional illumination.
  if(!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float'))
    return fallback('half-float color attachment unsupported');
  const previousTarget=renderer.getRenderTarget(), face=renderer.getActiveCubeFace(), mip=renderer.getActiveMipmapLevel();
  const viewport=renderer.getViewport(new THREE.Vector4()), scissor=renderer.getScissor(new THREE.Vector4());
  const scissorTest=renderer.getScissorTest(), xr=renderer.xr.enabled, autoClear=renderer.autoClear;
  let source, generator, target;
  try {
    const pixels=bakeEnvironmentPixels();
    source=new THREE.DataTexture(pixels.data,pixels.width,pixels.height,THREE.RGBAFormat);
    source.colorSpace=THREE.LinearSRGBColorSpace;
    source.mapping=THREE.EquirectangularReflectionMapping;source.needsUpdate=true;
    generator=new THREE.PMREMGenerator(renderer);
    target=generator.fromEquirectangular(source);
    renderer.setRenderTarget(target);
    const gl=renderer.getContext();
    if(gl.isContextLost() || gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)
      throw new Error('incomplete PMREM framebuffer');
    scene.environment=target.texture;
    scene.environmentIntensity=.26;
    return { mode:'pmrem-32', reason:null, bytes:target.width*target.height*8,
      dispose(){ if(scene.environment===target.texture)scene.environment=null;target.dispose(); } };
  } catch(error) {
    target?.dispose();
    return fallback(String(error?.message || error));
  } finally {
    source?.dispose();generator?.dispose();
    renderer.xr.enabled=xr;renderer.autoClear=autoClear;
    renderer.setRenderTarget(previousTarget,face,mip);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
  }
}
