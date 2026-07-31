const make=require('./harness');
const makeExp=require('./exp/exp-harness');
const {stream}=require('./exp/prng');

console.log('POLICY B TEST - public line, legal price, and opt-in execution\n');
let fails=0;
const chk=(name,ok,detail)=>{
  if(!ok) fails++;
  console.log(`  ${ok?'ok  ':'FAIL'} ${name}${detail?'   '+detail:''}`);
};
const R={A:14,K:13,Q:12,J:11,T:10,9:9,8:8,7:7,6:6,5:5,4:4,3:3,2:2};
const P=s=>s.split(/\s+/).filter(Boolean).map(t=>({r:R[t[0]],s:t[1]}));
const seeded=(name,fn)=>{
  const random=Math.random;
  Math.random=stream(`policy-b|${name}`);
  try{return fn();}
  finally{Math.random=random;}
};

const h=make(()=>{}),G=h.G;
const style={open:1,bet:1,fold:1.12,limp:0.09,openSize:3,size:1,
  sizeJitter:0.14,callTemp:0.028,tag:'solid'};
const legal=(need,{toCall=10,layeredEquity=false,aggressive=null}={})=>{
  const finalPot=toCall/need;
  return {ok:true,toCall,effectiveCall:toCall,contestablePot:finalPot-toCall,
    excludedPot:0,finalPot,need,layeredEquity,myBet:0,stack:100,
    currentBet:toCall,minRaise:2,raiseReopened:!!aggressive,aggressive,actions:[]};
};
const postflop=(overrides={})=>({
  myCards:P('Ac Kd'),board:P('Qs 9h 7h 4c 2s'),street:'river',
  toCall:10,pot:90,myStack:100,myBet:0,position:'BTN',raisedBefore:true,
  openThr:30,tableSize:2,inPosition:true,streetBets:1,facingReads:null,
  aggressorHadInitiative:false,style,mood:0,
  legal:legal(0.2),opponents:[{cap:100,bets:[]}],...overrides
});

for(const seed of ['pre-1','pre-2','pre-3']){
  const ctx={...postflop(),street:'preflop',board:[],raisedBefore:false,
    myCards:P('As Jh'),toCall:2,pot:3,legal:legal(2/5,{toCall:2})};
  const a=seeded(seed,()=>G.botPolicyV1(ctx));
  const b=seeded(seed,()=>G.botPolicyV2(ctx));
  chk(`${seed}: Policy B delegates preflop byte-for-byte`,JSON.stringify(a)===JSON.stringify(b));
}

{
  const cheap=seeded('legal-price',()=>G.botPolicyV2(postflop({legal:legal(0.10)})));
  const dear=seeded('legal-price',()=>G.botPolicyV2(postflop({legal:legal(0.49)})));
  chk('legal price field changes the boundary decision',
    cheap.action==='call' && dear.action==='fold' &&
    cheap.dbg.equity===dear.dbg.equity && cheap.dbg.needPct===10 && dear.dbg.needPct===49,
    `${cheap.action} at 10%, ${dear.action} at 49%`);
}

const livePrice=(deadMoney)=>{
  const run=makeExp(()=>{}, {seed:'policy-b-live-price',policy:'v2',captureDecisions:true});
  run.G.newSession();run.queue.length=0;
  const S=run.G.S,p=S.players[1],q=S.players[2];
  S.done=false;S.street='river';S.board=P('Qs 9h 7h 4c 2s');
  S.currentBet=10;S.minRaise=2;S.raisedBefore=true;S.streetBets=1;
  S.streetAggressor=q;S.preflopRaiser=null;S.actionSeq=3;S.pot=10+deadMoney;
  S.players.forEach(x=>{
    x.folded=true;x.allIn=false;x.bet=0;x.invested=0;x.stack=100;
    x.acted=false;x.actedAtBet=0;x.range={cap:100,bets:[]};
  });
  Object.assign(p,{folded:false,cards:P('Ac Kd')});
  Object.assign(q,{folded:false,bet:10,invested:10,acted:true,actedAtBet:10});
  let left=deadMoney;
  for(const x of S.players.filter(x=>x!==p&&x!==q)){
    const chips=Math.min(10,left);x.invested=chips;left-=chips;
  }
  S.toAct=p.idx;run.G.step();
  const queued=run.queue.shift();if(queued) queued();
  return {ctx:run.state.lastBotCtx,result:run.state.decisionTrace[0]&&
    run.state.decisionTrace[0].result};
};
{
  const cheap=livePrice(40),dear=livePrice(0);
  chk('live legalActionView feeds its literal price into Policy B',
    cheap.ctx.legal.need===10/60 && dear.ctx.legal.need===10/20 &&
    cheap.result.action==='call' && dear.result.action==='fold' &&
    cheap.result.dbg.needPct===17 && dear.result.dbg.needPct===50,
    `${cheap.result.action} at ${(cheap.ctx.legal.need*100).toFixed(1)}%, `+
    `${dear.result.action} at ${(dear.ctx.legal.need*100).toFixed(1)}%`);
}

