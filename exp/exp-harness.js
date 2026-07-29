// Experiment harness: like ../harness.js, plus seeded RNG streams and a
// decision hook. The engine stays synchronous; LLM arms use the oracle
// (see oracle.js) which answers from cache or aborts the session for replay.
//
// Streams (all keyed, order-independent):
//   session  — button seat draw at newSession
//   deal|k   — deck shuffle for hand k (identical across arms at same seed)
//   dec|k|i  — decision i of hand k: policy rolls + equity Monte Carlo
// Draws outside those windows land on a counting guard stream (should be 0).

const fs=require('fs');
const path=require('path');
const {stream}=require('./prng');

const html=fs.readFileSync(path.join(__dirname,'..','poker-trainer.html'),'utf8');
let baseSrc=html.match(/<script>\n"use strict";([\s\S]*?)<\/script>/)[1];

// Every rewrite must actually land; silent no-ops corrupt results (see ARCHITECTURE §9).
function mustReplace(src, from, to, label){
  const out=src.replace(from, to);
  if(out===src) throw new Error('exp-harness: rewrite failed: '+label);
  return out;
}

let src=baseSrc;
src=mustReplace(src, 'if(p.isHero){ renderActions(); return; }',
  'if(p.isHero){ HERO_ACT(); return; }', 'hero hook');
src=mustReplace(src, 'function botDecide(ctx){',
  'function botDecide(ctx){ return __DECIDE(ctx, _botDecide); }\nfunction _botDecide(ctx){',
  'botDecide wrap');
src=mustReplace(src, /updateSession\(\);\s*new(Hand|Session)\(\);\s*$/, '', 'bootstrap strip');
src=mustReplace(src, 'function newSession(){', 'function newSession(){ __STREAM("session");',
  'newSession stream hook');
src=mustReplace(src, 'function newHand(){', 'function newHand(){ __STREAM("deal");',
  'newHand stream hook');

// Route all engine randomness through the injected generator.
{
  const n=src.split('Math.random()').length-1;
  if(n!==5) throw new Error('exp-harness: expected 5 Math.random() sites, found '+n+
    ' — poker-trainer.html changed; re-audit stream assignment');
  src=src.split('Math.random()').join('__RAND()');
}

src+='\nreturn {newHand, newSession, get roster(){return roster}, botDecide, pctOf, strengthVsRandom, openThreshold, posName, behindCount, get S(){return S}, get session(){return session}, applyAction, nextToAct, step, buildPots, evaluate, cmpHand, handStr, START, BB, SB, clampFreq, freshReads, shrinkReads, readLabel, BOT_STYLES, sampleTier};';

function fakeEl(){return{style:{},className:'',innerHTML:'',textContent:'',value:'',disabled:false,onclick:null,
 scrollTop:0,scrollHeight:0,classList:{add(){},remove(){},toggle(){}},appendChild(){},removeChild(){},
 querySelectorAll:()=>[],querySelector:()=>null,focus(){},select(){},setAttribute(){},remove(){}};}

// opts: { seed: string, decide: null | (ctx, meta, fallthrough) => decision }
// decide=null runs the coded policy (baseline arm) under the decision stream.
module.exports=function make(heroPolicy, opts={}){
  const seed=opts.seed==null?'default':String(opts.seed);
  const els={};
  const document={getElementById:id=>els[id]||(els[id]=fakeEl()),createElement:()=>fakeEl(),
   body:{appendChild(){},removeChild(){}},execCommand:()=>true};

  const queue=[];
  const state={hand:0, decision:0, sessions:0, strayDraws:0, lastBotCtx:null};

  let strayGen=stream(seed+'|stray');
  let gen=strayGen;
  const guard=()=>{ state.strayDraws++; return strayGen(); };
  gen=guard;

  const __RAND=()=>gen();
  const __STREAM=(kind)=>{
    if(kind==='session'){ state.sessions++; state.hand=0; gen=stream(`${seed}|session|${state.sessions}`); }
    else if(kind==='deal'){ state.hand++; state.decision=0; gen=stream(`${seed}|deal|${state.hand}`); }
  };
  const __DECIDE=(ctx, fall)=>{
    const meta={hand:state.hand, index:state.decision++};
    state.lastBotCtx=ctx;
    gen=stream(`${seed}|dec|${meta.hand}|${meta.index}`);
    try{
      return opts.decide ? opts.decide(ctx, meta, fall) : fall(ctx);
    } finally {
      gen=guard; // no engine draws are expected between decisions
    }
  };

  const HERO_ACT=()=>heroPolicy(G,state);
  const G=new Function('document','navigator','setTimeout','HERO_ACT','__RAND','__STREAM','__DECIDE','window',
    '"use strict";'+src)(document,{},fn=>queue.push(fn),HERO_ACT,__RAND,__STREAM,__DECIDE,{});
  const drain=(stop)=>{let n=0; while(queue.length && n++<500000){ if(stop && stop()) return; queue.shift()(); }};
  return {G,drain,state,queue};
};
