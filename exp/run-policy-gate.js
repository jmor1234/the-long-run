// Objective Policy A (v1) versus Policy B (v2) gate. The shipped dispatcher
// is not involved and is never changed by this runner.
//
//   node exp/run-policy-gate.js

// Criteria are fixed here before either arm runs. A blind action-only panel is
// a separate later gate, warranted only after this objective gate passes.

const fs=require('fs');
const path=require('path');
const cp=require('child_process');

const ROOT=path.join(__dirname,'..');
const OUT=path.join(__dirname,'out');
const TAGS=['nit','solid','maniac','selective','station'];
const CRITERIA=Object.freeze({
  vpipDeltaMax:0.06,
  foldToBetDeltaMax:0.08,
  splitHalfDeltaAllowance:0.05,
  nitStationFoldGapMin:0.15,
  maniacStationAfGapMin:0.5,
});
const STAGES=Object.freeze({
  'run-baseline.js':Object.freeze({
    args:Object.freeze(['--sessions','40','--hands','150','--seed','exp1']),
    output:(policy)=>`baseline-${policy}-metrics.json`,
    config:Object.freeze({sessions:40,hands:150,seed:'exp1'}),
  }),
  'run-probes.js':Object.freeze({
    args:Object.freeze(['--sessions','30','--hands','200','--seed','probe1']),
    output:(policy)=>`probes-${policy}.json`,
    config:Object.freeze({sessions:30,hands:200,seed:'probe1'}),
  }),
  'run-labels.js':Object.freeze({
    args:Object.freeze(['--sessions','90','--seed','label1']),
    output:(policy)=>`labels-${policy}.json`,
    config:Object.freeze({sessions:90,seed:'label1',handAt:31}),
  }),
});

const finite=(v)=>typeof v==='number' && Number.isFinite(v);
const clone=(v)=>JSON.parse(JSON.stringify(v));

function evaluateBaseline(v1,v2){
  const findings=[];
  const measurements={personas:{}};
  const check=(ok,code,detail)=>{ if(!ok) findings.push({code,detail}); };
  const expected={sessions:40,hands:150,seed:'exp1'};
  for(const [arm,report] of [['v1',v1],['v2',v2]]){
    check(!!report && typeof report==='object',`${arm}-report`,`${arm} report is missing`);
    if(!report || typeof report!=='object') continue;
    check(report.config && report.config.policy===arm,`${arm}-policy`,
      `expected policy ${arm}, got ${report.config&&report.config.policy}`);
    for(const [key,value] of Object.entries(expected))
      check(report.config && report.config[key]===value,`${arm}-config-${key}`,
        `expected ${key}=${value}, got ${report.config&&report.config[key]}`);
    check(report.conservationErrors===0,`${arm}-conservation`,
      `${report.conservationErrors} conservation errors`);
    check(report.strayDraws===0,`${arm}-rng`,`${report.strayDraws} stray RNG draws`);
    check(report.splitHalfSessions===expected.sessions,`${arm}-split-volume`,
      `${report.splitHalfSessions}/${expected.sessions} sessions reached the split`);
    check(report.handsPlayed===expected.sessions*expected.hands,`${arm}-hand-volume`,
      `expected ${expected.sessions*expected.hands} hands, got ${report.handsPlayed}`);
    const actions=report.policyActions||{};
    check(finite(actions.rejects)&&finite(actions.fallbacks),`${arm}-action-counts`,
      'policy rejection and fallback counts are missing');
    check(actions.challengerRejects===0,`${arm}-challenger-rejections`,
      `${actions.challengerRejects} Policy B-owned actions were rejected`);
    check(actions.challengerFallbacks===0,`${arm}-challenger-fallbacks`,
      `${actions.challengerFallbacks} Policy B-owned actions used safe fallback`);
    check(actions.observedPolicy===arm,`${arm}-observed-policy`,
      `harness observed ${actions.observedPolicy}, expected ${arm}`);
    measurements[arm]={policyActions:{
      fits:actions.fits,rejects:actions.rejects,fallbacks:actions.fallbacks,
      challengerRejects:actions.challengerRejects,
      challengerFallbacks:actions.challengerFallbacks,
      observedPolicy:actions.observedPolicy,
    }};
  }

  for(const tag of TAGS){
    const a=v1&&v1.personas&&v1.personas[tag];
    const b=v2&&v2.personas&&v2.personas[tag];
    check(!!a,`v1-${tag}`,`Policy A is missing ${tag}`);
    check(!!b,`v2-${tag}`,`Policy B is missing ${tag}`);
    if(!a||!b) continue;
    const av=a.pooled||{}, bv=b.pooled||{};
    const vpipDelta=finite(av.vpip)&&finite(bv.vpip)?Math.abs(bv.vpip-av.vpip):null;
    const foldDelta=finite(av.f2bet)&&finite(bv.f2bet)?Math.abs(bv.f2bet-av.f2bet):null;
    measurements.personas[tag]={
      v1:{vpip:av.vpip,f2bet:av.f2bet,af:av.af},
      v2:{vpip:bv.vpip,f2bet:bv.f2bet,af:bv.af},
      deltas:{vpip:vpipDelta,f2bet:foldDelta},
    };
    check(vpipDelta!==null && vpipDelta<=CRITERIA.vpipDeltaMax,`${tag}-vpip-delta`,
      `VPIP delta ${vpipDelta} exceeds ${CRITERIA.vpipDeltaMax}`);
    check(foldDelta!==null && foldDelta<=CRITERIA.foldToBetDeltaMax,`${tag}-f2bet-delta`,
      `fold-to-bet delta ${foldDelta} exceeds ${CRITERIA.foldToBetDeltaMax}`);
    for(const key of ['vpip','pfr','f2bet']){
      const ad=a[key]&&a[key].splitHalfDelta;
      const bd=b[key]&&b[key].splitHalfDelta;
      check(finite(ad)&&finite(bd)&&bd<=ad+CRITERIA.splitHalfDeltaAllowance,
        `${tag}-${key}-convergence`,
        `Policy B split-half delta ${bd} exceeds Policy A ${ad} + ${CRITERIA.splitHalfDeltaAllowance}`);
    }
  }

  const bp=Object.fromEntries(TAGS.map(tag=>[tag,
    v2&&v2.personas&&v2.personas[tag]&&v2.personas[tag].pooled]));
  if(TAGS.every(tag=>bp[tag])){
    check(bp.nit.vpip<bp.selective.vpip && bp.selective.vpip<bp.solid.vpip &&
      bp.solid.vpip<Math.min(bp.maniac.vpip,bp.station.vpip),'vpip-order',
      'expected nit < selective < solid < min(maniac, station)');
    const middle=TAGS.filter(tag=>tag!=='nit'&&tag!=='station');
    check(middle.every(tag=>bp.nit.f2bet>bp[tag].f2bet) &&
      middle.every(tag=>bp.station.f2bet<bp[tag].f2bet),'f2bet-order',
      'nit must fold most and station least');
    check(finite(bp.nit.f2bet)&&finite(bp.station.f2bet)&&
      bp.nit.f2bet-bp.station.f2bet>=CRITERIA.nitStationFoldGapMin,'f2bet-gap',
      `nit-station fold gap must be >= ${CRITERIA.nitStationFoldGapMin}`);
    check(finite(bp.maniac.af)&&finite(bp.station.af)&&
      bp.maniac.af-bp.station.af>=CRITERIA.maniacStationAfGapMin,'af-gap',
      `maniac-station AF gap must be >= ${CRITERIA.maniacStationAfGapMin}`);
  }
  return {ok:findings.length===0,criteria:clone(CRITERIA),measurements,findings};
}

