const make=require('./harness');
const makeExp=require('./exp/exp-harness');

console.log('LEGALITY TEST - engine action boundary\n');
let fails=0;
const chk=(name,ok,detail)=>{
  if(!ok) fails++;
  console.log(`  ${ok?'ok  ':'FAIL'} ${name}${detail?'   '+detail:''}`);
};

function fixture({bet=2,stack=100,currentBet=12,minRaise=6,acted=false,actedAtBet=0}={}){
  const h=make(()=>{});
  h.G.newSession();
  const S=h.G.S, p=S.players[1], q=S.players[2];
  S.done=false; S.street='flop'; S.currentBet=currentBet; S.minRaise=minRaise;
  S.raisedBefore=currentBet>0; S.streetBets=currentBet>0?1:0;
  S.streetAggressor=null; S.preflopRaiser=null; S.actionSeq=7;
  S.players.forEach(x=>{
    x.folded=true; x.allIn=false; x.bet=0; x.invested=0;
    x.acted=false; x.actedAtBet=0; x.lastAct='';
  });
  Object.assign(p,{folded:false,bet,invested:bet,stack,acted,actedAtBet});
  Object.assign(q,{folded:false,bet:currentBet,invested:currentBet,stack:100,acted:true,actedAtBet:currentBet});
  S.pot=bet+currentBet; S.toAct=p.idx;
  return {h,G:h.G,S,p,q};
}

const snap=({G,h})=>JSON.stringify({S:G.S,roster:G.roster,session:G.session,queue:h.queue.length});
const submit=(G,p,d,seq=G.legalActionView(p).actionSeq)=>
  G.applyAction(p,{...d,actionSeq:seq});
const rejectsUnchanged=(f,d,code,seq)=>{
  const before=snap(f), result=submit(f.G,f.p,d,seq), after=snap(f);
  return result.ok===false && result.code===code && before===after;
};

{
  const f=fixture(), before=snap(f), v=f.G.legalActionView(f.p);
  chk('view is pure',snap(f)===before);
  chk('view exposes literal call and raise bounds',v.ok && v.toCall===10 &&
    v.effectiveCall===10 && v.aggressive.action==='raise' &&
    v.aggressive.minBetTo===18 && v.aggressive.maxBetTo===102);
  chk('view exposes exactly fold, call, raise',
    v.actions.map(x=>x.action).join(',')==='fold,call,raise');
}

{
  const f=fixture({stack:7}), v=f.G.legalActionView(f.p);
  chk('short stack sees effective call, not unmatched wager',
    v.toCall===10 && v.effectiveCall===7 && v.aggressive===null);
  const beforePot=f.S.pot, beforeInvested=f.p.invested;
  const result=submit(f.G,f.p,{action:'call'});
  chk('short call moves exactly the remaining seven chips',result.ok &&
    f.p.bet===9 && f.p.stack===0 && f.p.allIn && f.S.currentBet===12 &&
    f.S.pot===beforePot+7 && f.p.invested===beforeInvested+7);
}

for(const amount of [18,102]){
  const f=fixture(), result=submit(f.G,f.p,{action:'raise',amount});
  chk(`raise-to ${amount} boundary succeeds`,result.ok && f.p.bet===amount &&
    f.p.stack===102-amount && f.S.currentBet===amount);
}

{
  const f=fixture(), v=f.G.legalActionView(f.p);
  const raw={action:'raise',amount:17,reason:'raise'};
  const fitted=f.G.policyActionForView(v,raw);
  chk('trusted Policy A client fits a legacy under-min size to the descriptor',
    raw.amount===17 && fitted.amount===18 && submit(f.G,f.p,fitted).ok && f.p.bet===18);
}
for(const [label,amount] of [['under',17],['over',103],['missing',undefined],
  ['string','18'],['fraction',18.5],['NaN',NaN],['infinity',Infinity]]){
  const f=fixture(), d={action:'raise'};
  if(label!=='missing') d.amount=amount;
  chk(`${label} raise amount rejects without mutation`,
    rejectsUnchanged(f,d,'amount-out-of-range'));
}

{
  const f=fixture({bet:2,stack:13}), v=f.G.legalActionView(f.p);
  chk('short all-in is the only aggressive endpoint',v.aggressive &&
    v.aggressive.minBetTo===15 && v.aggressive.maxBetTo===15 &&
    v.aggressive.fullRaiseMinBetTo===18 && v.aggressive.shortAllInOnly);
  const result=submit(f.G,f.p,{action:'raise',amount:15});
  chk('short all-in raises price but not minimum',result.ok && f.S.currentBet===15 &&
    f.S.minRaise===6 && f.p.allIn && /^all-in 15$/.test(f.p.lastAct));
}

