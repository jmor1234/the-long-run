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
const {replaceExactlyOnce,extractEngineSource,stripEngineBootstrap}=require('../harness-transform');

const DEFAULT_HTML=path.join(__dirname,'..','poker-trainer.html');
// Single source for the expected Math.random() site count (t-exp reads this
// export; README points here). Overridable per make() call ONLY for
// cross-version A/B runs (pre-C1 builds have 5: the shared roll and the limp
// draw were separate sites; C1 routed every decision draw through one helper).
// Current sites: deck shuffle, equity Monte Carlo, botDecide draw helper,
// button seat. All decision draws land inside the decision stream window.
const EXPECTED_RAND_SITES=4;
const POLICIES=Object.freeze(['dispatch','v1','v2']);
const resolvePolicy=(raw)=>{
  const policy=raw==null?'dispatch':String(raw);
  if(!POLICIES.includes(policy)) throw new Error('exp-harness: unknown policy '+policy);
  return policy;
};
const isChallengerOwned=(policy,detail)=>policy==='v2' && detail &&
  detail.street!=='preflop' && detail.view && !detail.view.layeredEquity;

// Every rewrite must actually land; silent no-ops corrupt results (see ARCHITECTURE §9).
const srcCache=new Map();
function buildSrc(htmlPath, expectedSites){
  const key=htmlPath+'|'+expectedSites;
  if(srcCache.has(key)) return srcCache.get(key);
  const html=fs.readFileSync(htmlPath,'utf8');
  let src=extractEngineSource(html, 'exp-harness');
  const hasPolicyV1=src.includes('const botPolicyV1=function(ctx){');
  const hasPolicyV2=src.includes('const botPolicyV2=function(ctx){');
  const policyArgs=hasPolicyV1 ? ', botPolicyV1'+(hasPolicyV2?', botPolicyV2':'') : '';
  src=replaceExactlyOnce(src, 'if(p.isHero){ renderActions(); return; }',
    'if(p.isHero){ HERO_ACT(); return; }', 'hero hook', 'exp-harness');
  if(hasPolicyV1){
    src=replaceExactlyOnce(src,
      /const botDecide=function\(ctx\)\{\s*return botPolicyV1\(ctx\);\s*\};/,
      `const _botDecide=function(ctx){ return botPolicyV1(ctx); };\nconst botDecide=function(ctx){ return __DECIDE(ctx, _botDecide${policyArgs}); };`,
      'botDecide wrap', 'exp-harness');
  } else {
    src=replaceExactlyOnce(src, 'function botDecide(ctx){',
      'function botDecide(ctx){ return __DECIDE(ctx, _botDecide); }\nfunction _botDecide(ctx){',
      'legacy botDecide wrap', 'exp-harness');
  }
  src=stripEngineBootstrap(src, 'exp-harness');
  src=replaceExactlyOnce(src, 'function newSession(){', 'function newSession(){ __STREAM("session");',
    'newSession stream hook', 'exp-harness');
  src=replaceExactlyOnce(src, 'function newHand(){', 'function newHand(){ __STREAM("deal");',
    'newHand stream hook', 'exp-harness');
  // Observe the trusted coded-policy adapter without changing it. Size fitting
  // is intentional; a rejected action or safe fallback is not.
  if(src.includes('const fitted=policyActionForView(view,d);')){
    src=replaceExactlyOnce(src,
      /const fitted=policyActionForView\(view,d\);\s*let result=applyAction\(p,\{\.\.\.fitted,actionSeq:view\.actionSeq\}\);/,
      'const fitted=policyActionForView(view,d);\n    __POLICY_ACTION("fit",d,fitted,{street:S.street,view});\n    let result=applyAction(p,{...fitted,actionSeq:view.actionSeq});',
      'policy fit observer', 'exp-harness');
    src=replaceExactlyOnce(src,
      /if\(!result\.ok\)\{\s*const safe=fallbackAction\(legalActionView\(p\)\);\s*if\(safe\) result=applyAction\(p,safe\);\s*\}/,
      'if(!result.ok){\n      __POLICY_ACTION("reject",d,fitted,{street:S.street,view,result});\n      const safe=fallbackAction(legalActionView(p));\n      if(safe){ __POLICY_ACTION("fallback",d,safe,{street:S.street,view}); result=applyAction(p,safe); }\n    }',
      'policy fallback observer', 'exp-harness');
  }
  // Extend ctx with the public betting state the legality normalizer needs.
  // Two anchor generations: post-all-in-cap files carry myBet themselves;
  // older builds (cross-version A/B arms) need it injected.
  if(src.includes('streetBets:S.streetBets||0, myBet:p.bet,')){
    src=replaceExactlyOnce(src, 'streetBets:S.streetBets||0, myBet:p.bet,',
      'streetBets:S.streetBets||0, myBet:p.bet, currentBet:S.currentBet, minRaise:S.minRaise,',
      'ctx betting-state extension', 'exp-harness');
  } else {
    src=replaceExactlyOnce(src, 'streetBets:S.streetBets||0,',
      'streetBets:S.streetBets||0, currentBet:S.currentBet, minRaise:S.minRaise, myBet:p.bet,',
      'ctx betting-state extension (legacy)', 'exp-harness');
  }

  // Route all engine randomness through the injected generator.
  const n=src.split('Math.random()').length-1;
  if(n!==expectedSites) throw new Error('exp-harness: expected '+expectedSites+
    ' Math.random() sites, found '+n+' in '+htmlPath+' — re-audit stream assignment');
  src=src.split('Math.random()').join('__RAND()');

  const moodExports=(src.includes('function moodStep') ? ', moodStep, moodDials' : '')
    +(src.includes('const VOICE=') ? ', VOICE, say' : '');
  const legalExports=src.includes('function legalActionView')
    ? ', legalActionView, policyActionForView' : '';
  const policyExports=hasPolicyV1?', botPolicyV1'+(hasPolicyV2?', botPolicyV2, rangeSnapshot':''):'';
  src+='\nreturn {newHand, newSession, get roster(){return roster}, botDecide, pctOf, strengthVsRandom, openThreshold, posName, behindCount, get S(){return S}, get session(){return session}'+legalExports+', applyAction, nextToAct, step, buildPots, evaluate, cmpHand, handStr, START, BB, SB, clampFreq, freshReads, shrinkReads, readLabel, BOT_STYLES, sampleTier'+moodExports+policyExports+'};';
  srcCache.set(key, src);
  return src;
}