{
  const board=P('Qs 9h 7h 4c 2s');
  const random=postflop({board,legal:legal(0.20),opponents:[{cap:100,bets:[]}]});
  const line=postflop({board,legal:legal(0.20),opponents:[{
    cap:100,bets:[board.slice(0,3),board.slice(0,4)]
  }]});
  const a=seeded('line-shift',()=>G.botPolicyV2(random));
  const b=seeded('line-shift',()=>G.botPolicyV2(line));
  chk('chronological aggression materially changes Policy B',
    a.action==='call' && b.action==='fold' && a.dbg.equity-b.dbg.equity>0.15,
    `${a.action} ${(a.dbg.equity*100).toFixed(1)}%, ${b.action} ${(b.dbg.equity*100).toFixed(1)}%`);
}

{
  const ctx=postflop({myCards:P('9c 8c'),board:P('Jh Ts 2d 4s'),street:'turn',
    legal:legal(0.90),opponents:[{cap:100,bets:[]}]});
  const decision=seeded('no-double-draw',()=>G.botPolicyV2(ctx));
  const direct=seeded('no-double-draw',()=>G.equity(ctx.myCards,ctx.board,ctx.opponents,180));
  const edgeNeed=Math.max(0.005,Math.min(0.08,0.02*style.fold/1/1.06));
  const expectedCall=1/(1+Math.exp(-(direct-ctx.legal.need-edgeNeed)/style.callTemp));
  chk('Policy B uses runout equity exactly once with no draw bonus',
    decision.dbg.equity===direct && decision.dbg.pCall===expectedCall,
    `${(direct*100).toFixed(1)}%, call ${(expectedCall*100).toFixed(2)}%`);
}

{
  const ctx=postflop({myCards:P('Ks Kd'),board:P('2c 7h 9s Td 3c'),legal:legal(0.20)});
  const one=seeded('all-opponents',()=>G.botPolicyV2({...ctx,
    opponents:[{cap:100,bets:[]}]}));
  const two=seeded('all-opponents',()=>G.botPolicyV2({...ctx,
    opponents:[{cap:100,bets:[]},{cap:0.5,bets:[]}]}));
  chk('a literal second live opponent changes the Policy B decision',
    one.action==='call' && two.action==='fold' && one.dbg.opponents===1 &&
    two.dbg.opponents===2 && two.dbg.equity===0,
    `${one.action} heads-up, ${two.action} with AA`);
}

{
  const ctx=postflop({legal:legal(0.20,{layeredEquity:true})});
  const baseline=seeded('layered-fallback',()=>G.botPolicyV1(ctx));
  const challenger=seeded('layered-fallback',()=>G.botPolicyV2(ctx));
  chk('Policy B explicitly defers layered pots until a per-layer oracle exists',
    JSON.stringify(challenger)===JSON.stringify(baseline));
}

{
  const d=seeded('raise-closed',()=>G.botPolicyV2(postflop({
    myCards:P('As Ah'),board:P('Ad 9c 2s 4h 7d'),legal:legal(0.15)
  })));
  chk('Policy B never raises when the legal view has no aggressive action',d.action==='call');
}

