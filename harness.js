const fs=require('fs');
const {replaceExactlyOnce,extractEngineSource,stripEngineBootstrap}=require('./harness-transform');
const html=fs.readFileSync('./poker-trainer.html','utf8');

function buildSrc(htmlText){
  let src=extractEngineSource(htmlText);
  src=replaceExactlyOnce(src, 'if(p.isHero){ renderActions(); return; }',
    'if(p.isHero){ HERO_ACT(); return; }', 'hero hook');
  // Wrap botDecide so tests can detect any hole-card read during a decision.
  src=replaceExactlyOnce(src,
    /const botDecide=function\(ctx\)\{\s*return botPolicyV1\(ctx\);\s*\};/,
    'const _botDecide=function(ctx){ return botPolicyV1(ctx); };\nconst botDecide=function(ctx){ BOTFLAG(true); SETCTX(ctx); try{ return _botDecide(ctx); } finally { BOTFLAG(false); } };',
    'botDecide wrap');
  src=replaceExactlyOnce(src,
    'function equity(mine, board, opps_, iters){',
    'function equity(mine, board, opps_, iters){ EQUITY_CTX(opps_);',
    'equity hook');
  src=stripEngineBootstrap(src);
  src+='\nreturn {newHand, newSession, get roster(){return roster}, botDecide, botPolicyV1, botPolicyV2, pctOf, betLikelihood, equity, strengthVsRandom, rangeSnapshot, openThreshold, posName, behindCount, get S(){return S}, get session(){return session}, callPrice, legalActionView, policyActionForView, applyAction, nextToAct, step, updateStrip, renderActions, buildPots, endHand, evaluate, cmpHand, handStr, START, BB, SB, clampFreq, freshReads, shrinkReads, readLabel, BOT_STYLES, sampleTier};';
  return src;
}

const src=buildSrc(html);

function fakeEl(){
  const el={style:{},className:'',textContent:'',value:'',disabled:false,onclick:null,children:[],
    scrollTop:0,scrollHeight:0,classList:{add(){},remove(){},toggle(){}},
    appendChild(child){this.children.push(child);},removeChild(){},
    querySelectorAll:()=>[],querySelector:()=>null,focus(){},select(){},setAttribute(){},remove(){}};
  let html='';
  Object.defineProperty(el,'innerHTML',{get(){return html;},set(v){html=v;if(v==='')el.children=[];}});
  return el;
}
const els={};
const document={getElementById:id=>els[id]||(els[id]=fakeEl()),createElement:()=>fakeEl(),
 body:{appendChild(){},removeChild(){}},execCommand:()=>true};

function make(heroPolicy){
  const queue=[];
  const state={inBot:false, leaks:[], lastBotCtx:null, botContexts:[], lastEquityOpps:null};
  const BOTFLAG=v=>{state.inBot=v;};
  const SETCTX=c=>{state.lastBotCtx=c;state.botContexts.push(c);};
  const EQUITY_CTX=opps=>{state.lastEquityOpps=opps.map(o=>typeof o==='number'?o:{
    cap:o.cap,bets:(o.bets||[]).map(board=>board.map(c=>({r:c.r,s:c.s})))
  });};
  const HERO_ACT=()=>heroPolicy(G,state);
  const G=new Function('document','navigator','setTimeout','HERO_ACT','BOTFLAG','SETCTX','EQUITY_CTX','window',
    '"use strict";'+src)(document,{},fn=>queue.push(fn),HERO_ACT,BOTFLAG,SETCTX,EQUITY_CTX,{});
  const drain=()=>{let n=0; while(queue.length && n++<500000) queue.shift()();};
  return {G,drain,state,queue,els};
}
make.buildSrc=buildSrc;
module.exports=make;
