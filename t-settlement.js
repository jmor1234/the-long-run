const make=require('./harness');

console.log('SETTLEMENT TEST - exact pot recipients and truthful refunds\n');
let fails=0;
const chk=(name,ok,detail)=>{
  if(!ok) fails++;
  console.log(`  ${ok?'ok  ':'FAIL'} ${name}${detail?'   '+detail:''}`);
};

const card=(r,s)=>({r,s});
const LOW_BOARD=[card(2,'c'),card(3,'d'),card(7,'h'),card(9,'s'),card(11,'c')];
const TIE_BOARD=[card(10,'h'),card(11,'h'),card(12,'h'),card(13,'h'),card(14,'h')];
const HOLES=[
  [card(14,'s'),card(14,'d')],
  [card(13,'s'),card(13,'d')],
  [card(12,'s'),card(12,'d')],
  [card(8,'s'),card(8,'d')],
  [card(6,'s'),card(6,'d')],
  [card(5,'s'),card(5,'d')],
];

function fixture(specs,{button=0,board=LOW_BOARD,pot}={}){
  const h=make(()=>{});
  h.G.newSession(); h.queue.length=0;
  const G=h.G,S=G.S;
  S.done=false; S.street=board.length===5?'river':'preflop'; S.board=board.map(c=>({...c}));
  S.btnPos=button; S.log=[]; S.streetAggressor=null; S.preflopRaiser=null;
  S.players.forEach((p,i)=>{
    const spec=specs[i]||{};
    p.folded=spec.folded!==false;
    p.allIn=!!spec.allIn;
    p.invested=spec.invested||0;
    p.bet=0; p.stack=100-p.invested;
    p.acted=true; p.actedAtBet=0; p.lastAct='';
    p.cards=(spec.cards||HOLES[i]).map(c=>({...c}));
  });
  S.pot=pot===undefined
    ? S.players.reduce((sum,p)=>sum+p.invested,0)
    : pot;
  const before=S.players.map(p=>p.stack);
  return {h,G,S,before};
}

const deltas=f=>f.S.players.map((p,i)=>p.stack-f.before[i]);
const logText=f=>f.S.log.map(x=>x.text).join('\n');
const record=f=>f.G.session.records[f.G.session.records.length-1]||'';
const snapshot=f=>JSON.stringify({
  S:f.G.S, roster:f.G.roster, session:f.G.session, queue:f.h.queue.length,
  logHtml:f.h.els.log.innerHTML, reviewHtml:f.h.els.reviewSlot.innerHTML,
  actionsHtml:f.h.els.actions.innerHTML
});

// Everyone folds after facing a wager: matched chips are won, excess is returned.
{
  const f=fixture([
    {folded:false,invested:10},
    {folded:true,invested:5},
  ],{board:[]});
  f.G.endHand();
  const d=deltas(f), log=logText(f), rec=record(f), review=f.h.els.reviewSlot.innerHTML;
  chk('fold ending awards ten matched chips and returns five unmatched',
    d[0]===15 && d.slice(1).every(x=>x===0));
  chk('fold-ending log distinguishes the award from the refund',
    /You wins 10 \(uncontested\)/.test(log) &&
    /You gets back 5 \(uncalled bet, nobody could match it\)/.test(log));
  chk('saved fold history says returned, never won, for the excess',
    /You had 5 returned \(uncalled bet\)/.test(rec) &&
    /You won 10 \(everyone folded\)/.test(rec) && !/You won 5/.test(rec));
  chk('review counts only matched chips as winnings',
    /You won 10/.test(review) && /5 chips came back to you/.test(review));
  chk('fold-ending settlement conserves all fifteen chips',d.reduce((a,b)=>a+b,0)===15);
}

// Folded dead money remains a matched award even when one player alone is eligible.
{
  const f=fixture([
    {folded:false,invested:10,cards:HOLES[0]},
    {folded:true, invested:10,cards:HOLES[1]},
    {folded:false,invested:5, cards:HOLES[1]},
  ]);
  const layers=f.G.buildPots();
  chk('matched-dead-money fixture has literal 15 main and 10 side layers',
    layers.length===2 && layers[0].amount===15 && layers[0].contributors.length===3 &&
    layers[1].amount===10 && layers[1].contributors.length===2 && layers[1].elig.length===1);
  f.G.endHand();
  const d=deltas(f), log=logText(f), rec=record(f), review=f.h.els.reviewSlot.innerHTML;
  chk('sole eligible player wins matched folded chips',d[0]===25 && d[2]===0);
  chk('matched folded chips are never called a refund',
    !/gets back/.test(log) && !/returned \(uncalled bet\)/.test(rec) &&
    !/chips came back to you/.test(review));
  chk('matched folded chips appear as winnings in every result surface',
    /You wins 25 with a pair/.test(log) && /You won 25 \(a pair\)/.test(rec) &&
    /You won 25/.test(review));
  chk('matched-dead-money settlement conserves all twenty-five chips',
    d.reduce((a,b)=>a+b,0)===25);
}

