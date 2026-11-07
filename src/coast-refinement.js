// Canonical physical shoreline detail, applied once to newly generated worlds.
// No simulation RNG calls: facility placement and campaign seeds stay unchanged.
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export function simpleCoast(p) {
  const n=p.length;
  for(let i=0;i<n;i++) {
    const a=p[i],b=p[(i+1)%n];
    if(!a.every(Number.isFinite)||Math.hypot(b[0]-a[0],b[1]-a[1])<1e-7)return false;
    for(let j=i+2;j<n;j++) {
      if(i===0&&j===n-1)continue;
      const c=p[j],d=p[(j+1)%n];
      if(Math.max(a[0],b[0])<Math.min(c[0],d[0])||Math.max(c[0],d[0])<Math.min(a[0],b[0])||Math.max(a[1],b[1])<Math.min(c[1],d[1])||Math.max(c[1],d[1])<Math.min(a[1],b[1]))continue;
      if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return false;
    }
  }
  return true;
}
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
export function refineCoast(shore,seed,facilities=[]) {
  if(shore.length<3||shore.length>256||shore.some(p=>!p.every(Number.isFinite)))return shore;
  const area=shore.reduce((s,p,i)=>{const q=shore[(i+1)%shore.length];return s+p[0]*q[1]-q[0]*p[1];},0),sign=Math.sign(area)||1;
  const lengths=shore.map((p,i)=>Math.hypot(p[0]-shore[(i+1)%shore.length][0],p[1]-shore[(i+1)%shore.length][1]));
  let step=55,counts=lengths.map(l=>Math.max(1,Math.ceil(l/step)));
  while(counts.reduce((a,b)=>a+b,0)>256){step*=1.05;counts=lengths.map(l=>Math.max(1,Math.ceil(l/step)));}
  const out=[];
  for(let i=0;i<shore.length;i++) {
    const a=shore[i],b=shore[(i+1)%shore.length],length=lengths[i];
    if(length<1e-7)return shore;
    const nx=-(b[1]-a[1])/length*sign,ny=(b[0]-a[0])/length*sign;
    for(let k=0;k<counts[i];k++) {
      const u=k/counts[i],x=a[0]+(b[0]-a[0])*u,y=a[1]+(b[1]-a[1])*u;
      // Rounded small coves/headlands, zero displacement and slope at anchors.
      let offset=(12+6*(.5+.5*Math.sin(seed*.017+i*2.7)))*Math.sin(Math.PI*u)**2*Math.sin(u*Math.PI*3+seed*.13+i*1.7);
      for(const f of facilities) {
        if(f.portShore) {
          const d=Math.hypot(x-f.x-f.portShore.x,y-f.y-f.portShore.y);
          offset*=smooth((d-110)/70); // pin docks and their offshore approach
        } else if(f.role==='airfield') {
          const dx=x-f.x,dy=y-f.y,c=Math.cos(f.a),s=Math.sin(f.a),along=dx*c+dy*s,across=-dx*s+dy*c;
          // Keep the closest home coastal anchor fixed for stable gameplay and
          // screenshot framing. Other runway-side detail can expand seaward.
          if(f.id===0&&across<0)offset*=smooth((Math.abs(along)-25)/45);
          if(offset>0) {
            const d=Math.hypot(Math.max(0,Math.abs(along)-190),Math.max(0,-110-across,across-255));
            offset=Math.min(offset,d*.35);
          }
        } else {
          offset*=smooth((Math.hypot(x-f.x,y-f.y)-90)/45);
        }
      }
      out.push([x+nx*offset,y+ny*offset]);
    }
  }
  // A pathological narrow bay is left at its proven coarse shape, never sent
  // to renderer/collision as a self-crossing polygon.
  return simpleCoast(out)?out:shore;
}
