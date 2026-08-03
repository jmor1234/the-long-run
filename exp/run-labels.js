// Dossier-label reference for criterion 4: what readLabel says about each
// coded persona at hand 31, across sessions. The frozen rates in PLAN.md come
// from this script (seed label1, 30 sessions) — reproducible, not ad hoc.
//
//   node exp/run-labels.js [--sessions 90] [--seed label1] [--html <engine.html> --sites <n>]
//
// --html/--sites run the measurement against another engine build (the lock's
// pre-change reference reproduces with:
//   git show 8f0bada:poker-trainer.html > exp/out/old.html
//   node exp/run-labels.js --html exp/out/old.html --sites 5 )
// The original 30-session registration numbers reproduce with --sessions 30.

const fs=require('fs');
const path=require('path');
const make=require('./exp-harness');

function fatal(msg){ console.error('run-labels: '+msg); process.exit(1); }
const args={};
{
  const argv=process.argv.slice(2);
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--')||!['sessions','seed','html','sites','policy','out'].includes(a.slice(2))) fatal('unknown arg '+a);
    const v=argv[i+1];
    if(v===undefined||v.startsWith('--')) fatal('flag '+a+' needs a value');
    args[a.slice(2)]=v; i++;
  }
}
const SESSIONS=args.sessions===undefined?90:+args.sessions;
const SEED=args.seed||'label1';
const OUT_DIR=args.out===undefined?path.join(__dirname,'out'):path.resolve(args.out);
const OUT_LABEL=args.out===undefined?'exp/out':OUT_DIR;
const POLICY_EXPLICIT=args.policy!==undefined;
let POLICY;
try{ POLICY=make.resolvePolicy(args.policy); }
catch(e){ fatal(e.message); }
const HAND_AT=31; // first hand at/after READS_MIN_HANDS(30)
if(!Number.isInteger(SESSIONS)||SESSIONS<1) fatal('--sessions must be a positive integer');

// Frozen mapping (PLAN.md criterion 4). Any contradicting fragment => contradiction.
const MAPPING={
  nit:      {correct:['tight','folds often'], contra:['loose','sticky','3-bets light','aggressive']},
  solid:    {correct:['folds often'],         contra:['tight','loose']},
  maniac:   {correct:['loose','3-bets light','aggressive','sticky'], contra:['tight','folds often']},
  selective:{correct:['tight','folds often','aggressive'], contra:['loose','sticky','passive']},
  station:  {correct:['loose','sticky','passive pre','calls c-bets','3-bets rare'], contra:['tight','folds often']},
};

const checkFoldHero=(G)=>{
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  const d=toCall>0?{action:'fold'}:{action:'check'};
  G.applyAction(hero,G.legalActionView?{...d,actionSeq:G.legalActionView(hero).actionSeq}:d);
  S.toAct=G.nextToAct(S.toAct);
  G.step();
};

const tally={}, classed={};
let conservationErrors=0, strayDraws=0, policyFits=0, policyRejects=0, policyFallbacks=0;
let challengerRejects=0, challengerFallbacks=0;
const observedPolicies=new Set();
for(let s=0;s<SESSIONS;s++){
  const h=make(checkFoldHero,{seed:`${SEED}|s${s}`,
    policy:POLICY,
    htmlPath:args.html||undefined,
    expectedRandSites:args.sites===undefined?undefined:+args.sites});
  observedPolicies.add(h.state.policy);
  h.G.newSession(); h.drain();
  while(h.G.session.hands<HAND_AT && !h.G.session.over){ h.G.newHand(); h.drain(); }
  if(h.G.roster.reduce((a,p)=>a+p.stack,0)!==6*h.G.START) conservationErrors++;
  strayDraws+=h.state.strayDraws;
  policyFits+=h.state.policyFits;
  policyRejects+=h.state.policyRejects;
  policyFallbacks+=h.state.policyFallbacks;
  challengerRejects+=h.state.challengerRejects;
  challengerFallbacks+=h.state.challengerFallbacks;
  for(const r of h.G.roster.filter(r=>r.style)){
    const tag=r.style.tag;
    const lab=h.G.readLabel('', r.reads);
    const key=lab? lab.replace(/^:\s*/,'') : '(none)';
    (tally[tag]=tally[tag]||{})[key]=(tally[tag][key]||0)+1;
    const m=MAPPING[tag];
    const cls = key==='(none)' ? 'none'
      : m.contra.some(f=>key.includes(f)) ? 'contradiction'
      : m.correct.some(f=>key.includes(f)) ? 'correct' : 'other';
    (classed[tag]=classed[tag]||{correct:0,contradiction:0,none:0,other:0})[cls]++;
  }
}

