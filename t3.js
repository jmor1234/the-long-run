const fs=require('fs');
const make=require('./harness');
console.log('TEST 3 — can a bot see your cards?\n');

// (a) static: does the decision code mention the hero at all?
const html=fs.readFileSync('./poker-trainer.html','utf8');
const body=html.slice(html.indexOf('function _botDecide')>-1?html.indexOf('function _botDecide'):html.indexOf('function botDecide'),
                      html.indexOf('/* ============================================================\n   GAME STATE'));
const banned=[/isHero/,/players\s*\[\s*0\s*\]/,/\bhero\b/i,/\bS\./];
const hits=banned.filter(re=>re.test(body));
console.log(`  ${hits.length?'FAIL':'ok  '} decision code contains no reference to you or to global game state`);
if(hits.length) console.log('    offending patterns:',hits.map(String).join(', '));

// (b) runtime: trap every OTHER seat's hole cards while a bot is deciding
const heroPolicy=(G)=>{
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  const r=Math.random();
  const d = toCall>0 ? (r<0.5?{action:'call'}:{action:'fold'})
                     : (r<0.6?{action:'check'}:{action:'bet',amount:hero.bet+Math.max(2,Math.round(S.pot*0.6))});
  G.applyAction(hero,d); S.toAct=G.nextToAct(S.toAct); G.step();
};
const {G,drain,state}=make(heroPolicy);
let peeks=0, handsWatched=0, ctxLeaks=0;
G.newSession(); drain();

for(let i=0;i<1200;i++){
  if(G.session.over){ G.newSession(); drain(); }
  G.newHand();
  if(G.session.over) continue;
  for(const p of G.S.players){
    const real=p.cards;
    p.cards=new Proxy(real,{
      get(t,k,receiver){
        if(state.inBot && state.lastBotCtx && receiver!==state.lastBotCtx.myCards){
          if(k==='0'||k==='1'||k==='length'||k===Symbol.iterator) peeks++;
        }
        return t[k];
      }
    });
  }
  drain();
  if(state.lastBotCtx){
    const ctx=state.lastBotCtx;
    const foreign=Object.entries(ctx).filter(([k,v])=>{
      if(k==='myCards') return false;
      if(Array.isArray(v) && v.length===2 && v[0] && v[0].r!=null && v[0].s!=null) return true;
      return false;
    });
    if(foreign.length) ctxLeaks++;
  }
  handsWatched++;
}
console.log(`  ${peeks?'FAIL':'ok  '} ${handsWatched} hands watched live — other seats' cards were read ${peeks} times during a bot's decision`);
console.log(`  ${ctxLeaks?'FAIL':'ok  '} botDecide ctx never carried another player's hole cards (${ctxLeaks} leaks)`);

// (c) the bots must still be reading their OWN cards (proves the trap works)
const {G:G2,drain:drain2,state:st2}=make(heroPolicy);
let ownReads=0;
G2.newSession();
const bot=G2.S.players[1];
bot.cards=new Proxy(bot.cards,{get(t,k){ if(st2.inBot) ownReads++; return t[k]; }});
drain2();
console.log(`  ${ownReads>0?'ok  ':'FAIL'} control: a bot read its own cards ${ownReads} times, so the trap is live`);
process.exitCode=(hits.length||peeks||ctxLeaks||!(ownReads>0))?1:0;
