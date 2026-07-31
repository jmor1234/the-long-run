const make=require('./harness');

console.log('TEACHING TEST - exact call price and short-stack pot odds\n');
let fails=0;
const chk=(name,ok,detail)=>{
  if(!ok) fails++;
  console.log(`  ${ok?'ok  ':'FAIL'} ${name}${detail?'   '+detail:''}`);
};
const close=(a,b)=>Math.abs(a-b)<1e-12;

function fixture(specs,{currentBet=12}={}){
  const h=make(()=>{});
  h.G.newSession(); h.queue.length=0;
  const G=h.G,S=G.S;
  S.done=false; S.street='flop'; S.currentBet=currentBet; S.minRaise=10;
  S.raisedBefore=true; S.streetBets=1; S.actionSeq=4;
  S.players.forEach((p,i)=>{
    const spec=specs[i]||{};
    p.folded=spec.folded!==false; p.allIn=!!spec.allIn;
    p.bet=spec.bet||0; p.invested=spec.invested||0;
    p.stack=spec.stack===undefined?100:spec.stack;
    p.acted=false; p.actedAtBet=0; p.lastAct='';
  });
  S.pot=S.players.reduce((sum,p)=>sum+p.invested,0);
  S.toAct=0;
  return {h,G,S,hero:S.players[0]};
}

const priceOf=f=>typeof f.G.callPrice==='function'?f.G.callPrice(f.hero):null;
const renderPrice=f=>{
  if(typeof f.G.updateStrip!=='function') return false;
  f.G.updateStrip();
  return true;
};
const renderWithSeed=(f,seed)=>{
  const random=Math.random;
  let draws=0,rendered=false,state=seed>>>0;
  Math.random=()=>{
    draws++;
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    return state/4294967296;
  };
  try{
    rendered=renderPrice(f);
    const consumed=draws, next=Math.random();
    return {rendered,draws:consumed,next};
  }
  finally{ Math.random=random; }
};
const decisionNote=(f,priceLine,need)=>{
  const cls=f.h.els.verdict.className;
  const conclusion=cls==='verdict good'
    ? 'Calling makes money over the long run.'
    : cls==='verdict bad'
      ? `Folding is the profitable choice here, even when you'd have won.`
      : null;
  return conclusion
    ? `${priceLine} You need ${need}% and you have about ${f.h.els.valEq.textContent}. ${conclusion}`
    : null;
};

// A full call can contest every chip already in the pot.
{
  const f=fixture([
    {folded:false,bet:2, invested:22,stack:100},
    {folded:false,bet:12,invested:32,stack:100},
    {folded:true, bet:0, invested:20,stack:100},
  ]);
  const before=JSON.stringify(f.S), p=priceOf(f);
  chk('call-price calculation is pure',p && JSON.stringify(f.S)===before);
  chk('full call prices the literal 74-chip existing pot',p &&
    p.toCall===10 && p.effectiveCall===10 && p.contestablePot===74 &&
    p.excludedPot===0 && p.finalPot===84 && close(p.need,10/84));
  const rendered=renderPrice(f), note=f.h.els.stripNote?.textContent||f.h.els.stripNote?.innerHTML||'';
  chk('full-call strip keeps the ordinary risk-to-win explanation',rendered &&
    f.h.els.valNeed.textContent==='12%' && f.h.els.barNeed.style.width==='12%' &&
    note===decisionNote(f,'Calling 10 risks 10 to win 74.',12));
}

// Heads up, the opponent's last three chips are above the hero's all-in cap.
{
  const f=fixture([
    {folded:false,bet:2, invested:22,stack:7},
    {folded:false,bet:12,invested:32,stack:100},
  ]);
  const p=priceOf(f);
  chk('heads-up short call risks seven for a literal 58-chip contestable pot',p &&
    p.toCall===10 && p.effectiveCall===7 && p.contestablePot===51 &&
    p.excludedPot===3 && p.finalPot===58 && close(p.need,7/58));
  const rendered=renderPrice(f), note=f.h.els.stripNote?.textContent||f.h.els.stripNote?.innerHTML||'';
  chk('heads-up strip renders the effective all-in price',rendered &&
    f.h.els.valNeed.textContent==='12%' && f.h.els.barNeed.style.width==='12%' &&
    note===decisionNote(f,'Going all in for 7 creates a 58-chip pot you can contest. Your stack reaches 51 of the 54 chips already in the middle; 3 are above your cap.',12));
}

