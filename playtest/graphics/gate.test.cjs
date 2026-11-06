// Isolated synthetic evidence, never used for real scoring or CI acceptance.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'graphics-gate-')),dir=path.join(root,'playtest/graphics');fs.mkdirSync(dir,{recursive:true});
 fs.copyFileSync(path.join(__dirname,'gate.cjs'),path.join(dir,'gate.cjs'));
 fs.writeFileSync(path.join(dir,'source-hash.cjs'),"module.exports=()=> 'candidate-source';");
 fs.writeFileSync(path.join(root,'playtest/graphics.cjs'),'fixture-suite');
 const write=(p,x)=>{fs.mkdirSync(path.dirname(path.join(dir,p)),{recursive:true});fs.writeFileSync(path.join(dir,p),JSON.stringify(x));};
 const keys=['phone','fallback'].flatMap(p=>['airfield','coast','fleet','dogfight','stress'].map(s=>[p,s]));
 const report=(source)=>({sourceHash:source,suiteHash:sha('fixture-suite'),seed:1942,samples:60,browser:'fixture',errors:[],results:keys.map(([p,s])=>({profile:{name:p,width:852,height:393,quality:p==='phone'?2:4},scene:s,camera:{x:0,y:0},p95Ms:10,screenshot:p+'-'+s+'.png',sha256:sha('fixture-image')}))});
 write('references.json',{references:[{id:'reference'}]});
 const review={rounds:['baseline','candidate'],sourceHash:'candidate-source',referenceManifestHash:sha(fs.readFileSync(path.join(dir,'references.json'))),reportHashes:{},reviewers:[],motion:{sourceHash:'candidate-source',file:'motion.txt',sha256:sha('motion-fixture'),reviews:[1,2,3].map(i=>({judge:'j'+i,accept:true,findings:'fixture'}))}};
 fs.writeFileSync(path.join(dir,'motion.txt'),'motion-fixture');
 for(const name of review.rounds){write(`evidence/${name}/report.json`,report(name==='baseline'?'base-source':'candidate-source'));for(const [p,s] of keys)fs.writeFileSync(path.join(dir,`evidence/${name}/${p}-${s}.png`),'fixture-image');review.reportHashes[name]=sha(fs.readFileSync(path.join(dir,`evidence/${name}/report.json`)));}
 for(let i=1;i<=3;i++){write(`evidence/perf-base-${i}.json`,report('base-source'));write(`evidence/perf-candidate-${i}.json`,report('candidate-source'));review.reviewers.push({judge:'j'+i,method:'synthetic unit-test fixture',findings:['fixture'],baseline:Object.fromEntries(keys.map(([p,s])=>[p+'-'+s,[5,5,5,5,5]])),candidate:Object.fromEntries(keys.map(([p,s])=>[p+'-'+s,[6,6,6,6,6]])),references:{reference:[9,9,9,9,9]}});}
 write('reviews.json',review);
 return {root,dir,write,review,run:()=>spawnSync(process.execPath,[path.join(dir,'gate.cjs')],{encoding:'utf8'})};
}
for(const [name,mutate,expected] of [
 ['valid synthetic evidence',()=>{},null],
 ['stale source',f=>{f.review.sourceHash='old';f.write('reviews.json',f.review);},'Stale review'],
 ['missing judge',f=>{f.review.reviewers.pop();f.write('reviews.json',f.review);},'Three distinct judge'],
 ['missing motion',f=>{delete f.review.motion;f.write('reviews.json',f.review);},'Motion review pending'],
 ['tampered screenshot',f=>fs.writeFileSync(path.join(f.dir,'evidence/candidate/phone-coast.png'),'changed'),'image mismatch'],
 ['slow candidate',f=>{for(let i=1;i<=3;i++){const p=`evidence/perf-candidate-${i}.json`,r=JSON.parse(fs.readFileSync(path.join(f.dir,p)));r.results[0].p95Ms=12;f.write(p,r);}},'regressed >5%'],
 ['wrong performance source',f=>{const p='evidence/perf-base-1.json',r=JSON.parse(fs.readFileSync(path.join(f.dir,p)));r.sourceHash='wrong';f.write(p,r);},'different source'],
 ['duplicate scene',f=>{const p='evidence/perf-candidate-1.json',r=JSON.parse(fs.readFileSync(path.join(f.dir,p)));r.results[1]=r.results[0];f.write(p,r);},'missing/duplicate/unknown scene'],
 ])test(name,()=>{const f=fixture();try{mutate(f);const r=f.run(),output=r.stdout+r.stderr;if(expected){assert.equal(r.status,1);assert.ok(output.includes(expected),output);}else assert.equal(r.status,0,output);}finally{fs.rmSync(f.root,{recursive:true,force:true});}});
