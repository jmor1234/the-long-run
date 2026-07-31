// Baseline arm: coded bots through the experiment metrics pipeline.
// Produces the reference numbers the pass criteria get pre-registered against
// (persona frequency bands, split-half deltas) plus blind-able transcripts.
//
//   node exp/run-baseline.js [--sessions 12] [--hands 120] [--seed exp1]
//
// Output: exp/out/baseline-metrics.json, exp/out/baseline-transcripts.txt
// Hand counts come from the engine (session.hands), which includes the hand
// newSession itself plays; transcripts are labelled by the engine's handNum.

const fs=require('fs');
const path=require('path');
const make=require('./exp-harness');
const {rates, diffReads, addTo}=require('./metrics');

function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--')) fatal(`unexpected argument: ${a}`);
    const key=a.slice(2);
    if(!['sessions','hands','seed'].includes(key)) fatal(`unknown flag: ${a}`);
    const val=argv[i+1];
    if(val===undefined || val.startsWith('--')) fatal(`flag ${a} needs a value`);
    args[key]=val; i++;
  }
  return args;
}
function fatal(msg){ console.error('run-baseline: '+msg); process.exit(1); }

// Defaults ARE the frozen config (PLAN.md); a bare run reproduces the
// registered numbers rather than quietly overwriting them with another config.
const args=parseArgs(process.argv.slice(2));
const SESSIONS=args.sessions===undefined?40:+args.sessions;
const HANDS=args.hands===undefined?150:+args.hands;
const SEED=args.seed||'exp1';
if(SESSIONS!==40||HANDS!==150||SEED!=='exp1')
  console.log(`NOTE: config differs from the frozen registration (40x150, exp1) — output is exploratory`);
if(!Number.isInteger(SESSIONS) || SESSIONS<1) fatal(`--sessions must be a positive integer, got "${args.sessions}"`);
if(!Number.isInteger(HANDS) || HANDS<2) fatal(`--hands must be an integer >= 2, got "${args.hands}"`);

const checkFoldHero=(G)=>{
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  const d=toCall>0?{action:'fold'}:{action:'check'};
  G.applyAction(hero,G.legalActionView?{...d,actionSeq:G.legalActionView(hero).actionSeq}:d);
  S.toAct=G.nextToAct(S.toAct);
  G.step();
};

const snapReads=(G)=>G.roster.filter(r=>r.style).map(r=>({
  tag:r.style.tag, reads:JSON.parse(JSON.stringify(r.reads)),
}));

const perTag={};        // tag -> {full:[]}  per-session rates (dispersion view)
const pooledTag={};     // tag -> summed raw counters across sessions (band reference)
const pooledFirst={};   // tag -> summed first-half counters (split-half, pooled)
const pooledSecond={};  // tag -> summed second-half counters
const transcripts=[];
let conservationErrors=0, strayDraws=0, handsPlayed=0, splitHalfSessions=0;

const recordTranscript=(G)=>{
  const S=G.S;
  transcripts.push(
    `=== hand ${S.handNum} ===\n`+
    S.log.map(l=>l.text).join('\n')+'\n'+
    S.decisions.map(d=>`  [${d.name} ${d.street} ${d.action}] ${d.reason}`).join('\n'));
};