// Prior-street investment differs from this street's bet. Folded chips remain
// contestable; deeper live chips form layers this hero cannot win.
{
  const f=fixture([
    {folded:false,bet:2, invested:22,stack:7},
    {folded:false,bet:12,invested:42,stack:100},
    {folded:false,bet:12,invested:32,stack:100},
    {folded:true, bet:0, invested:25,stack:100},
  ]);
  const p=priceOf(f);
  chk('multiway price caps total investment rather than the current-street bet',p &&
    p.toCall===10 && p.effectiveCall===7 && p.contestablePot===105 &&
    p.excludedPot===16 && p.finalPot===112 && close(p.need,7/112));
  const rendered=renderPrice(f), note=f.h.els.stripNote?.textContent||f.h.els.stripNote?.innerHTML||'';
  chk('multiway strip never prices side-pot chips the hero cannot win',rendered &&
    f.h.els.valNeed.textContent==='6%' && f.h.els.barNeed.style.width==='6%' &&
    note===decisionNote(f,'Going all in for 7 creates a 112-chip pot you can contest. Your stack reaches 105 of the 121 chips already in the middle; 16 are above your cap.',6));
}

// An opponent all-in exactly at the hero's cap contests every layer the hero can win.
{
  const f=fixture([
    {folded:false,bet:15,invested:15,stack:5},
    {folded:false,bet:20,invested:20,stack:0,allIn:true},
    {folded:false,bet:25,invested:25,stack:100},
  ],{currentBet:25});
  const p=priceOf(f);
  chk('all-in opponent exactly at the cap keeps one equity field',p &&
    p.effectiveCall===5 && p.contestablePot===55 && p.excludedPot===5 &&
    p.finalPot===60 && p.layeredEquity===false && close(p.need,5/60));
  const rendered=renderPrice(f), note=f.h.els.stripNote?.textContent||f.h.els.stripNote?.innerHTML||'';
  chk('equal-cap all-in renders the ordinary threshold and verdict',rendered &&
    f.h.els.valNeed.textContent==='8%' && f.h.els.verdict.textContent!=='layered pot' &&
    note===decisionNote(f,'Going all in for 5 creates a 60-chip pot you can contest. Your stack reaches 55 of the 60 chips already in the middle; 5 are above your cap.',8));
}

// A shallower all-in opponent contests only the main pot. One whole-pot equity
// percentage cannot truthfully decide the deeper layer against a different field.
{
  const f=fixture([
    {folded:false,bet:10,invested:10,stack:10},
    {folded:false,bet:5, invested:5, stack:0,allIn:true},
    {folded:false,bet:25,invested:25,stack:100},
  ],{currentBet:25});
  const p=priceOf(f);
  chk('shallower all-in marks a layered-equity price',p && p.toCall===15 &&
    p.effectiveCall===10 && p.contestablePot===35 && p.excludedPot===5 &&
    p.finalPot===45 && p.layeredEquity===true);
  f.S.players[1].allIn=false;
  const ordinary=renderWithSeed(f,314159);
  f.S.players[1].allIn=true;
  const render=renderWithSeed(f,314159), note=f.h.els.stripNote?.textContent||f.h.els.stripNote?.innerHTML||'';
  chk('layered all-in strip refuses a false single-threshold verdict',render.rendered &&
    f.h.els.valEq.textContent==='varies' && f.h.els.valNeed.textContent==='varies' &&
    f.h.els.barEq.style.width==='0%' && f.h.els.barNeed.style.width==='0%' &&
    f.h.els.verdict.textContent==='layered pot' &&
    note==='Going all in for 10 creates a 45-chip pot you can contest. Your stack reaches 35 of the 40 chips already in the middle; 5 are above your cap. Different opponents can win different layers, so one equity percentage cannot honestly label this call or fold.');
  chk('layered presentation preserves the ordinary equity RNG sequence',
    ordinary.draws>0 && render.draws===ordinary.draws && render.next===ordinary.next);
}

console.log(fails?'\n  TEACHING FAILURES PRESENT':'\n  short-stack teaching price is sound');
process.exitCode=fails?1:0;
