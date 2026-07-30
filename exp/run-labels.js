// Dossier-label reference for criterion 4: what readLabel says about each
// coded persona at hand 31, across sessions. The frozen rates in PLAN.md come
// from this script (seed label1, 30 sessions) — reproducible, not ad hoc.
//
//   node exp/run-labels.js [--sessions 30] [--seed label1]

const fs=require('fs');
const path=require('path');
const make=require('./exp-harness');

function fatal(msg){ console.error('run-labels: '+msg); process.exit(1); }
const args={};
{
  const argv=process.argv.slice(2);
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--')||!['sessions','seed'].includes(a.slice(2))) fatal('unknown arg '+a);
    const v=argv[i+1];
    if(v===undefined||v.startsWith('--')) fatal('flag '+a+' needs a value');
    args[a.slice(2)]=v; i++;
  }
}
const SESSIONS=args.sessions===undefined?30:+args.sessions;
const SEED=args.seed||'label1';
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
  G.applyAction(hero, toCall>0?{action:'fold'}:{action:'check'});
  S.toAct=G.nextToAct(S.toAct);
  G.step();
};

const tally={}, classed={};
for(let s=0;s<SESSIONS;s++){
  const h=make(checkFoldHero,{seed:`${SEED}|s${s}`});
  h.G.newSession(); h.drain();
  while(h.G.session.hands<HAND_AT && !h.G.session.over){ h.G.newHand(); h.drain(); }
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

const report={config:{sessions:SESSIONS, seed:SEED, handAt:HAND_AT}, mapping:MAPPING,
  labels:tally, rates:{}};
console.log(`labels at hand ${HAND_AT}, ${SESSIONS} sessions, seed "${SEED}"\n`);
console.log('persona      correct  contradiction  none  other');
for(const [tag,c] of Object.entries(classed)){
  const pct=(n)=>Math.round(n/SESSIONS*100);
  report.rates[tag]={correctPct:pct(c.correct), contradictionPct:pct(c.contradiction)};
  console.log(`  ${tag.padEnd(11)} ${String(pct(c.correct)+'%').padEnd(8)} ${String(pct(c.contradiction)+'%').padEnd(14)} ${pct(c.none)}%   ${pct(c.other)}%`);
}
const outDir=path.join(__dirname,'out');
fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'labels-baseline.json'), JSON.stringify(report,null,2));
console.log('\nwrote exp/out/labels-baseline.json');

// Readability DRIFT DETECTOR: bots must stay roughly as readable as the
// pre-humanize engine. Bounds = pre-change measurement @ 8f0bada (73/3,
// 43/10, 33/20, 70/0, 33/23) minus/plus 10pp — a floor against decay, not an
// independent oracle of what a read should say (the mapping encodes design
// intent). Post-C3 measured margins are thin for solid (37 vs 33) and
// station (30 vs 23): that is the detector working near its line, by design.
// Enforced only at the frozen config.
let locked=0;
if(SESSIONS===30 && SEED==='label1'){
  const LOCK={nit:{minCorrect:63,maxContra:13}, solid:{minCorrect:33,maxContra:20},
    maniac:{minCorrect:23,maxContra:30}, selective:{minCorrect:60,maxContra:10},
    station:{minCorrect:23,maxContra:33}};
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
process.exitCode=locked?1:0;
