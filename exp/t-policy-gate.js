const fs=require('fs');
const os=require('os');
const path=require('path');
const cp=require('child_process');
const make=require('./exp-harness');
const {evaluateBaseline,validateStageArtifact,orchestrate}=require('./run-policy-gate');

console.log('POLICY GATE TEST - routing, provenance, legality, and verdict\n');
let fails=0;
const ok=(cond,name,detail)=>{
  if(!cond) fails++;
  console.log(`  ${cond?'ok  ':'FAIL'} ${name}${detail?'   '+detail:''}`);
};
const ROOT=path.join(__dirname,'..');
const OUT=fs.mkdtempSync(path.join(os.tmpdir(),'poker-policy-gate-'));
process.on('exit',()=>fs.rmSync(OUT,{recursive:true,force:true}));
const run=(script,args)=>cp.spawnSync(process.execPath,[path.join('exp',script),...args],{
  cwd:ROOT,encoding:'utf8'});
const read=(name)=>JSON.parse(fs.readFileSync(path.join(OUT,name),'utf8'));
const stripExplicit=(report)=>{
  const copy=JSON.parse(JSON.stringify(report));
  delete copy.config.policy;
  delete copy.policyActions;
  return copy;
};

ok(JSON.stringify(make.POLICIES)===JSON.stringify(['dispatch','v1','v2']),
  'one harness-owned policy enum defines every runner value');
ok(make.isChallengerOwned('v2',{street:'flop',view:{layeredEquity:false}})===true &&
  make.isChallengerOwned('v2',{street:'flop',view:{layeredEquity:true}})===false &&
  make.isChallengerOwned('v2',{street:'preflop',view:{layeredEquity:false}})===false,
  'challenger ownership excludes preflop and layered postflop delegation');

for(const [script,extra] of [
  ['run-baseline.js',['--sessions','1','--hands','2']],
  ['run-probes.js',['--sessions','1','--hands','2']],
  ['run-labels.js',['--sessions','1']],
]){
  const r=run(script,[...extra,'--seed','policy-route','--policy','unknown','--out',OUT]);
  ok(r.status!==0 && /unknown policy/.test(r.stderr),`${script} rejects an unknown policy`);
}

const legacy=run('run-baseline.js',['--sessions','1','--hands','2','--seed','policy-route','--out',OUT]);
const explicitDispatch=run('run-baseline.js',[
  '--sessions','1','--hands','2','--seed','policy-route','--policy','dispatch','--out',OUT]);
const v1=run('run-baseline.js',[
  '--sessions','1','--hands','2','--seed','policy-route','--policy','v1','--out',OUT]);
const v2=run('run-baseline.js',[
  '--sessions','1','--hands','2','--seed','policy-route','--policy','v2','--out',OUT]);
ok([legacy,explicitDispatch,v1,v2].every(r=>r.status===0),
  'baseline runner executes legacy, dispatch, v1, and v2 routes');
if([legacy,explicitDispatch,v1,v2].every(r=>r.status===0)){
  const legacyReport=read('baseline-metrics.json');
  const dispatchReport=read('baseline-dispatch-metrics.json');
  const v1Report=read('baseline-v1-metrics.json');
  const v2Report=read('baseline-v2-metrics.json');
  ok(JSON.stringify(legacyReport)===JSON.stringify(stripExplicit(dispatchReport)),
    'explicit dispatch preserves substantive legacy measurements');
  ok(JSON.stringify(legacyReport)===JSON.stringify(stripExplicit(v1Report)),
    'runner forwards v1 to the byte-equivalent Policy A path');
  ok(fs.readFileSync(path.join(OUT,'baseline-transcripts.txt'),'utf8')
    .startsWith('# baseline arm — seed "policy-route"'),
    'legacy transcript header remains unchanged');
  ok(v2Report.config.policy==='v2' && v2Report.policyActions.observedPolicy==='v2' &&
    fs.readFileSync(path.join(OUT,'baseline-v2-transcripts.txt'),'utf8').startsWith('# baseline arm | policy v2 |'),
    'v2 artifacts carry matching embedded provenance');
}