// Three unequal all-ins: exact main pot, side pot, and unmatched top refund.
{
  const f=fixture([
    {folded:false,invested:5, cards:HOLES[0],allIn:true},
    {folded:false,invested:10,cards:HOLES[2],allIn:true},
    {folded:false,invested:15,cards:HOLES[1],allIn:true},
  ]);
  const layers=f.G.buildPots();
  chk('unequal all-ins form literal 15, 10, and 5 layers',
    layers.map(x=>x.amount).join(',')==='15,10,5' &&
    layers.map(x=>x.contributors.length).join(',')==='3,2,1');
  f.G.endHand();
  const d=deltas(f), log=logText(f), rec=record(f);
  chk('main, side, and refund reach exact recipients',
    d[0]===15 && d[1]===0 && d[2]===15 && d.slice(3).every(x=>x===0));
  chk('showdown excess is returned rather than won',
    new RegExp(`${f.S.players[2].name} gets back 5`).test(log) &&
    new RegExp(`${f.S.players[2].name} had 5 returned`).test(rec) &&
    !new RegExp(`${f.S.players[2].name} won 5`).test(rec));
  chk('showdown matched awards appear in the log and saved history',
    /You wins 15 with a pair/.test(log) && /You won 15 \(a pair\)/.test(rec) &&
    new RegExp(`${f.S.players[2].name} wins 10 with a pair`).test(log) &&
    new RegExp(`${f.S.players[2].name} won 10 \\(a pair\\)`).test(rec));
  chk('showdown review reports the hero main-pot award',/You won 15/.test(f.h.els.reviewSlot.innerHTML));
  chk('multi-layer settlement conserves all thirty chips',d.reduce((a,b)=>a+b,0)===30);
}

// A board tie with one dead chip: first tied seat left of the button gets it.
{
  const f=fixture([
    {folded:false,invested:1,cards:[card(4,'c'),card(5,'c')]},
    {folded:false,invested:1,cards:[card(6,'c'),card(7,'c')]},
    {folded:true, invested:1,cards:[card(8,'c'),card(9,'c')]},
  ],{button:0,board:TIE_BOARD});
  f.G.endHand();
  const d=deltas(f);
  chk('odd chip starts left of the button and the tied button is last',
    d[0]===1 && d[1]===2 && d.slice(2).every(x=>x===0));
  chk('odd-chip split conserves all three chips',d.reduce((a,b)=>a+b,0)===3);
}

// The left-of-button order must remain cyclic when tied seats cross index zero.
{
  const f=fixture([
    {},
    {folded:false,invested:1,cards:[card(4,'c'),card(5,'c')]},
    {},
    {folded:true, invested:1,cards:[card(8,'c'),card(9,'c')]},
    {},
    {folded:false,invested:1,cards:[card(6,'c'),card(7,'c')]},
  ],{button:4,board:TIE_BOARD});
  f.G.endHand();
  const d=deltas(f);
  chk('odd-chip order wraps from the last seat back to the first',
    d[1]===1 && d[5]===2 && d.filter((_,i)=>i!==1&&i!==5).every(x=>x===0));
  chk('wrapped odd-chip split conserves all three chips',d.reduce((a,b)=>a+b,0)===3);
}

// Invalid settlement state must fail before S.done, payouts, logs, or session writes.
{
  const f=fixture([
    {folded:false,invested:5},
    {folded:true, invested:10},
  ]);
  const before=snapshot(f);
  let message='';
  try{ f.G.endHand(); }catch(err){ message=err.message; }
  chk('zero-eligible layer fails before any settlement mutation',
    message==='settlement: pot layer has no eligible player' && snapshot(f)===before);
}
{
  const f=fixture([
    {folded:false,invested:5},
    {folded:true, invested:5},
  ],{pot:11});
  const before=snapshot(f);
  let message='';
  try{ f.G.endHand(); }catch(err){ message=err.message; }
  chk('pot/investment mismatch fails before any settlement mutation',
    message==='settlement: pot does not match invested chips' && snapshot(f)===before);
}

console.log(fails?`\n  ${fails} FAILED`:'\n  settlement recipients and semantics are sound');
process.exitCode=fails?1:0;
