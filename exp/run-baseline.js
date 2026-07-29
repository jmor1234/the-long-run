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

const args=parseArgs(process.argv.slice(2));
const SESSIONS=args.sessions===undefined?12:+args.sessions;
const HANDS=args.hands===undefined?120:+args.hands;
const SEED=args.seed||'exp1';
if(!Number.isInteger(SESSIONS) || SESSIONS<1) fatal(`--sessions must be a positive integer, got "${args.sessions}"`);
if(!Number.isInteger(HANDS) || HANDS<2) fatal(`--hands must be an integer >= 2, got "${args.hands}"`);

const checkFoldHero=(G)=>{
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  G.applyAction(hero, toCall>0?{action:'fold'}:{action:'check'});
  S.toAct=G.nextToAct(S.toAct);
  G.step();
};

const snapReads=(G)=>G.roster.filter(r=>r.style).map(r=>({
  tag:r.style.tag, reads:JSON.parse(JSON.stringify(r.reads)),
}));
const rate=(y,o)=>o>0? y/o : null;
const diffReads=(end,mid)=>{ // second-half raw counters
  const d={};
  for(const k of Object.keys(end)) d[k]=end[k]-(mid?mid[k]:0);
  return d;
};
const rates=(rd)=>({
  vpip:rate(rd.vpip,rd.vpipOpps), pfr:rate(rd.pfr,rd.pfrOpps),
  f2bet:rate(rd.foldToBet,rd.foldToBetOpps), threeBet:rate(rd.threeBet,rd.threeBetOpps),
  f2cbet:rate(rd.foldToCbet,rd.foldToCbetOpps),
  af:rd.passive>0? rd.agg/rd.passive : null, // null, not a count, when never passive
});

const perTag={};        // tag -> {first:[], second:[], full:[]}  per-session rates
const pooledTag={};     // tag -> summed raw counters across sessions (band reference)
const transcripts=[];
let conservationErrors=0, strayDraws=0, handsPlayed=0;

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
  for(const e of end){
    const m=mid && mid.find(x=>x.tag===e.tag);
    perTag[e.tag]=perTag[e.tag]||{first:[],second:[],full:[]};
    perTag[e.tag].full.push(rates(e.reads));
    if(m){
      perTag[e.tag].first.push(rates(m.reads));
      perTag[e.tag].second.push(rates(diffReads(e.reads,m.reads)));
    }
    pooledTag[e.tag]=pooledTag[e.tag]||{};
    for(const [k,v] of Object.entries(e.reads))
      pooledTag[e.tag][k]=(pooledTag[e.tag][k]||0)+v;
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
  handsPlayed, conservationErrors, strayDraws, personas:{}};
for(const [tag,d] of Object.entries(perTag)){
  const pooled=rates(pooledTag[tag]);
  report.personas[tag]={pooled}; // pooled counters are the band reference
  for(const k of KEYS){
    report.personas[tag][k]={
      full:agg(d.full,k), firstHalf:agg(d.first,k), secondHalf:agg(d.second,k),
      splitHalfDelta:(()=>{
        const a=agg(d.first,k), b=agg(d.second,k);
        return a&&b? +Math.abs(a.mean-b.mean).toFixed(3) : null;
      })(),
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
