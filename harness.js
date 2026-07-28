const fs=require('fs');
const html=fs.readFileSync('./poker-trainer.html','utf8');
let src=html.match(/<script>\n"use strict";([\s\S]*?)<\/script>/)[1];

src=src.replace('if(p.isHero){ renderActions(); return; }','if(p.isHero){ HERO_ACT(); return; }');
// wrap botDecide so we can detect any read of hole cards during a bot decision
src=src.replace('function botDecide(ctx){',
  'function botDecide(ctx){ BOTFLAG(true); SETCTX(ctx); try{ return _botDecide(ctx); } finally { BOTFLAG(false); } }\nfunction _botDecide(ctx){');
if(!src.includes('function _botDecide(ctx){')) throw new Error('harness: botDecide wrap failed');
src=src.replace(/updateSession\(\);\s*new(Hand|Session)\(\);\s*$/,'');
src+='\nreturn {newHand, newSession, get roster(){return roster}, botDecide, pctOf, strengthVsRandom, openThreshold, posName, behindCount, get S(){return S}, get session(){return session}, applyAction, nextToAct, step, buildPots, evaluate, cmpHand, handStr, START, BB, SB, clampFreq, freshReads, shrinkReads, readLabel, BOT_STYLES};';

function fakeEl(){return{style:{},className:'',innerHTML:'',textContent:'',value:'',disabled:false,onclick:null,
 scrollTop:0,scrollHeight:0,classList:{add(){},remove(){},toggle(){}},appendChild(){},removeChild(){},
 querySelectorAll:()=>[],querySelector:()=>null,focus(){},select(){},setAttribute(){},remove(){}};}
const els={};
const document={getElementById:id=>els[id]||(els[id]=fakeEl()),createElement:()=>fakeEl(),
 body:{appendChild(){},removeChild(){}},execCommand:()=>true};

module.exports=function make(heroPolicy){
  const queue=[];
  const state={inBot:false, leaks:[], lastBotCtx:null};
  const BOTFLAG=v=>{state.inBot=v;};
  const SETCTX=c=>{state.lastBotCtx=c;};
  const HERO_ACT=()=>heroPolicy(G,state);
  const G=new Function('document','navigator','setTimeout','HERO_ACT','BOTFLAG','SETCTX','window',
    '"use strict";'+src)(document,{},fn=>queue.push(fn),HERO_ACT,BOTFLAG,SETCTX,{});
  const drain=()=>{let n=0; while(queue.length && n++<500000) queue.shift()();};
  return {G,drain,state,queue};
};
