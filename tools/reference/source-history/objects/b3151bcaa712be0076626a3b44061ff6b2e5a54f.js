// Deterministic bounded ridge geometry. No renderer/browser dependencies.
// Four irregular rings and one summit produce exactly112 triangles.
export function terrainRidge(radius, phase=0) {
  const segments=16,rings=[.22,.48,.74,1],vertices=[[0,0,0]],triangles=[];
  const height=(x,z,r)=>{
    const c=Math.cos(phase),s=Math.sin(phase),u=x*c+z*s,v=-x*s+z*c;
    const main=Math.exp(-Math.abs(v+.12*Math.sin(u*4+.4))*4.8)*Math.max(0,1-u*u*.85);
    const shoulder=.65*Math.exp(-((u+.37)**2*5+(v-.23)**2*11));
    return Math.max(main,shoulder)*Math.max(0,1-r*r)*radius*.60;
  };
  vertices[0][1]=height(0,0,0);
  for(const r of rings)for(let i=0;i<segments;i++) {
    const a=i/segments*Math.PI*2,edge=.88+.07*Math.sin(a*3+phase)+.045*Math.sin(a*5-phase);
    const x=Math.cos(a)*r*edge,z=Math.sin(a)*r*edge;
    vertices.push([x*radius,height(x,z,r),z*radius]);
  }
  for(let i=0;i<segments;i++)triangles.push([0,1+i,1+(i+1)%segments]);
  for(let ring=0;ring<rings.length-1;ring++)for(let i=0;i<segments;i++) {
    const j=(i+1)%segments,a=1+ring*segments+i,b=1+ring*segments+j,c=a+segments,d=b+segments;
    triangles.push([a,c,b],[b,c,d]);
  }
  return {vertices,triangles};
}