function readJson(name){
  return JSON.parse(fs.readFileSync(path.join(OUT,name),'utf8'));
}

function writeResult(result){
  fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,'policy-gate.json'),JSON.stringify(result,null,2));
}

function validateStageArtifact(script,policy,artifact){
  const spec=STAGES[script];
  if(!spec) return 'unknown stage';
  const expected={...spec.config,policy};
  const mismatches=Object.entries(expected)
    .filter(([key,value])=>!artifact.config || artifact.config[key]!==value)
    .map(([key,value])=>`${key}=${artifact.config&&artifact.config[key]} (expected ${value})`);
  if(mismatches.length) return 'artifact config mismatch: '+mismatches.join(', ');
  if(script!=='run-baseline.js' &&
      (!artifact.lock || artifact.lock.armed!==true || artifact.lock.passed!==true))
    return 'artifact lock was not armed and passed';
  return null;
}

function runStage(script,policy){
  const spec=STAGES[script];
  if(!spec) return {script,policy,ok:false,error:'unknown stage'};
  const rel=path.join('exp',script);
  const outputPath=path.join(OUT,spec.output(policy));
  fs.rmSync(outputPath,{force:true});
  const argv=[rel,...spec.args,'--policy',policy,'--out',OUT];
  console.log(`\n=== ${argv.join(' ')}`);
  const child=cp.spawnSync(process.execPath,argv,{
    cwd:ROOT,stdio:'inherit',encoding:'utf8'});
  if(child.error) return {script,policy,ok:false,error:child.error.message};
  if(child.status!==0) return {script,policy,ok:false,status:child.status};
  let artifact;
  try{ artifact=JSON.parse(fs.readFileSync(outputPath,'utf8')); }
  catch(e){ return {script,policy,ok:false,status:child.status,error:e.message}; }
  const invalid=validateStageArtifact(script,policy,artifact);
  if(invalid) return {script,policy,ok:false,status:child.status,error:invalid};
  return {script,policy,ok:true,status:child.status,output:spec.output(policy)};
}

function orchestrate({run=runStage,read=readJson,engineCommit,log=console.log}={}){
  const stages=[];
  for(const policy of ['v1','v2']){
    const stage=run('run-baseline.js',policy); stages.push(stage);
    if(!stage.ok) return {verdict:'fail',engineCommit,criteria:clone(CRITERIA),stages};
  }
  const baseline=evaluateBaseline(read('baseline-v1-metrics.json'),
    read('baseline-v2-metrics.json'));
  if(!baseline.ok){
    for(const f of baseline.findings) log(`FAIL ${f.code}: ${f.detail}`);
    return {verdict:'fail',engineCommit,baseline,stages};
  }

  for(const script of ['run-probes.js','run-labels.js']){
    for(const policy of ['v1','v2']){
      const stage=run(script,policy); stages.push(stage);
      if(!stage.ok) return {verdict:'fail',engineCommit,baseline,stages};
    }
  }

  return {verdict:'pass',engineCommit,baseline,stages};
}

function main(){
  const engineCommit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  const result=orchestrate({engineCommit});
  writeResult(result);
  if(result.verdict==='pass')
    console.log('\nPOLICY GATE: objective criteria passed; blind action-only comparison is warranted');
  else process.exitCode=1;
}

if(require.main===module) main();
module.exports={CRITERIA,STAGES,evaluateBaseline,validateStageArtifact,orchestrate};