for(let s=0;s<SESSIONS;s++){
  const h=make(checkFoldHero, {seed:`${SEED}|s${s}`});
  h.G.newSession(); h.drain(); // plays hand 1
  if(s===0) recordTranscript(h.G);
  let mid=null, lastHands=h.G.session.hands;
  while(h.G.session.hands<HANDS && !h.G.session.over){
    h.G.newHand(); h.drain();
    if(h.G.session.hands===lastHands) break; // gameOver returned before dealing; S is stale
    lastHands=h.G.session.hands;
    if(h.G.roster.reduce((a,p)=>a+p.stack,0)!==1200) conservationErrors++;
    if(h.G.session.hands===Math.floor(HANDS/2)) mid=snapReads(h.G);
    if(s===0 && h.G.session.hands<=30) recordTranscript(h.G);
  }
  handsPlayed+=h.G.session.hands; // engine truth, includes the newSession hand
  strayDraws+=h.state.strayDraws;
  const end=snapReads(h.G);
  if(mid) splitHalfSessions++;
  for(const e of end){
    const m=mid && mid.find(x=>x.tag===e.tag);
    perTag[e.tag]=perTag[e.tag]||{full:[]};
    perTag[e.tag].full.push(rates(e.reads));
    addTo(pooledTag, e.tag, e.reads);
    if(m){
      addTo(pooledFirst, e.tag, m.reads);
      addTo(pooledSecond, e.tag, diffReads(e.reads, m.reads));
    }
  }
}

if(handsPlayed===0) fatal('0 hands played — refusing to overwrite outputs');

const agg=(list,key)=>{
  const xs=list.map(r=>r[key]).filter(x=>x!=null);
  if(!xs.length) return null;
  const mean=xs.reduce((a,b)=>a+b,0)/xs.length;
  const sd=Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,xs.length-1));
  return {mean:+mean.toFixed(3), sd:+sd.toFixed(3), n:xs.length};
};
const KEYS=['vpip','pfr','f2bet','threeBet','f2cbet','af'];
const report={config:{sessions:SESSIONS, hands:HANDS, seed:SEED},
  handsPlayed, conservationErrors, strayDraws, splitHalfSessions, personas:{}};
if(splitHalfSessions!==SESSIONS)
  console.log(`NOTE: split-half covers ${splitHalfSessions}/${SESSIONS} sessions (some ended before the midpoint)`);
for(const [tag,d] of Object.entries(perTag)){
  const pooled=rates(pooledTag[tag]);
  const firstR=pooledFirst[tag]? rates(pooledFirst[tag]) : {};
  const secondR=pooledSecond[tag]? rates(pooledSecond[tag]) : {};
  report.personas[tag]={pooled}; // pooled counters are the band reference
  for(const k of KEYS){
    // split-half from POOLED half-counters, not means of per-session ratios —
    // small per-session denominators otherwise dominate the delta
    const a=firstR[k], b=secondR[k];
    report.personas[tag][k]={
      full:agg(d.full,k),
      pooledFirstHalf:a==null?null:+a.toFixed(3),
      pooledSecondHalf:b==null?null:+b.toFixed(3),
      splitHalfDelta:(a!=null&&b!=null)? +Math.abs(a-b).toFixed(3) : null,
    };
  }
}

const outDir=path.join(__dirname,'out');
fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'baseline-metrics.json'), JSON.stringify(report,null,2));
fs.writeFileSync(path.join(outDir,'baseline-transcripts.txt'),
  `# baseline arm — seed "${SEED}", ${SESSIONS} sessions x ${HANDS} hands\n\n`+transcripts.join('\n\n'));

console.log(`baseline arm: ${handsPlayed} hands, ${SESSIONS} sessions, seed "${SEED}"`);
if(conservationErrors) console.log(`BUG chips drifted in ${conservationErrors} hands`);
if(strayDraws) console.log(`BUG ${strayDraws} RNG draws outside expected windows`);
console.log('\npersona (pooled)   vpip    pfr   f2bet  3bet   f2cbet  AF     split-half max delta');
for(const [tag,p] of Object.entries(report.personas)){
  const f=(k)=>{const v=p.pooled[k]; return (v==null?'  -   ':String(+v.toFixed(3)).padEnd(6));};
  const maxDelta=Math.max(...KEYS.map(k=>p[k].splitHalfDelta??0));
  console.log(`  ${tag.padEnd(12)} ${f('vpip')} ${f('pfr')} ${f('f2bet')} ${f('threeBet')} ${f('f2cbet')} ${f('af')} ${maxDelta.toFixed(3)}`);
}
console.log(`\nwrote exp/out/baseline-metrics.json and baseline-transcripts.txt`);
