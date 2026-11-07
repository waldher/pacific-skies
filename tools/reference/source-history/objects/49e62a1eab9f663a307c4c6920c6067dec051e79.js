// Exact polygon queries: preserve original crossing and segment arithmetic.
// Immutable polygon arrays only; callers create a fresh query after mutation.
export function createPolygonQuery(points) {
  const edges=points.map((a,i)=>{const b=points[(i+1)%points.length],dx=b[0]-a[0],dy=b[1]-a[1];return {ax:a[0],ay:a[1],bx:b[0],by:b[1],dx,dy,l2:dx*dx+dy*dy,minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minY:Math.min(a[1],b[1]),maxY:Math.max(a[1],b[1])};});
  const minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
  const count=Math.max(1,Math.min(64,Math.ceil(Math.sqrt(points.length)))),scale=count/(maxY-minY||1),buckets=Array.from({length:count},()=>[]);
  // Original insidePolygon iterates edge (i, i-1), not (i, i+1). Preserve its
  // direction and operation order even though the geometric result is equal.
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const [ax,ay]=points[i],[bx,by]=points[j];if(ay===by)continue;
    const lo=Math.max(0,Math.min(count-1,Math.floor((Math.min(ay,by)-minY)*scale))),hi=Math.max(0,Math.min(count-1,Math.floor((Math.max(ay,by)-minY)*scale)));
    const edge={ax,ay,bx,by};for(let b=lo;b<=hi;b++)buckets[b].push(edge);
  }
  function tree(items){
    const node={minX:Math.min(...items.map(e=>e.minX)),maxX:Math.max(...items.map(e=>e.maxX)),minY:Math.min(...items.map(e=>e.minY)),maxY:Math.max(...items.map(e=>e.maxY))};
    if(items.length<=8){node.edges=items;return node;}
    const axis=node.maxX-node.minX>node.maxY-node.minY?'X':'Y';
    items.sort((a,b)=>(a['min'+axis]+a['max'+axis])-(b['min'+axis]+b['max'+axis]));
    const mid=items.length>>1;node.left=tree(items.slice(0,mid));node.right=tree(items.slice(mid));return node;
  }
  const root=tree(edges);
  const lower=(node,x,y)=>{const dx=Math.max(0,node.minX-x,x-node.maxX),dy=Math.max(0,node.minY-y,y-node.maxY);return dx*dx+dy*dy;};
  return {
    contains(x,y){
      if(y<minY||y>=maxY)return false;
      const bucket=buckets[Math.max(0,Math.min(count-1,Math.floor((y-minY)*scale)))];let inside=false;
      for(const {ax,ay,bx,by} of bucket)if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
      return inside;
    },
    distance(x,y){
      let best=Infinity;
      function visit(node,bound){
        // Conservative slack protects floating-point boundary comparisons. It
        // only visits extra edges; returned distances still use exact originals.
        if(bound>(best+1e-9)*(best+1e-9))return;
        if(node.edges){for(const e of node.edges){const t=e.l2?Math.max(0,Math.min(1,((x-e.ax)*e.dx+(y-e.ay)*e.dy)/e.l2)):0;best=Math.min(best,Math.hypot(x-e.ax-t*e.dx,y-e.ay-t*e.dy));}return;}
        const a=lower(node.left,x,y),b=lower(node.right,x,y);
        if(a<b){visit(node.left,a);visit(node.right,b);}else{visit(node.right,b);visit(node.left,a);}
      }
      visit(root,0);return best;
    },
  };
}
