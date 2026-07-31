const make=require('./harness');
const {stream}=require('./exp/prng');

console.log('EQUITY TEST - exact heads-up oracle and live range wiring\n');
let fails=0;
const chk=(name,ok,detail)=>{
  if(!ok) fails++;
  console.log(`  ${ok?'ok  ':'FAIL'} ${name}${detail?'   '+detail:''}`);
};
const close=(a,b,tol=1e-12)=>Math.abs(a-b)<=tol;
const R={A:14,K:13,Q:12,J:11,T:10,9:9,8:8,7:7,6:6,5:5,4:4,3:3,2:2};
const P=s=>s.split(/\s+/).filter(Boolean).map(t=>({r:R[t[0]],s:t[1]}));
const key=c=>`${c.r}${c.s}`;
const deck=()=>{
  const out=[];
  for(const s of ['s','h','d','c']) for(let r=2;r<=14;r++) out.push({r,s});
  return out;
};

const h=make(()=>{}), G=h.G;
const seeded=(name,fn)=>{
  const random=Math.random;
  Math.random=stream(`equity-oracle|${name}`);
  try{ return fn(); }
  finally{ Math.random=random; }
};
const result=(mine,opp,board)=>{
  const c=G.cmpHand(G.evaluate([...mine,...board]),G.evaluate([...opp,...board]));
  return c>0?1:c===0?0.5:0;
};
const literalLikelihood=(hole,board)=>{
  const withHole=G.evaluate([...hole,...board]);
  const boardOnly=G.evaluate(board);
  if(G.cmpHand(withHole,boardOnly)===0) return 0.13;
  if(withHole.cat>=3) return 0.80;
  if(withHole.cat===2) return 0.70;
  if(withHole.cat===1) return 0.45;
  return 0.13;
};

// Independent combination and runout enumeration. This deliberately supports
// heads-up river and turn spots only; multiway assignments grow combinatorially.
function exactHeadsUp(mine,board,{range=()=>true,weight=()=>1}={}){
  if(board.length!==4 && board.length!==5) throw new Error('oracle requires turn or river');
  const used=new Set([...mine,...board].map(key));
  const stub=deck().filter(c=>!used.has(key(c)));
  let score=0,total=0;
  for(let i=0;i<stub.length-1;i++) for(let j=i+1;j<stub.length;j++){
    const opp=[stub[i],stub[j]];
    if(!range(opp)) continue;
    const w=weight(opp);
    if(!(w>0)) continue;
    if(board.length===5){
      score+=w*result(mine,opp,board); total+=w;
      continue;
    }
    for(let k=0;k<stub.length;k++){
      if(k===i || k===j) continue;
      score+=w*result(mine,opp,[...board,stub[k]]); total+=w;
    }
  }
  return score/total;
}

// Small literal evaluator contract. The equity oracle is independent of the
// production sampler, but intentionally shares this now-explicit scoring primitive.
const ranks=[
  ['high card',      'As Kd 9c 7h 4s 3d 2c',0,[14,13,9,7,4]],
  ['one pair',       'As Ad Kc Qh 9s 3d 2c',1,[14,13,12,9]],
  ['two pair',       'As Ad Kc Kh Qs 3d 2c',2,[14,13,12]],
  ['three of a kind','As Ad Ah Kc Qs 3d 2c',3,[14,13,12]],
  ['wheel straight', 'As 2d 3c 4h 5s Kd Qc',4,[5]],
  ['flush',          'As Js 9s 4s 2s Kd Qc',5,[14,11,9,4,2]],
  ['two-trip house', 'As Ad Ah Kc Kd Kh 2c',6,[14,13]],
  ['four of a kind', 'As Ad Ah Ac Kd Qc 2s',7,[14,13]],
  ['straight flush', '9s Ts Js Qs Ks 2d 3c',8,[13]],
];
for(const [name,cards,cat,tie] of ranks){
  const got=G.evaluate(P(cards));
  chk(`evaluator literal: ${name}`,got.cat===cat && got.tie.join(',')===tie.join(','));
}
const royal=P('Ah Kh Qh Jh Th');
chk('evaluator literal: board-only royal flush ties exactly',
  G.cmpHand(G.evaluate([...P('2c 3d'),...royal]),G.evaluate([...P('8s 9d'),...royal]))===0);
