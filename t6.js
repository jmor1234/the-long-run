const make=require('./harness');
console.log('TEST 6 — busting out\n');
let fails=0;
const chk=(n,ok,d)=>{ if(!ok)fails++; console.log(`  ${ok?'ok  ':'BUG '} ${n}${d?'   '+d:''}`); };

const policy=(G)=>{
  const S=G.S,h=S.players[0],tc=S.currentBet-h.bet,r=Math.random();
  let d;
  if(tc>0) d = r<0.35?{action:'fold'} : r<0.8?{action:'call'} : {action:'bet',amount:h.bet+tc+Math.max(2,Math.round(S.pot*0.8))};
  else     d = r<0.55?{action:'check'} : {action:'bet',amount:h.bet+Math.max(2,Math.round(S.pot*0.8))};
  G.applyAction(h,d); S.toAct=G.nextToAct(S.toAct); G.step();
};

const sizesSeen=new Set();
let chipErr=0, endings={busted:0,won:0}, sessions=0, maxHands=0, stuck=0;
const {G,drain}=make(policy);

for(let sess=0; sess<120; sess++){
  G.newSession(); drain();
  let hands=0;
  // Cap sized for the post-sizing-spread session-length distribution: smaller
  // average opens (station 4.8, nit 5.2) mean slower busts than the flat 6s.
  // A genuine stalemate would blow any cap; 900 keeps the ending check honest.
  while(!G.session.over && hands<900){
    const total=G.roster.reduce((a,p)=>a+p.stack,0);
    if(total!==1200){ chipErr++; if(chipErr<3){console.log('  [mid-loop] total',total,'at',G.S.n,'handed, over=',G.session.over); G.roster.forEach(r=>console.log('     ',r.name,r.stack));} }
    sizesSeen.add(G.S.n);
    hands++;
    G.newHand(); drain();
    if(!G.S.done && !G.session.over){ stuck++; break; }
  }
  const total=G.roster.reduce((a,p)=>a+p.stack,0);
  if(total!==1200){ chipErr++; if(chipErr<4){console.log('  [end-of-session] total',total,'over=',G.session.over); G.roster.forEach(r=>console.log('     ',r.name,r.stack));} }
  if(G.session.over) endings[G.session.over]++;
  maxHands=Math.max(maxHands,hands);
  sessions++;
}

chk('sessions all reached an ending', endings.busted+endings.won===sessions,
    `${endings.busted} busted, ${endings.won} won, ${sessions-endings.busted-endings.won} unfinished`);
chk('chips always total exactly 1200', chipErr===0, chipErr?`${chipErr} violations`:'no chips created or destroyed');
chk('no hands hung', stuck===0);
chk('table shrank through every size', [2,3,4,5,6].every(x=>sizesSeen.has(x)),
    'saw '+[...sizesSeen].sort().join(', ')+' handed');
console.log(`\n  longest session: ${maxHands} hands`);

// heads-up rules — capture who is asked to act, at the moment of asking
let firstActor=null, seen=0, sbOK=0, sbBad=0;
const capture=(G)=>{
  const S=G.S,h=S.players[0];
  if(firstActor===null) firstActor=S.toAct;
  G.applyAction(h,{action:'fold'}); S.toAct=G.nextToAct(S.toAct); G.step();
};
const {G:G2,drain:d2}=make(capture);
for(let i=0;i<300 && seen<40;i++){
  G2.newSession();
  G2.roster.forEach((r,k)=>{ if(k>1) r.stack=0; });
  G2.roster[0].stack=600; G2.roster[1].stack=600;
  firstActor=null;
  G2.newHand();
  const S=G2.S;
  if(S.n!==2){ d2(); continue; }
  const btn=S.players[S.btnPos], other=S.players[(S.btnPos+1)%2];
  if(btn.invested===1 && other.invested===2) sbOK++; else sbBad++;
  // whoever was asked first must be the button
  const asked = firstActor!==null ? firstActor : S.toAct;
  if(asked===S.btnPos) seen++; else sbBad++;
  d2();
}
chk('heads-up: button posts the small blind', sbBad===0 && sbOK>0, `${sbOK} hands checked`);
chk('heads-up: button acts first preflop', seen>0 && sbBad===0, `${seen} hands checked`);
console.log(fails?`\n  ${fails} bug${fails>1?'s':''}`:'\n  clean');
process.exitCode=fails?1:0;