{
  const h=make(()=>{}); h.G.newSession();
  const G=h.G,S=G.S,[a,b,c,d,e]=S.players.slice(1,6);
  S.done=false; S.street='flop'; S.currentBet=0; S.minRaise=2;
  S.raisedBefore=false; S.streetBets=0; S.actionSeq=0;
  S.players.forEach(x=>{
    x.folded=true; x.allIn=false; x.bet=0; x.invested=0; x.stack=200;
    x.acted=false; x.actedAtBet=0; x.lastAct='';
  });
  for(const x of [a,b,c,d,e]) x.folded=false;
  const play=(p,d)=>{ S.toAct=p.idx; return submit(G,p,d); };

  play(a,{action:'bet',amount:10});
  const staleCall={action:'call',actionSeq:G.legalActionView(c).actionSeq};
  play(c,{action:'call'});
  b.stack=15;
  const shortView=(()=>{ S.toAct=b.idx; return G.legalActionView(b); })();
  chk('incomplete raise endpoint is exactly all-in 15',shortView.aggressive &&
    shortView.aggressive.minBetTo===15 && shortView.aggressive.maxBetTo===15);
  submit(G,b,{action:'raise',amount:15},shortView.actionSeq);

  S.toAct=c.idx;
  const cView=G.legalActionView(c);
  chk('prior caller may call or fold but may not raise',cView.effectiveCall===5 &&
    cView.aggressive===null && cView.actions.map(x=>x.action).join(',')==='fold,call');
  const cState={G,h,p:c}, before=snap(cState);
  const forbidden=submit(G,c,{action:'raise',amount:25});
  chk('raise right rejects before any mutation',!forbidden.ok &&
    forbidden.code==='action-not-legal' && snap(cState)===before);
  const beforeStale=snap(cState), staleResult=G.applyAction(c,staleCall);
  chk('prior-turn call revision rejects before any mutation',!staleResult.ok &&
    staleResult.code==='stale-action' && snap(cState)===beforeStale);

  S.toAct=d.idx;
  const dView=G.legalActionView(d);
  chk('unacted player retains a full raise',dView.aggressive &&
    dView.aggressive.minBetTo===25 && dView.aggressive.maxBetTo===200);

  play(c,{action:'call'});
  e.stack=20; S.toAct=e.idx;
  const eResult=submit(G,e,{action:'raise',amount:20},G.legalActionView(e).actionSeq);
  chk('first cumulative short raise lands at 20 without changing the minimum',
    eResult.ok && S.currentBet===20 && S.minRaise===10);
  S.toAct=c.idx;
  const notCumulative=G.legalActionView(c);
  chk('calling an intermediate short raise resets the reopening baseline',
    !notCumulative.raiseReopened && notCumulative.aggressive===null);

  d.stack=25; S.toAct=d.idx;
  const dResult=submit(G,d,{action:'raise',amount:25},G.legalActionView(d).actionSeq);
  chk('second cumulative short raise lands at 25 without changing the minimum',
    dResult.ok && S.currentBet===25 && S.minRaise===10);
  S.toAct=c.idx;
  const cumulative=G.legalActionView(c);
  chk('cumulative short raises totaling a full raise reopen action',
    cumulative.raiseReopened && cumulative.aggressive && cumulative.aggressive.minBetTo===35);
}

{
  const f=fixture(); f.q.allIn=true;
  const v=f.G.legalActionView(f.p);
  chk('no raise is offered when every opponent is all-in',v.ok &&
    v.aggressive===null && v.actions.map(x=>x.action).join(',')==='fold,call');
  chk('empty-side-pot raise rejects without mutation',
    rejectsUnchanged(f,{action:'raise',amount:18},'action-not-legal'));
}

{
  const f=fixture();
  Object.assign(f.q,{bet:2,invested:2,stack:10,acted:false,actedAtBet:0});
  f.S.pot=4;
  const v=f.G.legalActionView(f.p);
  chk('no raise is offered when no opponent can contest chips above the call',
    v.ok && v.effectiveCall===10 && v.aggressive===null);
  chk('uncontestable raise rejects without mutation',
    rejectsUnchanged(f,{action:'raise',amount:18},'action-not-legal'));
}

{
  const h=makeExp(()=>{}, {seed:'legal-loop',decide:()=>({action:'raise',amount:999})});
  h.G.newSession(); h.queue.length=0;
  const G=h.G,S=G.S,[a,b,c]=S.players.slice(1,4);
  S.done=false; S.street='flop'; S.currentBet=0; S.minRaise=2;
  S.raisedBefore=false; S.streetBets=0; S.actionSeq=0;
  S.players.forEach(x=>{
    x.folded=true; x.allIn=false; x.bet=0; x.invested=0; x.stack=200;
    x.acted=false; x.actedAtBet=0; x.lastAct='';
  });
  S.pot=0;
  for(const x of [a,b,c]) x.folded=false;
  const play=(p,d)=>{
    S.toAct=p.idx;
    const v=G.legalActionView(p);
    return G.applyAction(p,{...d,actionSeq:v.actionSeq});
  };
  play(a,{action:'bet',amount:10});
  play(c,{action:'call'});
  b.stack=15; play(b,{action:'raise',amount:15});
  S.toAct=G.nextToAct(b.idx);
  const returned=S.toAct===c.idx;
  G.step();
  const queued=h.queue.shift();
  if(queued) queued();
  chk('real loop returns the prior caller after a short all-in',returned && !!queued);
  chk('illegal queued bot raise uses the fail-closed fallback and continues',
    c.folded && c.lastAct==='fold' && S.toAct!==c.idx && h.queue.length>0);
  const next=h.queue.shift();
  if(next) next();
  chk('continued loop executes the next actor and completes the uncontested hand',
    !!next && a.folded && S.done);
}

