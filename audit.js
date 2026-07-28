const make=require('./harness');
console.log('AUDIT — hunting for rule and accounting bugs\n');
let fails=0;
const chk=(name,ok,detail)=>{ if(!ok)fails++; console.log(`  ${ok?'ok  ':'BUG '} ${name}${detail?'   '+detail:''}`); };

// ---- 1. VPIP must count preflop money only ----
{
  let street=null;
  const policy=(G)=>{
    const S=G.S,h=S.players[0],tc=S.currentBet-h.bet;
    // check preflop whenever possible, then bet postflop
    let d;
    if(S.street==='preflop') d = tc>0?{action:'fold'}:{action:'check'};
    else d = tc>0?{action:'call'}:{action:'bet',amount:h.bet+Math.max(2,Math.round(S.pot*0.5))};
    G.applyAction(h,d); S.toAct=G.nextToAct(S.toAct); G.step();
  };
  const {G,drain}=make(policy);
  G.newSession(); drain();
  for(let i=0;i<300;i++){ if(G.session.over){ G.newSession(); drain(); continue; } G.newHand(); drain(); }
  const vpip=G.session.vpip/G.session.hands*100;
  chk('VPIP counts preflop only', vpip<3, `never put money in preflop, VPIP reads ${vpip.toFixed(0)}%`);
}

// ---- 2. session bb must equal real chip movement (no rebuys now) ----
{
  const policy=(G)=>{
    const S=G.S,h=S.players[0],tc=S.currentBet-h.bet,r=Math.random();
    const d = tc>0 ? (r<0.5?{action:'call'}:{action:'fold'})
                   : (r<0.6?{action:'check'}:{action:'bet',amount:h.bet+Math.max(2,Math.round(S.pot*0.6))});
    G.applyAction(h,d); S.toAct=G.nextToAct(S.toAct); G.step();
  };
  const {G,drain}=make(policy);
  G.newSession(); drain();
  let realNet=(G.roster[0].stack-200)/2;
  for(let i=0;i<600;i++){
    if(G.session.over) break;
    const before=G.roster[0].stack;
    G.newHand(); drain();
    if(G.session.over) break;
    realNet += (G.roster[0].stack-before)/2;
  }
  chk('session bb matches real chip movement', Math.abs(G.session.net-realNet)<1,
      `app ${G.session.net.toFixed(1)}bb, actual ${realNet.toFixed(1)}bb`);
}

// ---- 3. an all-in for less than a full raise must not reopen betting ----
{
  const {G,drain}=make(()=>{});
  G.newSession();
  const S=G.S, [a,b,c]=[S.players[1],S.players[2],S.players[3]];
  S.street='flop'; S.currentBet=0; S.minRaise=2;
  S.players.forEach(p=>{p.bet=0;p.acted=false;p.folded=false;p.allIn=false;});
  a.stack=200; b.stack=15; c.stack=200;
  G.applyAction(a,{action:'bet',amount:10});           // a bets 10
  const cActedBefore = c.acted;
  G.applyAction(c,{action:'call'});                     // c calls 10
  G.applyAction(b,{action:'bet',amount:999});           // b all-in for 15 (incomplete raise)
  chk('incomplete all-in does not reopen action', c.acted===true,
      `c had already called; after the short all-in c.acted=${c.acted}`);
  chk('min-raise unchanged by incomplete all-in', S.minRaise===10, `minRaise=${S.minRaise} (10 is correct: a's bet of 10 set it)`);
}

// ---- 4. an all-in for less should not be labelled a raise ----
{
  const {G}=make(()=>{});
  G.newSession();
  const S=G.S, a=S.players[1], b=S.players[2];
  S.street='flop'; S.currentBet=0; S.minRaise=2;
  S.players.forEach(p=>{p.bet=0;p.acted=false;p.folded=false;p.allIn=false;});
  a.stack=200; b.stack=7;
  G.applyAction(a,{action:'bet',amount:20});
  G.applyAction(b,{action:'bet',amount:999});
  chk('short all-in labelled honestly', !/raise/.test(b.lastAct), `shows "${b.lastAct}"`);
}

// ---- 5. reads update from public actions; styles present; clamp bounds ----
{
  const policy=(G)=>{
    const S=G.S,h=S.players[0],tc=S.currentBet-h.bet,r=Math.random();
    const d = tc>0 ? (r<0.4?{action:'fold'}:r<0.75?{action:'call'}:{action:'bet',amount:h.bet+tc+Math.max(2,Math.round(S.pot*0.5))})
                   : (r<0.5?{action:'check'}:{action:'bet',amount:h.bet+Math.max(2,Math.round(S.pot*0.5))});
    G.applyAction(h,d); S.toAct=G.nextToAct(S.toAct); G.step();
  };
  const {G,drain,state}=make(policy);
  G.newSession(); drain();
  chk('bots have distinct styles', G.roster.filter(r=>!r.isHero).every(r=>r.style) &&
      new Set(G.roster.filter(r=>!r.isHero).map(r=>JSON.stringify(r.style))).size>=3,
      'expected fixed diverse BOT_STYLES');
  chk('hero has no style seed', G.roster[0].style===null);
  const before=G.roster.map(r=>({seat:r.seat, vpip:r.reads.vpip, opps:r.reads.vpipOpps, hands:r.reads.hands}));
  for(let i=0;i<80;i++){
    if(G.session.over){ G.newSession(); drain(); }
    G.newHand(); drain();
  }
  const moved=G.roster.some((r,i)=>r.reads.hands>before[i].hands && r.reads.vpipOpps>before[i].opps);
  chk('reads accumulate from public actions', moved, 'hands/vpipOpps should rise');
  // Hero who sometimes puts money in should show vpip > 0 on reads (separate from session.vpip)
  chk('hero reads track public VPIP opportunities', G.roster[0].reads.vpipOpps>0);
  chk('clampFreq respects band', G.clampFreq(0)===0.05 && G.clampFreq(1)===0.95 && G.clampFreq(0.4)===0.4);
  chk('botDecide received public ctx fields', !!(state.lastBotCtx && 'inPosition' in state.lastBotCtx &&
      'streetBets' in state.lastBotCtx && 'facingReads' in state.lastBotCtx && 'style' in state.lastBotCtx));
}
console.log(fails?`\n  ${fails} bug${fails>1?'s':''} found`:'\n  clean');
