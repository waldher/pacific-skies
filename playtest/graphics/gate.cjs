#!/usr/bin/env node
// Fail closed. Records attest review; this script does not impersonate a judge.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,p)));
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const weighted=a=>a.reduce((n,x,i)=>n+x*[.30,.20,.20,.15,.15][i],0);
const key=r=>r.profile.name+'-'+r.scene;
const failures=[];
const check=(ok,msg)=>{if(!ok)failures.push(msg);};
const valid=a=>Array.isArray(a)&&a.length===5&&a.every(x=>Number.isFinite(x)&&x>=1&&x<=10);
function checkExperience(experience, sourceHash) {
 check(experience?.sourceHash===sourceHash,'HUD, video and sound evidence missing or stale');
 if(experience?.sourceHash!==sourceHash)return;
 const clips=Array.isArray(experience.clips)?experience.clips:[];
 for(const profile of ['phone','fallback']){
  const matches=clips.filter(clip=>clip?.profile===profile);
  check(matches.length===1,`Continuous ${profile} recording required`);
  if(matches.length!==1)continue;
  const {file,sha256}=matches[0];
  const safe=typeof file==='string'&&file.startsWith('evidence/')&&
    !file.split(/[\\/]/).includes('..')&&/\.(webm|mp4)$/i.test(file);
  check(safe,`Invalid ${profile} recording path`);
  if(!safe)continue;
  const artifact=path.join(__dirname,file);
  check(fs.existsSync(artifact)&&sha(fs.readFileSync(artifact))===sha256,`Continuous ${profile} recording missing or modified`);
 }
 for(const [lane,method] of Object.entries({hud:'task-review',video:'continuous-playback',audio:'listened'})){
  const record=experience[lane];
  const scores=record?.scores;
  const complete=typeof record?.judge==='string'&&record.judge.trim()&&record.method===method&&
    Array.isArray(scores)&&scores.length===4&&scores.every(x=>Number.isFinite(x)&&x>=1&&x<=10)&&
    typeof record.findings==='string'&&record.findings.trim();
  check(complete&&record.accept===true,`${lane} experience review missing or rejected`);
 }
}
function evaluate(){
 const review=read('reviews.json'),refs=read('references.json').references;
 const rounds=review.rounds;
 check(Array.isArray(rounds)&&rounds.length>=2&&new Set(rounds).size===rounds.length,'Unique baseline/candidate round list required');
 if(failures.length)return;
 const baseline=rounds[0],latest=rounds.at(-1),suiteHash=sha(fs.readFileSync(path.join(ROOT,'playtest/graphics.cjs')));
 checkExperience(review.experience, review.sourceHash);
 check(review.sourceHash===require('./source-hash.cjs')(ROOT),'Stale review: runtime/assets changed');
 check(review.referenceManifestHash===sha(fs.readFileSync(path.join(__dirname,'references.json'))),'Reference set changed; recalibrate judges');
 const keys=['phone','fallback'].flatMap(p=>['airfield','coast','fleet','dogfight','stress'].map(s=>p+'-'+s));
 function validate(report,label){
  check(report.errors?.length===0&&report.results?.length===10,`${label}: incomplete capture`);
  check(report.suiteHash===suiteHash,`${label}: obsolete/different capture suite`);
  const rows=new Map(report.results.map(r=>[key(r),r]));
  check(rows.size===10&&keys.every(k=>rows.has(k)),`${label}: missing/duplicate/unknown scene`);
  check(report.seed===1942,`${label}: wrong seed`);
  for(const k of keys){
   const r=rows.get(k); if(!r)continue;
   check(r.profile.width===852&&r.profile.height===393&&r.profile.quality===(k.startsWith('phone')?2:4),`${label}/${k}: profile mismatch`);
   check(Number.isFinite(r.p95Ms)&&r.p95Ms>0,`${label}/${k}: invalid timing`);
  }
  return rows;
 }
 const reports={},rows={};
 for(const round of rounds){
  check(/^[a-z0-9-]+$/.test(round),'Unsafe round name');
  if(failures.includes('Unsafe round name'))return;
  const file=path.join(__dirname,'evidence',round,'report.json');
  check(review.reportHashes[round]===sha(fs.readFileSync(file)),`${round}: review/report hash mismatch`);
  reports[round]=JSON.parse(fs.readFileSync(file));rows[round]=validate(reports[round],round);
  for(const r of reports[round].results)check(sha(fs.readFileSync(path.join(path.dirname(file),path.basename(r.screenshot))))===r.sha256,`${round}/${key(r)}: image mismatch`);
  check(reports[round].samples===reports[baseline].samples&&reports[round].browser===reports[baseline].browser,`${round}: visual sample count/browser changed`);
  for(const k of keys)check(JSON.stringify(rows[round].get(k)?.camera)===JSON.stringify(rows[baseline].get(k)?.camera),`${round}/${k}: visual camera mismatch`);
 }
 check(reports[latest].sourceHash===review.sourceHash,'Screenshots are not from reviewed runtime');
 const judges=review.reviewers;
 check(judges.length>=3&&new Set(judges.map(j=>j.judge)).size===judges.length,'Three distinct judge records required');
 for(const j of judges){
  check(!!j.method&&j.findings?.length>0,`${j.judge}: evidence missing`);
  for(const round of rounds)for(const k of keys)check(valid(j[round]?.[k]),`${j.judge}/${round}/${k}: invalid score`);
  for(const ref of refs)check(valid(j.references?.[ref.id]),`${j.judge}/${ref.id}: reference score missing`);
 }
 if(failures.length)return;
 for(let n=1;n<rounds.length;n++){
  const before=rounds[n-1],after=rounds[n];
  const gains=judges.map(j=>keys.reduce((sum,k)=>sum+weighted(j[after][k])-weighted(j[before][k]),0)/keys.length);
  console.log(`${before} -> ${after}: median judge gain ${median(gains).toFixed(3)}/10`);
  check(median(gains)>=.15,`${after}: visual gain below 0.15`);
  for(const k of keys)check(judges.filter(j=>j[after][k][0]<j[before][k][0]).length<2,`${after}/${k}: majority readability regression`);
 }
 const baseRuns=[1,2,3].map(i=>read(`evidence/perf-base-${i}.json`));
 const candRuns=[1,2,3].map(i=>read(`evidence/perf-candidate-${i}.json`));
 const baseMaps=[],candMaps=[];
 for(const [runs,maps,round] of [[baseRuns,baseMaps,baseline],[candRuns,candMaps,latest]])for(const [i,run] of runs.entries()){
  const label=`${round} perf ${i+1}`;maps.push(validate(run,label));
  check(run.sourceHash===reports[round].sourceHash,`${label}: different source`);
  check(run.samples>=60&&run.samples===baseRuns[0].samples&&run.browser===baseRuns[0].browser,`${label}: sample count/browser mismatch`);
  for(const k of keys){const r=maps.at(-1).get(k);check(JSON.stringify(r.camera)===JSON.stringify(rows[round].get(k).camera),`${label}/${k}: camera mismatch`);}
 }
 for(const k of keys){
  const b=median(baseMaps.map(m=>m.get(k).p95Ms)),c=median(candMaps.map(m=>m.get(k).p95Ms));
  console.log(`${k}: p95 ${b.toFixed(2)} -> ${c.toFixed(2)} ms (${((c/b-1)*100).toFixed(1)}%)`);
  check(c<=b*1.05,`${k}: p95 render cost regressed >5%`);
 }
 const motion=review.motion;
 check(motion?.sourceHash===review.sourceHash&&motion?.reviews?.length>=3,'Motion review pending (impacts, particle fading, wakes and camera movement)');
 if(motion){
  check(sha(fs.readFileSync(path.join(__dirname,motion.file)))===motion.sha256,'Motion artifact mismatch');
  check(new Set(motion.reviews.map(r=>r.judge)).size>=3&&motion.reviews.every(r=>r.accept&&r.findings),'Motion findings missing or rejected');
 }
 if(process.argv.includes('--victory')){
  check(review.comparableGameplayReferences===true,'Comparable gameplay/HUD and held-out reference review pending');
  for(const k of keys)for(const ref of refs)check(judges.filter(j=>weighted(j[latest][k])>=weighted(j.references[ref.id])+.2).length>=2,`${k}: does not beat ${ref.id}`);
  const d=review.physicalDevice;
  check(d?.device&&d.browser&&d.durationSeconds>=600&&d.p95FrameMs<=33.3&&d.minSustainedFps>=30,'Physical low-end phone floor not demonstrated (10 minutes, 30 FPS floor; 60 FPS target)');
 }
}
try{evaluate();}catch(e){failures.push('Missing/malformed evidence: '+e.message);}
if(failures.length){console.error('\nNOT ACCEPTED\n'+failures.map(x=>' - '+x).join('\n'));process.exitCode=1;}
else console.log('Incremental candidate accepted. No claim of phone FPS or reference superiority.');