for(const script of ['run-probes.js','run-labels.js']){
  for(const policy of ['v1','v2']){
    const extra=script==='run-probes.js'?['--sessions','1','--hands','2']:['--sessions','1'];
    const r=run(script,[...extra,'--seed','policy-route','--policy',policy,'--out',OUT]);
    const name=script==='run-probes.js'?`probes-${policy}.json`:`labels-${policy}.json`;
    const artifact=r.status===0&&read(name);
    const observed=script==='run-probes.js'
      && artifact ? Object.values(artifact.probes).every(p=>p.policyActions.observedPolicy===policy)
      : artifact&&artifact.policyActions.observedPolicy===policy;
    ok(r.status===0 && artifact.config.policy===policy && observed &&
      artifact.lock && artifact.lock.armed===false && artifact.lock.passed===false,
      `${script} isolates and identifies the ${policy} arm`);
  }
}

const checkFoldHero=(G)=>{
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  const view=G.legalActionView(hero);
  G.applyAction(hero,{action:toCall>0?'fold':'check',actionSeq:view.actionSeq});
  S.toAct=G.nextToAct(S.toAct); G.step();
};
{
  const h=make(checkFoldHero,{seed:'policy-invalid',decide:()=>({action:'dance'})});
  h.G.newSession(); h.drain();
  ok(h.state.policyRejects>0 && h.state.policyFallbacks===h.state.policyRejects,
    'invalid coded decisions are observed through rejection and fallback',
    `${h.state.policyRejects} rejected`);
}
{
  const htmlPath=path.join(OUT,'t-policy-invalid-v2-preflop.html');
  const source=fs.readFileSync(path.join(ROOT,'poker-trainer.html'),'utf8');
  const needle="if(ctx.street==='preflop') return botPolicyV1(ctx);";
  const poisoned=source.replace(needle,
    "if(ctx.street==='preflop') return {action:'dance'};");
  ok(poisoned!==source,'test fixture changes exactly the Policy B-delegated preflop path');
  fs.writeFileSync(htmlPath,poisoned);
  const h=make(checkFoldHero,{seed:'policy-invalid-v2-preflop',policy:'v2',htmlPath});
  h.G.newSession(); h.drain();
  ok(h.state.policyRejects>0 && h.state.challengerRejects===0 &&
    h.state.challengerFallbacks===0,
  'Policy B delegated-path failures are excluded from challenger counters',
  `${h.state.policyRejects} total rejected`);
}
{
  const htmlPath=path.join(OUT,'t-policy-observer-missing.html');
  const source=fs.readFileSync(path.join(ROOT,'poker-trainer.html'),'utf8');
  const changed=source.replace('const fitted=policyActionForView(view,d);',
    'const fitted = policyActionForView(view,d);');
  fs.writeFileSync(htmlPath,changed);
  let rejected=false;
  try{ make(checkFoldHero,{seed:'policy-observer-missing',policy:'v2',htmlPath}); }
  catch(e){ rejected=/requires policy-action observation/.test(e.message); }
  ok(changed!==source && rejected,
    'explicit policies fail closed when source observation cannot be installed');
}
{
  const htmlPath=path.join(OUT,'t-policy-invalid-v2.html');
  const source=fs.readFileSync(path.join(ROOT,'poker-trainer.html'),'utf8');
  const needle="const botPolicyV2=function(ctx){\n  if(ctx.street==='preflop') return botPolicyV1(ctx);";
  const poisoned=source.replace(needle,
    "const botPolicyV2=function(ctx){\n  if(ctx.street!=='preflop' && ctx.legal && !ctx.legal.layeredEquity) return {action:'dance'};\n  if(ctx.street==='preflop') return botPolicyV1(ctx);");
  ok(poisoned!==source,'test fixture changes exactly the Policy B-owned path');
  fs.writeFileSync(htmlPath,poisoned);
  const h=make(checkFoldHero,{seed:'policy-invalid-v2',policy:'v2',htmlPath});
  h.G.newSession(); h.drain();
  let last=h.G.session.hands;
  while(h.state.challengerRejects===0 && h.G.session.hands<20 && !h.G.session.over){
    h.G.newHand(); h.drain();
    if(h.G.session.hands===last) break;
    last=h.G.session.hands;
  }
  ok(h.state.challengerRejects>0 && h.state.challengerFallbacks===h.state.challengerRejects,
    'Policy B-owned illegal actions are classified and fail-closed',
    `${h.state.challengerRejects} rejected`);
}
{
  const legal=(ctx)=>ctx.legal&&ctx.legal.aggressive
    ? {action:ctx.legal.aggressive.action,amount:ctx.legal.aggressive.minBetTo}
    : {action:ctx.toCall>0?'fold':'check'};
  const h=make(checkFoldHero,{seed:'policy-no-fit',decide:legal});
  h.G.newSession(); h.drain();
  ok(h.state.policyFits===0 && h.state.policyRejects===0,
    'already-legal aggressive sizes are not counted as fits');
}
{
  const fitted=(ctx)=>ctx.legal&&ctx.legal.aggressive
    ? {action:ctx.legal.aggressive.action,amount:0}
    : {action:ctx.toCall>0?'fold':'check'};
  const h=make(checkFoldHero,{seed:'policy-fit',decide:fitted});
  h.G.newSession(); h.drain();
  ok(h.state.policyFits>0 && h.state.policyRejects===0 && h.state.policyFallbacks===0,
    'trusted aggressive-size fitting is counted without being mislabeled illegal',
    `${h.state.policyFits} fits`);
}

