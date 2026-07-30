// Step-4 feel packet: blind, paired transcript blocks for criterion 6's
// early read. No API calls — the LLM arm replays entirely from the pilot's
// persisted decisions (a cache miss aborts loudly rather than spending).
//
//   node exp/run-feel.js
//
// Both arms play the SAME seeds, so every pair shares identical cards and
// differs only in decisions. Blocks are shuffled deterministically and
// labelled with letters; the arm-to-letter mapping goes to feel-key.json,
// which the judge must not open until every block is marked. Scoring (from
// PLAN.md): mark each block human or mechanical; the LLM arm must win a
// strict majority of the pairs (win = LLM block marked human AND its paired
// coded block marked mechanical).

const fs=require('fs');
const path=require('path');
const make=require('./exp-harness');
const {makeOracle}=require('./oracle');
const {stream}=require('./prng');

// Prefer the tracked archive (survives clones and cleaned scratch dirs); the
// gitignored out/ copy only exists right after a fresh pilot run.
const PILOT_JSONL=[path.join(__dirname,'ref','pilot-api-pilot1.jsonl'),
                   path.join(__dirname,'out','pilot-api-pilot1.jsonl')]
  .find(p=>fs.existsSync(p)) || path.join(__dirname,'ref','pilot-api-pilot1.jsonl');
const SESSION_SEEDS=['pilot1|s0','pilot1|s1'];
const RANGES=[[1,30],[31,60]]; // two 30-hand blocks per 75-hand session

function fatal(msg){ console.error('run-feel: '+msg); process.exit(1); }

if(!fs.existsSync(PILOT_JSONL)) fatal('no pilot records at '+PILOT_JSONL+' — run the pilot first');
const cache=new Map();
for(const line of fs.readFileSync(PILOT_JSONL,'utf8').split('\n').filter(Boolean)){
  const rec=JSON.parse(line);
  if(rec.type!=='header') cache.set(rec.key, {ctxJson:rec.ctxJson, d:rec.d});
}

const checkFoldHero=(G)=>{
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  G.applyAction(hero, toCall>0?{action:'fold'}:{action:'check'});
  S.toAct=G.nextToAct(S.toAct);
  G.step();
};

// Same rendering as run-baseline.js transcripts, so the only difference a
// judge can see between arms is play and reasons, never formatting.
const renderHand=(G)=>{
  const S=G.S;
  return `--- hand ${S.handNum} ---\n`+
    S.log.map(l=>l.text).join('\n')+'\n'+
    S.decisions.map(d=>`  [${d.name} ${d.street} ${d.action}] ${d.reason}`).join('\n');
};

// arm: 'llm' replays the pilot cache; 'coded' runs the shipped policies.
function playSession(seed, arm){
  const decide=arm==='llm'
    ? makeOracle({cache, pending:[], scope:String(seed)})
    : null;
  const h=make(checkFoldHero, {seed, decide});
  const hands=[];
  try{
    h.G.newSession(); h.drain();
    hands.push(renderHand(h.G));
    let lastHands=h.G.session.hands;
    while(h.G.session.hands<75 && !h.G.session.over){
      h.G.newHand(); h.drain();
      if(h.G.session.hands===lastHands) break;
      lastHands=h.G.session.hands;
      hands.push(renderHand(h.G));
    }
  }catch(e){
    if(e.isOracleAbort) fatal('pilot cache is missing a decision ('+e.key+') — refusing to spend; re-run the pilot');
    throw e;
  }
  if(h.state.strayDraws) fatal('stray RNG draws during replay — transcripts untrustworthy');
  return hands;
}

const blocks=[]; // {pair, arm, text}
for(let s=0;s<SESSION_SEEDS.length;s++){
  const seed=SESSION_SEEDS[s];
  const llm=playSession(seed,'llm');
  const coded=playSession(seed,'coded');
  for(const [from,to] of RANGES){
    if(llm.length<to || coded.length<to) fatal(`session ${seed} has fewer than ${to} hands`);
    const pair=`s${s}:${from}-${to}`;
    blocks.push({pair, arm:'llm',   text:llm.slice(from-1,to).join('\n\n')});
    blocks.push({pair, arm:'coded', text:coded.slice(from-1,to).join('\n\n')});
  }
}

// Deterministic shuffle from the keyed PRNG (no wall-clock, reproducible).
const rand=stream('feel1|shuffle');
for(let i=blocks.length-1;i>0;i--){
  const j=Math.floor(rand()*(i+1));
  [blocks[i],blocks[j]]=[blocks[j],blocks[i]];
}
const LETTERS='ABCDEFGH';
if(blocks.length!==LETTERS.length) fatal('expected exactly '+LETTERS.length+' blocks, got '+blocks.length);

const packet=[
  '# FEEL TEST PACKET — criterion 6 early read (step 4)',
  '#',
  '# 8 blocks of 30 hands each. Same table, same stakes; hero sits out',
  '# (check-fold). For EACH block, before looking at anything else, write',
  '# down: HUMAN (these opponents read like real people) or MECHANICAL',
  '# (these read like algorithms). Gut call after reading; no metrics,',
  '# no counting. Do not open feel-key.json until all 8 are marked.',
  '',
  ...blocks.map((b,i)=>`\n${'='.repeat(60)}\n=== BLOCK ${LETTERS[i]} ===\n${'='.repeat(60)}\n\n${b.text}`),
].join('\n');

const key={
  scoring:'pair won by LLM iff its llm block is marked HUMAN and its coded block MECHANICAL; strict majority of 4 pairs required',
  blocks:Object.fromEntries(blocks.map((b,i)=>[LETTERS[i],{arm:b.arm, pair:b.pair}])),
};

const outDir=path.join(__dirname,'out');
fs.writeFileSync(path.join(outDir,'feel-packet.txt'), packet);
fs.writeFileSync(path.join(outDir,'feel-key.json'), JSON.stringify(key,null,2));
console.log(`wrote exp/out/feel-packet.txt (${blocks.length} blocks, ${blocks.length/2} pairs) and feel-key.json (do not open)`);