function heroFixture(stack=7){
  const h=make(()=>{}); h.G.newSession(); h.queue.length=0;
  const G=h.G,S=G.S,hero=S.players[0],q=S.players[1];
  S.done=false; S.street='flop'; S.currentBet=12; S.minRaise=6;
  S.raisedBefore=true; S.streetBets=1; S.actionSeq=4;
  S.players.forEach(x=>{
    x.folded=true; x.allIn=false; x.bet=0; x.invested=0;
    x.acted=false; x.actedAtBet=0; x.lastAct='';
  });
  Object.assign(hero,{folded:false,bet:2,invested:2,stack});
  Object.assign(q,{folded:false,bet:12,invested:12,stack:100,acted:true,actedAtBet:12});
  S.pot=14; S.toAct=hero.idx;
  return {h,G,S,hero,q};
}

{
  const f=heroFixture();
  f.G.renderActions();
  const buttons=f.h.els.actions.children;
  chk('real hero controls show only Fold and effective Call 7',buttons.length===2 &&
    /^Fold/.test(buttons[0].innerHTML) && /^Call/.test(buttons[1].innerHTML) &&
    />7<\//.test(buttons[1].innerHTML));
  buttons[1].onclick();
  chk('real Call button submits the legal short all-in',
    f.hero.stack===0 && f.hero.bet===9 && f.hero.allIn && f.S.currentBet===12);
}

{
  const f=heroFixture(100);
  f.G.renderActions();
  const staleButton=f.h.els.actions.children[1];
  f.S.actionSeq++;
  const before=snap({G:f.G,h:f.h,p:f.hero});
  staleButton.onclick();
  chk('real stale hero click neither mutates nor advances the turn',
    snap({G:f.G,h:f.h,p:f.hero})===before && f.S.toAct===f.hero.idx);
}

for(const [name,makeCase,d,code] of [
  ['null action',()=>fixture(),null,'malformed-action'],
  ['array action',()=>fixture(),[],'malformed-action'],
  ['missing verb',()=>fixture(),{},'malformed-action'],
  ['unknown verb',()=>fixture(),{action:'shove'},'action-not-legal'],
  ['check facing wager',()=>fixture(),{action:'check'},'action-not-legal'],
  ['wrong aggressive verb',()=>fixture(),{action:'bet',amount:18},'action-not-legal'],
]){
  const f=makeCase();
  const before=snap(f);
  const view=f.G.legalActionView(f.p);
  const action=d&&typeof d==='object'&&!Array.isArray(d)?{...d,actionSeq:view.actionSeq}:d;
  const result=f.G.applyAction(f.p,action);
  chk(`${name} rejects without mutation`,!result.ok && result.code===code && snap(f)===before);
}

{
  const f=fixture(), current=f.G.legalActionView(f.p).actionSeq;
  chk('stale revision rejects without mutation',
    rejectsUnchanged(f,{action:'call'},'stale-action',current-1));
}
{
  const f=fixture(); f.S.toAct=f.q.idx;
  const before=snap(f), result=f.G.applyAction(f.p,{action:'call',actionSeq:7});
  chk('out-of-turn actor rejects without mutation',!result.ok &&
    result.code==='out-of-turn' && snap(f)===before);
}
{
  const f=fixture(); f.p.folded=true;
  const before=snap(f), result=f.G.applyAction(f.p,{action:'call',actionSeq:7});
  chk('folded actor rejects without mutation',!result.ok &&
    result.code==='actor-folded' && snap(f)===before);
}
{
  const f=fixture(); f.p.allIn=true;
  const before=snap(f), result=f.G.applyAction(f.p,{action:'call',actionSeq:7});
  chk('all-in actor rejects without mutation',!result.ok &&
    result.code==='actor-all-in' && snap(f)===before);
}
{
  const f=fixture(); f.S.done=true;
  const before=snap(f), result=f.G.applyAction(f.p,{action:'call',actionSeq:7});
  chk('closed hand rejects without mutation',!result.ok &&
    result.code==='hand-closed' && snap(f)===before);
}
{
  const f=fixture(), old=f.p;
  f.G.newHand();
  const current={G:f.G,h:f.h,p:old}, before=snap(current);
  const result=f.G.applyAction(old,{action:'call',actionSeq:7});
  chk('actor retained from an old hand rejects without mutation',!result.ok &&
    result.code==='unknown-actor' && snap(current)===before);
}

console.log(fails?`\n  ${fails} FAILED`:'\n  legal-action boundary is sound');
process.exitCode=fails?1:0;
