const fs=require('fs');
const make=require('./harness');
console.log('TEST 3 — can a bot see your cards?\n');

// (a) static: does the decision code mention the hero at all?
const html=fs.readFileSync('./poker-trainer.html','utf8');
const decisionStart=html.indexOf('const botDecide=function(ctx){');
const body=html.slice(decisionStart,
  html.indexOf('/* ============================================================\n   GAME STATE'));
const banned=[/isHero/,/players\s*\[\s*0\s*\]/,/\bhero\b/i,/\bS\./];
const hits=banned.filter(re=>re.test(body));
console.log(`  ${decisionStart<0||hits.length?'FAIL':'ok  '} decision code contains no reference to you or to global game state`);
if(hits.length) console.log('    offending patterns:',hits.map(String).join(', '));

// (b) runtime: trap every OTHER seat's hole cards while a bot is deciding
const heroPolicy=(G)=>{
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  const view=G.legalActionView(hero);
  const r=Math.random();
  const d = toCall>0 ? (r<0.5?{action:'call'}:{action:'fold'})
                     : (r<0.6||!view.aggressive?{action:'check'}:
                       {action:view.aggressive.action,amount:Math.max(view.aggressive.minBetTo,
                         Math.min(view.aggressive.maxBetTo,S.currentBet+Math.max(2,Math.round(S.pot*0.6))))});
  G.applyAction(hero,{...d,actionSeq:view.actionSeq}); S.toAct=G.nextToAct(S.toAct); G.step();
};
const {G,drain,state}=make(heroPolicy);
let peeks=0, policyBPeeks=0, handsWatched=0, contextsChecked=0,
  ctxLeaks=0, descriptorLeaks=0, publicProjectionLeaks=0;
let policyBWatch=false, policyBCtx=null,detachCase=null;
let publicDetachCase=null;
G.newSession(); drain();

for(let i=0;i<1200;i++){
  if(G.session.over){
    G.newSession(); drain();
    state.botContexts.length=0;
    state.botObservations.length=0;
  }
  const ctxStart=state.botContexts.length;
  G.newHand();
  if(G.session.over) continue;
  for(const p of G.S.players){
    const real=p.cards;
    p.cards=new Proxy(real,{
      get(t,k,receiver){
        const watched=state.inBot?state.lastBotCtx:(policyBWatch?policyBCtx:null);
        if(watched && receiver!==watched.myCards){
          if(k==='0'||k==='1'||k==='length'||k===Symbol.iterator){
            if(policyBWatch) policyBPeeks++;
            else peeks++;
          }
        }
        return t[k];
      }
    });
  }
  drain();
  for(const observation of state.botObservations.slice(ctxStart)){
    const {ctx}=observation;
    contextsChecked++;
    if(ctx.street!=='preflop' && !ctx.legal.layeredEquity) policyBCtx=ctx;
    if(!detachCase && ctx.opponents.some(o=>o.bets.length)) detachCase={ctx,
      players:G.S.players.slice(),before:JSON.stringify(G.S.players.map(p=>p.range))};
    const foreign=Object.entries(ctx).filter(([k,v])=>{
      if(k==='myCards') return false;
      if(Array.isArray(v) && v.length===2 && v[0] && v[0].r!=null && v[0].s!=null) return true;
      return false;
    });
    if(foreign.length) ctxLeaks++;
    const boardKey=c=>`${c.r}${c.s}`;
    const publicBoard=G.S.board.map(boardKey);
    const validPublicLine=Array.isArray(ctx.publicActions) &&
      JSON.stringify(ctx.publicActions)===JSON.stringify(observation.publicActions);
    const validPublicCounts=ctx.tableSize===observation.tableSize &&
      ctx.opponents.length===observation.liveOpponents &&
      ctx.playerName===observation.playerName;
    if(!validPublicLine || !validPublicCounts) publicProjectionLeaks++;
    if(!publicDetachCase && validPublicLine) publicDetachCase={ctx,log:G.S.log,
      before:JSON.stringify(G.S.log)};
    const valid=Array.isArray(ctx.opponents) && ctx.opponents.every(o=>
      o && Object.keys(o).sort().join(',')==='bets,cap' &&
      typeof o.cap==='number' && Array.isArray(o.bets) && o.bets.every(eventBoard=>
        Array.isArray(eventBoard) && eventBoard.length>=3 && eventBoard.length<=5 &&
        eventBoard.every(c=>c && Object.keys(c).sort().join(',')==='r,s' &&
          Number.isInteger(c.r) && typeof c.s==='string') &&
        eventBoard.map(boardKey).every((c,j)=>publicBoard[j]===c)));
    if(!valid) descriptorLeaks++;
  }
  handsWatched++;
}
console.log(`  ${peeks?'FAIL':'ok  '} ${handsWatched} hands watched live — other seats' cards were read ${peeks} times during a bot's decision`);
console.log(`  ${ctxLeaks?'FAIL':'ok  '} botDecide ctx never carried another player's hole cards (${ctxLeaks} leaks)`);
console.log(`  ${descriptorLeaks?'FAIL':'ok  '} ${contextsChecked} bot contexts contain only cap and cloned public board prefixes (${descriptorLeaks} leaks)`);
console.log(`  ${publicProjectionLeaks?'FAIL':'ok  '} public action, actor, table, and opponent snapshots exactly match the decision-time view (${publicProjectionLeaks} leaks)`);

policyBWatch=true;
G.botPolicyV2(policyBCtx);
policyBWatch=false;
console.log(`  ${policyBPeeks?'FAIL':'ok  '} direct Policy B read other seats' cards ${policyBPeeks} times`);

const detachedOpponent=detachCase.ctx.opponents.find(o=>o.bets.length);
detachedOpponent.cap=-1;
detachedOpponent.bets[0][0].r=-1;
const detached=detachCase.before===JSON.stringify(detachCase.players.map(p=>p.range));
console.log(`  ${detached?'ok  ':'FAIL'} opponent descriptors are detached from engine range records`);
publicDetachCase.ctx.publicActions[0]='poisoned';
const publicDetached=publicDetachCase.before===JSON.stringify(publicDetachCase.log);
console.log(`  ${publicDetached?'ok  ':'FAIL'} public action snapshots are detached from the visible hand log`);

// (c) the bots must still be reading their OWN cards (proves the trap works)
const {G:G2,drain:drain2,state:st2}=make(heroPolicy);
let ownReads=0;
G2.newSession();
const bot=G2.S.players[1];
bot.cards=new Proxy(bot.cards,{get(t,k){ if(st2.inBot) ownReads++; return t[k]; }});
drain2();
console.log(`  ${ownReads>0?'ok  ':'FAIL'} control: a bot read its own cards ${ownReads} times, so the trap is live`);
process.exitCode=(decisionStart<0||hits.length||peeks||policyBPeeks||ctxLeaks||
  descriptorLeaks||publicProjectionLeaks||!detached||!publicDetached||!(ownReads>0))?1:0;