{
  const live=make(()=>{}); live.G.newSession(); live.queue.length=0;
  const S=live.G.S,hero=S.players[0],bot=S.players[1];
  S.players.forEach(p=>{
    p.folded=true;p.allIn=false;p.bet=0;p.invested=0;p.stack=200;
    p.acted=false;p.actedAtBet=0;p.range={cap:100,bets:[]};
  });
  hero.folded=false;bot.folded=false;S.done=false;S.pot=2;S.street='preflop';
  S.board=[];S.currentBet=2;S.minRaise=2;S.raisedBefore=false;S.streetBets=0;
  S.actionSeq=1;S.toAct=hero.idx;bot.bet=2;bot.invested=2;
  let view=live.G.legalActionView(hero);
  const pre=live.G.applyAction(hero,{action:'raise',amount:6,actionSeq:view.actionSeq});

  const resetStreet=(street,board)=>{
    S.street=street;S.board=board;S.currentBet=0;S.minRaise=2;
    S.raisedBefore=false;S.streetBets=0;S.streetAggressor=null;
    for(const p of [hero,bot]){p.bet=0;p.acted=false;p.actedAtBet=0;}
  };
  resetStreet('flop',P('Qs 9h 7h'));S.toAct=hero.idx;
  view=live.G.legalActionView(hero);
  const flop=live.G.applyAction(hero,{action:'bet',amount:10,actionSeq:view.actionSeq});
  resetStreet('turn',P('Qs 9h 7h 4c'));S.toAct=hero.idx;
  view=live.G.legalActionView(hero);
  const turn=live.G.applyAction(hero,{action:'bet',amount:12,actionSeq:view.actionSeq});
  S.toAct=bot.idx;live.G.step();
  const queued=live.queue.shift();if(queued) queued();
  const heroDescriptor=live.state.lastBotCtx && live.state.lastBotCtx.opponents[0];
  const expectedHero={cap:hero.openThr,bets:[P('Qs 9h 7h'),P('Qs 9h 7h 4c')]};
  chk('hero and bot actions feed the same public range record',pre.ok&&flop.ok&&turn.ok&&
    hero.range.cap===hero.openThr && hero.range.bets.length===2 &&
    JSON.stringify(heroDescriptor)===JSON.stringify(expectedHero));
}

{
  const live=make(()=>{});live.G.newSession();live.queue.length=0;
  const S=live.G.S,actor=S.players[1],a=S.players[0],b=S.players[2];
  S.players.forEach(p=>{
    p.folded=true;p.allIn=false;p.bet=0;p.invested=0;p.stack=100;
    p.acted=false;p.actedAtBet=0;p.range={cap:100,bets:[]};
  });
  actor.folded=false;a.folded=false;b.folded=false;
  a.range={cap:11,bets:[]};
  b.range={cap:22,bets:[P('Qs 9h 7h'),P('Qs 9h 7h 4c')]};
  S.done=false;S.street='turn';S.board=P('Qs 9h 7h 4c');S.pot=0;
  S.currentBet=0;S.minRaise=2;S.raisedBefore=false;S.streetBets=0;
  S.streetAggressor=null;S.actionSeq=4;S.toAct=actor.idx;
  live.G.step();const queued=live.queue.shift();if(queued) queued();
  const expected=[{cap:11,bets:[]},{cap:22,
    bets:[P('Qs 9h 7h'),P('Qs 9h 7h 4c')]}];
  chk('live context includes every active opponent in seat order',
    JSON.stringify(live.state.lastBotCtx.opponents)===JSON.stringify(expected));
}

{
  const live=make(()=>{});live.G.newSession();live.queue.length=0;
  const S=live.G.S,p=S.players[1],q=S.players[2];
  S.players.forEach(x=>{
    x.folded=true;x.allIn=false;x.bet=0;x.invested=0;x.stack=100;
    x.acted=false;x.actedAtBet=0;x.range={cap:100,bets:[]};
  });
  p.folded=false;q.folded=false;S.done=false;S.street='flop';S.board=P('2c 7d 9h');
  S.currentBet=10;S.minRaise=2;S.pot=10;S.toAct=p.idx;S.actionSeq=2;
  q.bet=10;q.invested=10;
  const view=live.G.legalActionView(p);
  const result=live.G.applyAction(p,{action:'call',actionSeq:view.actionSeq});
  chk('postflop calls do not corrupt the preflop range cap',
    result.ok && p.range.cap===100 && p.range.bets.length===0);
}

const checkFoldHero=(Game)=>{
  const S=Game.S,hero=S.players[0],view=Game.legalActionView(hero);
  Game.applyAction(hero,{action:view.toCall>0?'fold':'check',actionSeq:view.actionSeq});
  S.toAct=Game.nextToAct(S.toAct);Game.step();
};
{
  const run=makeExp(checkFoldHero,{seed:'policy-b-opt-in',policy:'v2',captureDecisions:true});
  run.G.newSession();run.drain();
  chk('experiment harness executes the opt-in Policy B path',
    run.state.decisionTrace.length>0 && run.state.decisionTrace.some(x=>
      x.result&&x.result.dbg&&x.result.dbg.equity!==undefined),
    `${run.state.decisionTrace.length} decisions`);
  chk('Policy B keeps all randomness inside keyed decision streams',run.state.strayDraws===0);
}

console.log(fails?'\n  POLICY B FAILURES PRESENT':'\n  Policy B challenger is independently constrained');
process.exitCode=fails?1:0;