const config={sessions:SESSIONS, seed:SEED, handAt:HAND_AT};
if(POLICY_EXPLICIT) config.policy=POLICY;
const report={config, mapping:MAPPING,
  labels:tally, rates:{}};
if(POLICY_EXPLICIT){
  report.invariants={conservationErrors,strayDraws};
  report.policyActions={fits:policyFits,rejects:policyRejects,fallbacks:policyFallbacks,
    challengerRejects,challengerFallbacks,
    observedPolicy:observedPolicies.size===1?[...observedPolicies][0]:null};
}
console.log(`labels at hand ${HAND_AT}, ${SESSIONS} sessions, seed "${SEED}"\n`);
console.log('persona      correct  contradiction  none  other');
for(const [tag,c] of Object.entries(classed)){
  const pct=(n)=>Math.round(n/SESSIONS*100);
  report.rates[tag]={correctPct:pct(c.correct), contradictionPct:pct(c.contradiction)};
  console.log(`  ${tag.padEnd(11)} ${String(pct(c.correct)+'%').padEnd(8)} ${String(pct(c.contradiction)+'%').padEnd(14)} ${pct(c.none)}%   ${pct(c.other)}%`);
}
fs.mkdirSync(OUT_DIR,{recursive:true});
const outputName=POLICY_EXPLICIT?`labels-${POLICY}.json`:'labels-baseline.json';
fs.writeFileSync(path.join(OUT_DIR,outputName), JSON.stringify(report,null,2));
console.log(`\nwrote ${OUT_LABEL}/${outputName}`);

// Readability DRIFT DETECTOR: bots must stay within 10pp of the pre-humanize
// engine's readability. RE-INSTRUMENTED 2026-07-30 at 90 sessions: at the
// original 30, one label = 3.3pp against ~8pp binomial noise, so the lock
// bounced personas across its own line (solid oscillated 27-33 on unrelated
// dial changes). Bounds = pre-change engine measured at 90 sessions via the
// --html flag above — nit 74/1, solid 36/20, maniac 27/23, selective 67/1,
// station 41/17 — minus/plus the same contracted 10pp. Same contract,
// resolution the contract can actually be judged at. Disclosed plainly:
// the re-instrumentation landed alongside the texture dials because the
// texture pass exposed the resolution problem, the old 30-session lock
// would (noisily) fail at HEAD, and two personas sit at/within 1pp of
// their floors (solid 27 vs 26, selective 57 vs 57) — the contract line,
// honored with zero spare.
let locked=0, bugs=0;
if(POLICY_EXPLICIT){
  if(observedPolicies.size!==1 || !observedPolicies.has(POLICY)){
    console.log(`BUG runner requested ${POLICY} but harness observed ${[...observedPolicies].join(', ')||'none'}`); bugs++;
  }
  if(conservationErrors){ console.log(`BUG chips drifted in ${conservationErrors} sessions`); bugs++; }
  if(strayDraws){ console.log(`BUG ${strayDraws} RNG draws outside expected windows`); bugs++; }
  if(policyRejects) console.log(`NOTE: ${policyRejects} legacy/delegated policy actions were rejected`);
  if(policyFallbacks) console.log(`NOTE: ${policyFallbacks} legacy/delegated policy actions used safe fallback`);
  if(challengerRejects){ console.log(`BUG ${challengerRejects} Policy B-owned actions were rejected`); bugs++; }
  if(challengerFallbacks){ console.log(`BUG ${challengerFallbacks} Policy B-owned actions used safe fallback`); bugs++; }
}
const lockArmed=SESSIONS===90 && SEED==='label1';
if(lockArmed){
  const LOCK={nit:{minCorrect:64,maxContra:11}, solid:{minCorrect:26,maxContra:30},
    maniac:{minCorrect:17,maxContra:33}, selective:{minCorrect:57,maxContra:11},
    station:{minCorrect:31,maxContra:27}};
  for(const [tag,b] of Object.entries(LOCK)){
    const r=report.rates[tag];
    if(!r){ console.log(`FAIL ${tag}: no rate measured`); locked++; continue; }
    if(r.correctPct<b.minCorrect || r.contradictionPct>b.maxContra){
      console.log(`FAIL ${tag}: correct ${r.correctPct}% (min ${b.minCorrect}) / contradiction ${r.contradictionPct}% (max ${b.maxContra})`);
      locked++;
    }
  }
  if(!locked) console.log('readability lock: all personas within bounds');
} else {
  console.log('lock skipped: exploratory config');
}
if(POLICY_EXPLICIT){
  report.lock={armed:lockArmed,passed:lockArmed && !locked && !bugs};
  fs.writeFileSync(path.join(OUT_DIR,outputName), JSON.stringify(report,null,2));
}
process.exitCode=(locked||bugs)?1:0;
