// Baseline arm: coded bots through the experiment metrics pipeline.
// Produces the reference numbers the pass criteria get pre-registered against
// (persona frequency bands, split-half deltas) plus blind-able transcripts.
//
//   node exp/run-baseline.js [--sessions 12] [--hands 120] [--seed exp1]
//
// Output: exp/out/baseline-metrics.json, exp/out/baseline-transcripts.txt

const fs=require('fs');
const path=require('path');
const make=require('./exp-harness');

const args=Object.fromEntries(process.argv.slice(2).map((a,i,arr)=>
  a.startsWith('--')?[a.slice(2), arr[i+1]]:[]).filter(x=>x.length));
const SESSIONS=+(args.sessions||12);
const HANDS=+(args.hands||120);
const SEED=args.seed||'exp1';

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
  af:(rd.agg+rd.passive)>0? rd.agg/Math.max(1,rd.passive) : null,
  hands:rd.hands, vpipOpps:rd.vpipOpps, f2betOpps:rd.foldToBetOpps,
});

const perTag={}; // tag -> {first:[], second:[], full:[]}
const transcripts=[];
let conservationErrors=0, strayDraws=0, handsPlayed=0;

for(let s=0;s<SESSIONS;s++){
  const h=make(checkFoldHero, {seed:`${SEED}|s${s}`});
  h.G.newSession(); h.drain();
  let mid=null;
  for(let i=0;i<HANDS && !h.G.session.over;i++){
    h.G.newHand(); h.drain();
    handsPlayed++;
    if(h.G.roster.reduce((a,p)=>a+p.stack,0)!==1200) conservationErrors++;
    if(i===Math.floor(HANDS/2)-1) mid=snapReads(h.G);
    if(s===0 && i<30){ // transcript sample for the blind feel test
      const S=h.G.S;
      transcripts.push(
        `=== hand ${i+1} ===\n`+
        S.log.map(l=>l.text).join('\n')+'\n'+
        S.decisions.map(d=>`  [${d.name} ${d.street} ${d.action}] ${d.reason}`).join('\n'));
    }
  }
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
  }
}

// aggregate: pool counters is more correct than averaging small-sample rates,
// but per-session rates are what split-half agreement needs; report both views
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
  report.personas[tag]={};
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
fs.writeFileSync(path.join(outDir,'baseline-transcripts.txt'), transcripts.join('\n\n'));

console.log(`baseline arm: ${handsPlayed} hands, ${SESSIONS} sessions, seed "${SEED}"`);
if(conservationErrors) console.log(`BUG chips drifted in ${conservationErrors} hands`);
if(strayDraws) console.log(`BUG ${strayDraws} RNG draws outside expected windows`);
console.log('\npersona            vpip    pfr   f2bet  3bet   f2cbet  AF     split-half max delta');
for(const [tag,p] of Object.entries(report.personas)){
  const f=(k)=>p[k].full? String(p[k].full.mean).padEnd(6):'  -   ';
  const maxDelta=Math.max(...KEYS.map(k=>p[k].splitHalfDelta??0));
  console.log(`  ${tag.padEnd(12)} ${f('vpip')} ${f('pfr')} ${f('f2bet')} ${f('threeBet')} ${f('f2cbet')} ${f('af')} ${maxDelta.toFixed(3)}`);
}
console.log(`\nwrote exp/out/baseline-metrics.json and baseline-transcripts.txt`);