const metric=(value,delta=0.02)=>({
  pooledFirstHalf:value,pooledSecondHalf:value,splitHalfDelta:delta,
  full:{mean:value,sd:0,n:40},
});
const basePersonas={
  nit:{vpip:0.20,f2bet:0.72,af:1.0,pfr:0.16},
  selective:{vpip:0.27,f2bet:0.61,af:1.2,pfr:0.21},
  solid:{vpip:0.32,f2bet:0.55,af:1.3,pfr:0.26},
  maniac:{vpip:0.44,f2bet:0.47,af:1.8,pfr:0.35},
  station:{vpip:0.45,f2bet:0.40,af:0.8,pfr:0.24},
};
const report=(policy)=>({
  config:{sessions:40,hands:150,seed:'exp1',policy},handsPlayed:6000,
  conservationErrors:0,strayDraws:0,splitHalfSessions:40,
  policyActions:{fits:12,rejects:0,fallbacks:0,challengerRejects:0,challengerFallbacks:0,
    observedPolicy:policy},
  personas:Object.fromEntries(Object.entries(basePersonas).map(([tag,p])=>[tag,{
    pooled:{...p},vpip:metric(p.vpip),pfr:metric(p.pfr),f2bet:metric(p.f2bet),
  }])),
});
const a=report('v1'), b=report('v2');
ok(evaluateBaseline(a,b).ok,'literal independent fixture passes every baseline criterion');
const fallback=JSON.parse(JSON.stringify(b));
fallback.policyActions.fallbacks=1; fallback.policyActions.challengerFallbacks=1;
ok(!evaluateBaseline(a,fallback).ok,'one Policy B-owned safe fallback fails the objective gate');
const drift=JSON.parse(JSON.stringify(b)); drift.personas.nit.pooled.vpip=0.40;
ok(!evaluateBaseline(a,drift).ok,'out-of-band persona drift fails the objective gate');
const unstable=JSON.parse(JSON.stringify(b)); unstable.personas.solid.vpip.splitHalfDelta=0.08;
ok(!evaluateBaseline(a,unstable).ok,'excess split-half drift fails the objective gate');