chk('comparator literal: later pair kicker decides',
  G.cmpHand(G.evaluate(P('As Ad Kc Qh 9s 3d 2c')),
    G.evaluate(P('Ah Ac Kd Jh 9c 3s 2d')))>0);
chk('comparator literal: two-pair kicker decides',
  G.cmpHand(G.evaluate(P('As Ad Kc Kh Qs 3d 2c')),
    G.evaluate(P('Ah Ac Kd Ks Js 3c 2d')))>0);

if(typeof G.equity!=='function' || typeof G.betLikelihood!=='function'){
  chk('production equity seams are exported',false);
}else{
  const likelihoodCases=[
    ['playing the board',P('2c 3d'),P('Ah Kd Qs Jc 9h'),0.13],
    ['air',              P('As Kd'),P('2c 7d 9h'),0.13],
    ['pair',             P('As 2d'),P('2c 7d 9h'),0.45],
    ['two pair',         P('2s 7s'),P('2c 7d 9h'),0.70],
    ['trips or better',  P('7s 7c'),P('2c 7d 9h'),0.80],
  ];
  for(const [name,hole,board,want] of likelihoodCases)
    chk(`bet likelihood literal: ${name}`,G.betLikelihood(hole,board)===want);

  const riverMine=P('As Kd'), riverBoard=P('Ah 9c 7d 4s 2h');
  const riverExact=exactHeadsUp(riverMine,riverBoard);
  const riverGot=seeded('river-random',()=>G.equity(riverMine,riverBoard,[{cap:100,aggr:0}],30000));
  chk('random river equity matches exact enumeration',close(riverGot,riverExact,0.02),
    `got ${(riverGot*100).toFixed(1)}%, exact ${(riverExact*100).toFixed(1)}%`);

  const turnMine=P('9c 8c'), turnBoard=P('Jh Ts 2d 4s');
  const turnExact=exactHeadsUp(turnMine,turnBoard);
  const turnGot=seeded('turn-random',()=>G.equity(turnMine,turnBoard,[{cap:100,aggr:0}],30000));
  chk('random turn equity matches exact opponent-plus-river enumeration',close(turnGot,turnExact,0.02),
    `got ${(turnGot*100).toFixed(1)}%, exact ${(turnExact*100).toFixed(1)}%`);

  const premiumMine=P('Ks Kd'), premiumBoard=P('2c 7h 9s Td 3c');
  const aaOnly=h=>h[0].r===14 && h[1].r===14;
  const premiumExact=exactHeadsUp(premiumMine,premiumBoard,{range:aaOnly});
  const premiumGot=seeded('river-aa-only',()=>G.equity(premiumMine,premiumBoard,[{cap:0.5,aggr:0}],30000));
  chk('literal top-half-percent cap samples only aces',premiumExact===0 && premiumGot===0,
    `got ${(premiumGot*100).toFixed(1)}%`);

  const aggrMine=P('Ac Kd'), aggrBoard=P('Qs 9h 7h 4c 2s'), aggr=2;
  const aggrExact=exactHeadsUp(aggrMine,aggrBoard,{
    weight:hole=>Math.pow(literalLikelihood(hole,aggrBoard)/0.80,aggr)
  });
  const aggrGot=seeded('river-aggression',()=>G.equity(aggrMine,aggrBoard,[{cap:100,aggr}],40000));
  const neutralExact=exactHeadsUp(aggrMine,aggrBoard);
  chk('aggression-weighted river equity matches exact weighting',close(aggrGot,aggrExact,0.035),
    `got ${(aggrGot*100).toFixed(1)}%, exact ${(aggrExact*100).toFixed(1)}%`);
  chk('aggression fixture materially differs from a random range',Math.abs(aggrExact-neutralExact)>0.08,
    `weighted ${(aggrExact*100).toFixed(1)}%, random ${(neutralExact*100).toFixed(1)}%`);

  const tie=seeded('multiway-board-tie',()=>G.equity(P('2c 3d'),royal,
    [{cap:100,aggr:0},{cap:100,aggr:0}],100));
  chk('multiway board tie always awards one third',close(tie,1/3));

  const pureMine=P('Qh Jd'), pureBoard=P('9c 7s 4h'), pureOpps=[{cap:32,aggr:1}];
  const before=JSON.stringify({pureMine,pureBoard,pureOpps}), random=Math.random;
  seeded('purity',()=>G.equity(pureMine,pureBoard,pureOpps,200));
  chk('equity leaves cards, descriptors, and global RNG binding unchanged',
    JSON.stringify({pureMine,pureBoard,pureOpps})===before && Math.random===random);

  const wrapMine=P('Qh Jd'), wrapBoard=P('9c 7s 4h');
  const wrapDefault=seeded('wrapper-default',()=>G.strengthVsRandom(wrapMine,wrapBoard));
  const direct160=seeded('wrapper-default',()=>G.equity(wrapMine,wrapBoard,[{cap:100,aggr:0}],160));
  const wrapExplicit=seeded('wrapper-explicit',()=>G.strengthVsRandom(wrapMine,wrapBoard,240));
  const direct240=seeded('wrapper-explicit',()=>G.equity(wrapMine,wrapBoard,[{cap:100,aggr:0}],240));
  chk('strengthVsRandom default delegates with 160 iterations',wrapDefault===direct160);
  chk('strengthVsRandom preserves an explicit iteration count',wrapExplicit===direct240);

  // Live integration: a real postflop bet narrows the public range and increments
  // aggression; updateStrip must feed those exact values into the checked equity path.
  const live=make(()=>{}); live.G.newSession(); live.queue.length=0;
  const S=live.G.S, hero=S.players[0], villain=S.players[1];
  S.done=false; S.street='flop'; S.board=P('Qs 9h 7h');
  S.currentBet=0; S.minRaise=2; S.pot=20; S.toAct=villain.idx;
  S.streetBets=0; S.raisedBefore=false; S.actionSeq=9;
  S.players.forEach(p=>{
    p.folded=true; p.allIn=false; p.bet=0; p.invested=0; p.stack=100;
    p.acted=false; p.actedAtBet=0; p.inferredTier=100; p.aggr=0;
  });
  Object.assign(hero,{folded:false,invested:10,cards:P('Ac Kd')});
  Object.assign(villain,{folded:false,invested:10,cards:P('Js Td')});
  const view=live.G.legalActionView(villain);
  const applied=live.G.applyAction(villain,{action:'bet',amount:10,actionSeq:view.actionSeq});
  S.toAct=hero.idx;
  const tiers=[{cap:villain.inferredTier,aggr:villain.aggr}];
  const wired=seeded('live-strip',()=>live.G.equity(hero.cards,S.board,tiers,320));
  const neutral=seeded('live-strip',()=>live.G.equity(hero.cards,S.board,[{cap:100,aggr:0}],320));
  seeded('live-strip',()=>live.G.updateStrip());
  chk('real postflop bet writes the public range and aggression inputs',applied.ok &&
    villain.inferredTier===32 && villain.aggr===1);
  chk('live strip renders the checked equity for those exact inputs',
    live.els.valEq.textContent===`${Math.round(wired*100)}%`);
  chk('live strip passes the exact public range descriptors into equity',
    JSON.stringify(live.state.lastEquityOpps)===JSON.stringify([{cap:32,aggr:1}]));
  chk('live wiring control differs from an unconditioned range',
    Math.round(wired*100)!==Math.round(neutral*100),
    `wired ${Math.round(wired*100)}%, neutral ${Math.round(neutral*100)}%`);
}

console.log(fails?'\n  EQUITY FAILURES PRESENT':'\n  equity pipeline is independently constrained');
process.exitCode=fails?1:0;