function fakeEl(){return{style:{},className:'',innerHTML:'',textContent:'',value:'',disabled:false,onclick:null,
 scrollTop:0,scrollHeight:0,classList:{add(){},remove(){},toggle(){}},appendChild(){},removeChild(){},
 querySelectorAll:()=>[],querySelector:()=>null,focus(){},select(){},setAttribute(){},remove(){}};}

// opts: { seed, decide: null | (ctx, meta, fallthrough) => decision,
//         policy?: 'dispatch' | 'v1' | 'v2', captureDecisions?,
//         htmlPath?, expectedRandSites? (cross-version A/B only) }
// decide=null runs the coded policy (baseline arm) under the decision stream.
function make(heroPolicy, opts={}){
  const src=buildSrc(opts.htmlPath||DEFAULT_HTML,
    opts.expectedRandSites==null?EXPECTED_RAND_SITES:opts.expectedRandSites);
  const seed=opts.seed==null?'default':String(opts.seed);
  const els={};
  const document={getElementById:id=>els[id]||(els[id]=fakeEl()),createElement:()=>fakeEl(),
   body:{appendChild(){},removeChild(){}},execCommand:()=>true};

  const queue=[];
  const policy=resolvePolicy(opts.policy);
  if(policy!=='dispatch' && opts.decide)
    throw new Error('exp-harness: explicit policy cannot be combined with decide override');
  if(policy!=='dispatch' && !src.includes('__POLICY_ACTION("fit"'))
    throw new Error('exp-harness: explicit policy requires policy-action observation');
  const state={hand:0, decision:0, sessions:0, strayDraws:0, lastBotCtx:null,
    policy,
    policyFits:0, policyRejects:0, policyFallbacks:0,
    challengerRejects:0, challengerFallbacks:0, policyFailureSamples:[], decisionTrace:[]};

  let strayGen=stream(seed+'|stray');
  let gen=strayGen;
  const guard=()=>{ state.strayDraws++; return strayGen(); };
  gen=guard;

  const __RAND=()=>gen();
  const __STREAM=(kind)=>{
    if(kind==='session'){ state.sessions++; state.hand=0; gen=stream(`${seed}|session|${state.sessions}`); }
    else if(kind==='deal'){ state.hand++; state.decision=0; gen=stream(`${seed}|deal|${state.hand}`); }
  };
  const __DECIDE=(ctx, fall, policyV1, policyV2)=>{
    const meta={hand:state.hand, index:state.decision++};
    state.lastBotCtx=ctx;
    state.lastDraws=[];
    const g=stream(`${seed}|dec|${meta.hand}|${meta.index}`);
    gen=()=>{ const v=g(); state.lastDraws.push(v); return v; };
    try{
      let result;
      if(policy==='v1'){
        if(!policyV1) throw new Error('exp-harness: Policy A unavailable in this engine');
        result=policyV1(ctx);
      } else if(policy==='v2'){
        if(!policyV2) throw new Error('exp-harness: Policy B unavailable in this engine');
        result=policyV2(ctx);
      } else result=opts.decide ? opts.decide(ctx, meta, fall) : fall(ctx);
      if(opts.captureDecisions)
        state.decisionTrace.push({meta,result,draws:state.lastDraws.slice()});
      return result;
    } finally {
      gen=guard; // no engine draws are expected between decisions
    }
  };
  const __POLICY_ACTION=(event,raw,fitted,detail)=>{
    const challengerOwned=isChallengerOwned(policy,detail);
    if(event==='fit' && raw && fitted && raw.amount!==fitted.amount) state.policyFits++;
    else if(event==='reject'){
      state.policyRejects++;
      if(challengerOwned) state.challengerRejects++;
      if(state.policyFailureSamples.length<10)
        state.policyFailureSamples.push(JSON.parse(JSON.stringify({raw,fitted,detail})));
    }
    else if(event==='fallback'){
      state.policyFallbacks++;
      if(challengerOwned) state.challengerFallbacks++;
    }
  };

  const HERO_ACT=()=>heroPolicy(G,state);
  const G=new Function('document','navigator','setTimeout','HERO_ACT','__RAND','__STREAM','__DECIDE','__POLICY_ACTION','window',
    '"use strict";'+src)(document,{},fn=>queue.push(fn),HERO_ACT,__RAND,__STREAM,__DECIDE,__POLICY_ACTION,{});
  // A hand that cannot complete (e.g. an unnormalized `check` facing a bet)
  // loops forever; hitting the cap is a bug signal, never silent truncation.
  const drain=(stop)=>{
    let n=0;
    while(queue.length){
      if(stop && stop()) return;
      if(n++>=500000) throw new Error('exp-harness: drain exceeded 500k steps — hand stuck (unnormalized decision?)');
      queue.shift()();
    }
  };
  return {G,drain,state,queue};
}
make.EXPECTED_RAND_SITES=EXPECTED_RAND_SITES;
make.POLICIES=POLICIES;
make.resolvePolicy=resolvePolicy;
make.isChallengerOwned=isChallengerOwned;
module.exports=make;