const copy=(v)=>JSON.parse(JSON.stringify(v));
const finding=(aArm,bArm,code)=>evaluateBaseline(aArm,bArm).findings.some(f=>f.code===code);
{
  const exact=copy(b), over=copy(b);
  exact.personas.solid.pooled.vpip=0.38;
  over.personas.solid.pooled.vpip=0.380001;
  ok(!finding(a,exact,'solid-vpip-delta') && finding(a,over,'solid-vpip-delta'),
    'VPIP delta accepts 0.06 and rejects epsilon over');
}
{
  const exact=copy(b), over=copy(b);
  exact.personas.solid.pooled.f2bet=0.63;
  over.personas.solid.pooled.f2bet=0.630001;
  ok(!finding(a,exact,'solid-f2bet-delta') && finding(a,over,'solid-f2bet-delta'),
    'fold-to-bet delta accepts 0.08 and rejects epsilon over');
}
{
  const exact=copy(b), over=copy(b);
  exact.personas.solid.vpip.splitHalfDelta=0.07;
  over.personas.solid.vpip.splitHalfDelta=0.070001;
  ok(!finding(a,exact,'solid-vpip-convergence') && finding(a,over,'solid-vpip-convergence'),
    'split-half allowance accepts 0.05 and rejects epsilon over');
}
{
  const exactA=copy(a), exactB=copy(b), underA=copy(a), underB=copy(b);
  for(const arm of [exactA,exactB,underA,underB]){
    arm.personas.nit.pooled.f2bet=0.65;
    arm.personas.selective.pooled.f2bet=0.60;
    arm.personas.solid.pooled.f2bet=0.55;
    arm.personas.maniac.pooled.f2bet=0.50;
  }
  exactA.personas.station.pooled.f2bet=exactB.personas.station.pooled.f2bet=0.50;
  underA.personas.station.pooled.f2bet=underB.personas.station.pooled.f2bet=0.500001;
  ok(!finding(exactA,exactB,'f2bet-gap') && finding(underA,underB,'f2bet-gap'),
    'nit-station fold gap accepts 0.15 and rejects epsilon under');
}
{
  const exact=copy(b), under=copy(b);
  exact.personas.station.pooled.af=1.3;
  under.personas.station.pooled.af=1.300001;
  ok(!finding(a,exact,'af-gap') && finding(a,under,'af-gap'),
    'maniac-station AF gap accepts 0.5 and rejects epsilon under');
}
{
  const bad=copy(b); bad.personas.nit.pooled.vpip=bad.personas.selective.pooled.vpip;
  const badA=copy(a); badA.personas.nit.pooled.vpip=bad.personas.nit.pooled.vpip;
  ok(finding(badA,bad,'vpip-order'),'VPIP persona ordering is enforced');
}
{
  const bad=copy(b), badA=copy(a);
  bad.personas.nit.pooled.f2bet=bad.personas.selective.pooled.f2bet;
  badA.personas.nit.pooled.f2bet=bad.personas.nit.pooled.f2bet;
  ok(finding(badA,bad,'f2bet-order'),'fold-to-bet persona ordering is enforced');
}
{
  const short=copy(b); short.handsPlayed=5999;
  ok(finding(a,short,'v2-hand-volume'),'declared experiment volume must match hands played');
}
{
  const artifact={config:{sessions:30,hands:200,seed:'probe1',policy:'v2'},
    lock:{armed:true,passed:true}};
  const skipped=copy(artifact); skipped.lock={armed:false,passed:false};
  ok(validateStageArtifact('run-probes.js','v2',artifact)===null &&
    /not armed/.test(validateStageArtifact('run-probes.js','v2',skipped)),
    'downstream artifacts must prove their frozen lock ran and passed');
}
{
  const calls=[];
  const result=orchestrate({
    engineCommit:'fixture',log:()=>{},read:()=>{ throw new Error('must not read'); },
    run:(script,policy)=>{ calls.push(`${script}:${policy}`); return {script,policy,ok:false}; },
  });
  ok(result.verdict==='fail' && calls.length===1,
    'orchestrator stops after the first failed stage');
}
{
  const calls=[];
  const drifted=copy(b); drifted.personas.station.pooled.vpip=0.60;
  const result=orchestrate({
    engineCommit:'fixture',log:()=>{},
    run:(script,policy)=>{ calls.push(`${script}:${policy}`); return {script,policy,ok:true}; },
    read:(name)=>name.includes('v1')?a:drifted,
  });
  ok(result.verdict==='fail' && calls.length===2 &&
    calls.every(v=>v.startsWith('run-baseline.js')),
  'orchestrator does not run later gates after baseline rejection');
}
{
  const calls=[];
  const result=orchestrate({
    engineCommit:'fixture',log:()=>{},read:(name)=>name.includes('v1')?a:b,
    run:(script,policy)=>{ calls.push(`${script}:${policy}`); return {script,policy,ok:true}; },
  });
  ok(result.verdict==='pass' && JSON.stringify(calls)===JSON.stringify([
    'run-baseline.js:v1','run-baseline.js:v2',
    'run-probes.js:v1','run-probes.js:v2',
    'run-labels.js:v1','run-labels.js:v2',
  ]),'passing baseline runs every downstream stage in order');
}
{
  const calls=[];
  const result=orchestrate({
    engineCommit:'fixture',log:()=>{},read:(name)=>name.includes('v1')?a:b,
    run:(script,policy)=>{
      calls.push(`${script}:${policy}`);
      return {script,policy,ok:!(script==='run-labels.js'&&policy==='v1')};
    },
  });
  ok(result.verdict==='fail' && calls.length===5 &&
    calls[calls.length-1]==='run-labels.js:v1',
    'downstream failure stops before any later stage');
}

console.log(fails?'\n  POLICY GATE FAILURES PRESENT':'\n  Policy gate contract is independently constrained');
process.exitCode=fails?1:0;
