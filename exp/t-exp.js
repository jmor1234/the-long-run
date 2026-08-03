// Experiment foundations test — step 1 gate.
// Any line starting BUG or FAIL is a regression (same convention as ../t*.js).
const make=require('./exp-harness');
const {normalize}=require('./legality');
const {makeOracle, runOracleSession}=require('./oracle');

console.log('EXP TEST — seeded streams, oracle replay, legality\n');
// Fail closed: only a completed summarize() may clear this. A hang or throw
// in the async oracle block otherwise exits 0 while printing FAIL lines.
process.exitCode=1;
let fail=0;
const ok=(cond,name,detail)=>{
  if(!cond) fail++;
  console.log(`  ${cond?'ok  ':'FAIL'} ${name}${detail?'   '+detail:''}`);
};
const submit=(G,p,d)=>{
  const view=G.legalActionView(p);
  return G.applyAction(p,{...d,actionSeq:view.actionSeq});
};

const checkFoldHero=(G)=>{
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  submit(G,hero,toCall>0?{action:'fold'}:{action:'check'});
  S.toAct=G.nextToAct(S.toAct);
  G.step();
};

// Per-hand fingerprints. deal = hole cards + remaining deck (full shuffle order
// given n); play = actions + reasons + final stacks (decision determinism).
function runBaseline(seed, hands, opts={}){
  const h=make(checkFoldHero, {seed, decide:opts.decide||null});
  const deals=[], plays=[], totals=[];
  h.G.newSession(); h.drain();
  let lastHands=h.G.session.hands;
  for(let i=0;i<hands && !h.G.session.over;i++){
    h.G.newHand();
    if(h.G.session.over) break;
    const S=h.G.S;
    deals.push(JSON.stringify({n:S.n, holes:S.players.map(p=>p.cards), deck:S.deck}));
    h.drain();
    if(h.G.session.hands===lastHands) break; // stale S after gameOver
    lastHands=h.G.session.hands;
    plays.push(JSON.stringify({log:S.log.map(l=>l.text), dec:S.decisions}));
    totals.push(h.G.roster.reduce((a,p)=>a+p.stack,0));
  }
  return {deals, plays, totals, state:h.state, G:h.G};
}

// --- 1. same seed, same arm => byte-identical sessions -----------------
{
  const a=runBaseline('det-1', 60), b=runBaseline('det-1', 60);
  ok(a.deals.length===b.deals.length && a.deals.every((d,i)=>d===b.deals[i]),
    'same seed reproduces identical deals', `${a.deals.length} hands`);
  ok(a.plays.every((p,i)=>p===b.plays[i]),
    'same seed reproduces identical decisions and outcomes');
  const c=runBaseline('det-2', 60);
  ok(c.deals[0]!==a.deals[0], 'different seed produces different deals');
}

// --- 2. chips conserved + no stray draws under the stream split --------
{
  const a=runBaseline('cons-1', 200);
  ok(a.totals.every(t=>t===1200), 'chips total exactly 1200 every hand',
    `${a.totals.length} hands`);
  ok(a.state.strayDraws===0, 'zero RNG draws outside session/deal/decision windows',
    `strayDraws=${a.state.strayDraws}`);
}

// --- 3. deals identical across arms (duplicate-poker property) ---------
// Structurally guaranteed today (deal stream keyed by hand index alone);
// kept as regression insurance against a future order-dependent PRNG.
// The load-bearing stream-isolation check is strayDraws===0 above.
{
  const stub=(ctx)=>({action: ctx.toCall>0?'fold':'check', reason:'stub arm'});
  // A bust shrinks one arm's roster and ends that seed's comparable window,
  // so accumulate across seeds until enough hands have been compared.
  let compared=0, same=true;
  for(let sIdx=1; sIdx<=5 && compared<10; sIdx++){
    const a=runBaseline('dup-'+sIdx, 40);
    const b=runBaseline('dup-'+sIdx, 40, {decide:stub});
    for(let i=0;i<Math.min(a.deals.length,b.deals.length);i++){
      const an=JSON.parse(a.deals[i]).n, bn=JSON.parse(b.deals[i]).n;
      if(an!==bn) break; // rosters diverged; hole assignment no longer comparable
      compared++;
      if(a.deals[i]!==b.deals[i]) same=false;
    }
  }
  ok(compared>=10 && same, 'different decision-makers, same seed, identical deals',
    `${compared} hands compared`);
}

// --- 3b. sizing spread (C2 gate; numbers frozen from the reachable-set table)
{
  const opens={}, postflop=new Set(), betRatios={};
  let underMin=0, overStack=0, betsSeen=0;
  const spy=(ctx,meta,fall)=>{
    const d=fall(ctx);
    if((d.action==='bet'||d.action==='raise') && d.amount!==undefined){
      betsSeen++;
      const r=normalize({action:d.action, amount:d.amount},
        {toCall:ctx.toCall, currentBet:ctx.currentBet, minRaise:ctx.minRaise,
         myBet:ctx.myBet, stack:ctx.myStack});
      for(const c of r.clamps){
        if(c.code==='amount-under-min') underMin++;
        if(c.code==='amount-over-stack') overStack++;
      }
      if(ctx.street==='preflop' && !ctx.raisedBefore && d.action==='raise')
        (opens[ctx.style.tag]=opens[ctx.style.tag]||[]).push(d.amount);
      if(ctx.street!=='preflop'){
        postflop.add(d.amount);
        if(d.action==='bet' && ctx.pot>0)
          (betRatios[ctx.style.tag]=betRatios[ctx.style.tag]||[]).push(d.amount/ctx.pot);
      }
    }
    return d;
  };
  for(let i=1;i<=6;i++){
    const h=make(checkFoldHero,{seed:'size-'+i, decide:spy});
    h.G.newSession(); h.drain();
    let last=h.G.session.hands;
    while(h.G.session.hands<60 && !h.G.session.over){
      h.G.newHand(); h.drain();
      if(h.G.session.hands===last) break;
      last=h.G.session.hands;
    }
  }
  const tags=['nit','solid','maniac','selective','station'];
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const pooled=new Set(); let perOk=true;
  for(const t of tags){ const a=opens[t]||[]; a.forEach(v=>pooled.add(v));
    if(new Set(a).size<2 || a.length<10) perOk=false; }
  ok(perOk, 'every persona opens with >=2 distinct sizes (>=10 opens each)',
    JSON.stringify(Object.fromEntries(tags.map(t=>[t,[...new Set(opens[t]||[])].sort((x,y)=>x-y)]))));
  ok(pooled.size>=5, 'pooled open sizes >=5 distinct', [...pooled].sort((x,y)=>x-y).join(','));
  const m=Object.fromEntries(tags.map(t=>[t,mean(opens[t]||[0])]));
  ok(m.station<m.nit && m.nit<Math.min(m.solid,m.selective) && Math.max(m.solid,m.selective)<m.maniac,
    'open size means ordered station < nit < solid~selective < maniac',
    JSON.stringify(m,(k,v)=>typeof v==='number'?+v.toFixed(2):v));
  // Discriminative postflop check: mean bet-to-pot ratio must follow the size
  // dial (maniac 1.25 > solid 1.00 > nit 0.85) — false on the pre-C2 engine.
  const rMean=t=>{const a=betRatios[t]||[]; return a.reduce((x,y)=>x+y,0)/(a.length||1);};
  ok((betRatios.maniac||[]).length>=15 && (betRatios.solid||[]).length>=15 && (betRatios.nit||[]).length>=10
     && rMean('maniac')>rMean('solid') && rMean('solid')>rMean('nit'),
    'postflop bet/pot ratio follows the size dial (maniac > solid > nit)',
    `maniac ${rMean('maniac').toFixed(2)}, solid ${rMean('solid').toFixed(2)}, nit ${rMean('nit').toFixed(2)}`);
  ok(overStack===0,
    'coded policy never exceeds its stack; trusted client owns the legal floor',
    `${betsSeen} bets checked, ${underMin} below-floor raw sizes fitted`);
}

// --- 3c. soft call/fold boundary (C3 gate) -----------------------------
// Boundary "errors" are read from the emitted equity narrative (independent
// of the logistic's internals) and normalized by opportunities so the check
// tests persona SHAPE, not sample-size artifacts.
{
  // The boundary branch carries its equity math as machine-readable dbg
  // fields (prose is persona voice since C4); the gate reads the data.
  const loose={}, tight={}, opps={};
  const spy=(ctx,meta,fall)=>{
    const d=fall(ctx);
    if(d.dbg && d.dbg.effPct!==undefined){
      const t=ctx.style.tag;
      opps[t]=(opps[t]||0)+1;
      if(d.action==='call' && d.dbg.effPct<d.dbg.needPct) loose[t]=(loose[t]||0)+1;
      if(d.action==='fold' && d.dbg.effPct>d.dbg.needPct) tight[t]=(tight[t]||0)+1;
    }
    return d;
  };
  for(let i=1;i<=10;i++){
    const h=make(checkFoldHero,{seed:'soft-'+i, decide:spy});
    h.G.newSession(); h.drain();
    let last=h.G.session.hands;
    while(h.G.session.hands<60 && !h.G.session.over){
      h.G.newHand(); h.drain();
      if(h.G.session.hands===last) break;
      last=h.G.session.hands;
    }
  }
  const rate=t=>((loose[t]||0)+(tight[t]||0))/(opps[t]||1);
  ok((loose.station||0)>=1, 'station makes genuinely loose calls (equity below price)',
    (loose.station||0)+' loose calls');
  ok((opps.nit||0)>=25 && (opps.station||0)>=40,
    'boundary sample is large enough per persona',
    `nit ${opps.nit||0} spots, station ${opps.station||0}`);
  ok(((loose.station||0)+(tight.station||0))>=3 && rate('station')>=2*rate('nit'),
    'boundary error RATE is persona-shaped: station at least twice nit',
    `station ${(rate('station')*100).toFixed(1)}%, nit ${(rate('nit')*100).toFixed(1)}%`);
}

// --- 3d. dbg-roll correspondence (C1 invariant) -------------------------
// Since C4 the governing rolls ride as dbg data instead of prose. Every dbg
// roll must be a draw THIS decision actually consumed (exact float match),
// and a limp-band decision's two rolls must be distinct values — a shared-
// roll regression makes them identical.
{
  let checked=0, wrong=0, limpSeen=0, limpDistinct=0;
  let cur=null;
  const ROLLS=['openRoll','limpRoll','premRoll','dRoll','sRoll','betRoll','strongRoll','bluffRoll','cRoll'];
  const spy=(ctx,meta,fall)=>{
    const d=fall(ctx);
    if(d.dbg && cur){
      const drawn=cur.state.lastDraws;
      const quoted=ROLLS.map(k=>d.dbg[k]).filter(v=>v!==undefined);
      if(quoted.length){
        checked++;
        if(!quoted.every(v=>drawn.includes(v))) wrong++;
      }
      if(d.dbg.limpRoll!==undefined){
        limpSeen++;
        if(d.dbg.limpRoll!==d.dbg.openRoll) limpDistinct++;
      }
    }
    return d;
  };
  for(let i=1;i<=4;i++){
    const h=make(checkFoldHero,{seed:'rollq-'+i, decide:spy});
    cur=h;
    h.G.newSession(); h.drain();
    let last=h.G.session.hands;
    while(h.G.session.hands<40 && !h.G.session.over){
      h.G.newHand(); h.drain();
      if(h.G.session.hands===last) break;
      last=h.G.session.hands;
    }
  }
  ok(checked>=200 && wrong===0,
    'every dbg roll was actually drawn by that decision (exact match)',
    `${checked} decisions checked`);
  ok(limpSeen>=5 && limpDistinct===limpSeen,
    'limp-band decisions use two DISTINCT draws (decorrelation live)',
    `${limpDistinct}/${limpSeen}`);
  ok(make.EXPECTED_RAND_SITES===4,
    'harness site-count constant matches the C1 contract');
}

// --- 3e. voice text bans (C4 gate) --------------------------------------
// The frozen prose contract: no RNG talk, no counter quoting, no frequency
// self-narration, nothing the fairness scan bans, in ANY emitted reason.
{
  const BANNED=[/roll/i, /\d+ of \d+/, /% of the time/i, /\bbranch\b/i, /\bhero\b/i, /Math\./];
  let scanned=0; const hits=[];
  const spy=(ctx,meta,fall)=>{
    const d=fall(ctx);
    if(d.reason){
      scanned++;
      for(const re of BANNED) if(re.test(d.reason)) hits.push(String(re)+' -> '+d.reason.slice(0,70));
      // Slot-binding honesty: a check may never speak fold language (the
      // free-check bug class the round-2 panel caught).
      if(d.action==='check' && /fold/i.test(d.reason))
        hits.push('check speaks fold: '+d.reason.slice(0,70));
    }
    return d;
  };
  for(let i=1;i<=5;i++){
    const h=make(checkFoldHero,{seed:'voice-'+i, decide:spy});
    h.G.newSession(); h.drain();
    let last=h.G.session.hands;
    while(h.G.session.hands<40 && !h.G.session.over){
      h.G.newHand(); h.drain();
      if(h.G.session.hands===last) break;
      last=h.G.session.hands;
    }
  }
  ok(scanned>=800 && hits.length===0,
    'no banned tokens in any emitted reason', hits[0]||(scanned+' reasons scanned'));
}

// --- 3f. mood (C5 gate) -------------------------------------------------
{
  const h0=make(checkFoldHero,{seed:'mood-0'});
  const ms=h0.G.moodStep, md=h0.G.moodDials;
  // Arithmetic vs a HAND-COMPUTED table from the spec constants (decay 0.75,
  // tanh scale 25BB, weight 0.5, clamp [-1,1]) — not derived from the code.
  const table=[[-30,-0.41683],[0,-0.31262],[0,-0.23447],[50,0.30616]];
  let m=0, tableOk=true;
  for(const [d,exp] of table){ m=ms(m,d); if(Math.abs(m-exp)>1e-4) tableOk=false; }
  ok(tableOk, 'moodStep matches the hand-computed spec table', m.toFixed(5));
  let q=-1; for(let i=0;i<12;i++) q=ms(q,0);
  ok(Math.abs(q)<0.05, 'full tilt decays quiet within 12 hands (0.75^12=0.032)', q.toFixed(4));
  const st={open:1,bet:1,fold:1,limp:0.4,size:1,tag:'x'};
  const tilt=md(st,-1), rush=md(st,1);
  ok(tilt.bet<=1.3+1e-9 && st.fold/tilt.fold<=1.35+1e-9 && tilt.limp<=0.6+1e-9
     && tilt.size<=1.2+1e-9 && tilt.open===1 && rush.open===1 && rush.bet===1,
    'mood dial caps hold and open is never scaled');
  // Call-site guard: every bot's mood must equal moodStep fed with EXACTLY
  // its own per-hand stack delta — recomputed here from observed stacks.
  const h=make(checkFoldHero,{seed:'mood-1'});
  h.G.newSession(); h.drain();
  const expMood={};
  for(const r of h.G.roster) if(r.style) expMood[r.seat]=r.mood; // hand 1 already stepped
  let mism=0, guarded=0, last=h.G.session.hands;
  while(h.G.session.hands<40 && !h.G.session.over){
    const prev={};
    for(const r of h.G.roster) prev[r.seat]=r.stack;
    h.G.newHand(); h.drain();
    if(h.G.session.hands===last) break;
    last=h.G.session.hands;
    for(const r of h.G.roster){
      if(!r.style || prev[r.seat]===undefined) continue;
      if(prev[r.seat]<=0) continue; // busted before this hand: mood frozen
      expMood[r.seat]=ms(expMood[r.seat], (r.stack-prev[r.seat])/h.G.BB);
      guarded++;
      if(r.mood!==expMood[r.seat]) mism++;
    }
  }
  ok(guarded>=100 && mism===0,
    'endHand feeds each bot exactly its own stack delta (bitwise match)',
    `${guarded} bot-hands checked`);
  // Discriminative dial asserts (round-2 verify): rush must not touch fold;
  // tilt must genuinely loosen entries; saturation must clamp at exactly 1.
  const st2={open:1,bet:1,fold:1,limp:0.4,size:1,tag:'x'};
  const r2=md(st2,1), t2=md(st2,-1);
  ok(r2.fold===st2.fold, 'rush never loosens folding');
  ok(t2.limp>st2.limp*1.3, 'full tilt visibly loosens entries', t2.limp.toFixed(3));
  let sat=0; for(let i=0;i<4;i++) sat=ms(sat,50);
  ok(sat===1, 'mood saturates at the clamp, exactly 1', sat);
}

// --- 3g. all-in cap + roll governance (round-2 verify hardening) --------
{
  // Crafted short-stack ctx with chips already in front: the emitted raise
  // target must reach the true all-in (myBet+myStack), not the bare stack.
  // Independent oracle: hand + numbers chosen so bucket==='strong' and the
  // desired size (myBet+toCall+humanSize(pot*0.9)) far exceeds the stack.
  const h=make(checkFoldHero,{seed:'cap-1'});
  let sawAllIn=0, tries=0;
  for(let i=0;i<40 && !sawAllIn;i++){
    const d=h.G.botDecide({
      myCards:[{r:14,s:'s'},{r:14,s:'h'}],
      board:[{r:14,s:'d'},{r:9,s:'c'},{r:2,s:'s'}],
      street:'flop', toCall:10, pot:200, myStack:30, myBet:15,
      position:'BTN', raisedBefore:true, openThr:30, tableSize:3,
      inPosition:true, streetBets:1, facingReads:null,
      aggressorHadInitiative:false,
      style:{open:1,bet:3,fold:1,limp:0,size:1,sizeJitter:0.1,callTemp:0.03,tag:'solid'},
    });
    tries++;
    if(d.action==='raise'){ sawAllIn=1;
      ok(d.amount===45, 'short-stack raise targets the true all-in (myBet+myStack)', 'amount '+d.amount);
    }
  }
  ok(sawAllIn===1, 'crafted strong short-stack spot produced a raise to test', tries+' tries');
  // Roll governance: the dbg roll and its threshold must match the action.
  let govChecked=0, govWrong=0;
  const spy=(ctx,meta,fall)=>{
    const d=fall(ctx);
    if(d.dbg){
      if(d.dbg.betRoll!==undefined && d.dbg.betFreq!==undefined){
        govChecked++;
        if((d.dbg.betRoll<d.dbg.betFreq)!==(d.action==='bet')) govWrong++;
      }
      if(d.dbg.cRoll!==undefined && d.dbg.pCall!==undefined){
        govChecked++;
        if((d.dbg.cRoll<d.dbg.pCall)!==(d.action==='call')) govWrong++;
      }
      if(d.dbg.openRoll!==undefined && d.dbg.f!==undefined && ctx.street==='preflop' && !ctx.raisedBefore
         && ctx.myStack>ctx.toCall){
        govChecked++;
        if((d.dbg.openRoll<d.dbg.f)!==(d.action==='raise')) govWrong++;
      }
      if(d.dbg.premRoll!==undefined && d.dbg.threeBet!==undefined && ctx.myStack>ctx.toCall){
        govChecked++;
        if((d.dbg.premRoll<d.dbg.threeBet)!==(d.action==='raise')) govWrong++;
      }
      if(d.dbg.dRoll!==undefined && d.dbg.defendCall!==undefined){
        govChecked++;
        if((d.dbg.dRoll<d.dbg.defendCall)!==(d.action==='call')) govWrong++;
      }
      if(d.dbg.strongRoll!==undefined && d.dbg.raiseFreq!==undefined && ctx.myStack>ctx.toCall){
        govChecked++;
        if((d.dbg.strongRoll<d.dbg.raiseFreq)!==(d.action==='raise')) govWrong++;
      }
    }
    return d;
  };
  const h2=make(checkFoldHero,{seed:'gov-1', decide:spy});
  h2.G.newSession(); h2.drain();
  let last=h2.G.session.hands;
  while(h2.G.session.hands<40 && !h2.G.session.over){
    h2.G.newHand(); h2.drain();
    if(h2.G.session.hands===last) break;
    last=h2.G.session.hands;
  }
  ok(govChecked>=120 && govWrong===0,
    'six dbg roll/threshold pairs govern their actions (guard-aware)',
    govChecked+' checked, '+govWrong+' wrong');
  // Short stacks may never emit a raise, at any of the five raise sites.
  const shortCtxBase={board:[{r:14,s:'d'},{r:9,s:'c'},{r:2,s:'s'}], street:'flop',
    toCall:50, pot:200, myStack:30, myBet:10, position:'BTN', raisedBefore:true,
    openThr:30, tableSize:3, inPosition:true, streetBets:1, facingReads:null,
    aggressorHadInitiative:false,
    style:{open:1,bet:3,fold:1,limp:0.2,size:1,sizeJitter:0.1,callTemp:0.03,tag:'solid'}};
  let shortRaises=0;
  for(let i=0;i<30;i++){
    const a=h.G.botDecide({...shortCtxBase, myCards:[{r:14,s:'s'},{r:14,s:'h'}]});
    if(a.action==='raise') shortRaises++;
    const b=h.G.botDecide({...shortCtxBase, street:'preflop', board:[],
      myCards:[{r:14,s:'s'},{r:14,s:'h'}]});
    if(b.action==='raise') shortRaises++;
    const c=h.G.botDecide({...shortCtxBase, street:'preflop', board:[],
      raisedBefore:false, toCall:2, myStack:2, myBet:0,
      myCards:[{r:14,s:'s'},{r:14,s:'h'}]});
    if(c.action==='raise') shortRaises++;
  }
  ok(shortRaises===0,
    'a stack short of the call never emits a raise (open, 3-bet, postflop sites)',
    shortRaises+' illegal raises in 90 crafted spots');
  // Static exhaustive bank scan: every variant of every slot, banned tokens.
  // Each slot gets ONLY the fields its real call site passes, so a variant
  // referencing anything else leaks "undefined" here instead of to a player.
  const BANNED=[/roll/i, /\d+ of \d+/, /% of the time/i, /\bbranch\b/i, /\bhero\b/i, /Math\./];
  const SAMPLE={nm:'K9s', hand:'a solid hand', draw:'Four to a flush', eff:40, need:30};
  const FIELDS={open:['nm'],limp:['nm'],foldWeak:['nm'],limpPass:['nm'],prem3bet:['nm'],
    premFlat:['nm'],defendCall:['nm'],defendFold:['nm'],spewCall:['nm'],bluff3bet:['nm'],
    outsideFold:['nm'],freeCheck:['nm'],bet:['hand'],check:['hand'],airBet:[],
    semiBluff:['draw'],strongRaise:[],slowCall:[],bluffRaise:['draw'],
    edgeCall:['eff','need'],edgeFold:['eff','need'],tilt:[],rush:[]};
  let variants=0; const bad=[];
  for(const [tag,slots] of Object.entries(h.G.VOICE)){
    for(const [slot,bank] of Object.entries(slots)){
      if(!(slot in FIELDS)){ bad.push('unmapped slot '+slot+' — add its call-site fields'); continue; }
      const d=Object.fromEntries(FIELDS[slot].map(k=>[k,SAMPLE[k]]));
      for(const t of bank){
        variants++;
        const txt=t(d);
        for(const re of BANNED) if(re.test(txt)) bad.push(tag+'.'+slot+': '+txt.slice(0,50));
        if(/undefined/.test(txt)) bad.push(tag+'.'+slot+' uses a field its call site never passes: '+txt.slice(0,50));
      }
    }
  }
  ok(variants>=200 && bad.length===0,
    'entire VOICE bank is statically clean (call-site-accurate fields)',
    bad[0]||(variants+' variants scanned'));
}

// --- 4. ctx carries the betting state the legality view needs ----------
{
  let seen=null;
  const spy=(ctx, meta, fall)=>{ if(!seen && ctx.toCall>0) seen=ctx; return fall(ctx); };
  runBaseline('ctx-1', 5, {decide:spy});
  ok(seen && ['currentBet','minRaise','myBet','toCall','myStack'].every(k=>typeof seen[k]==='number'),
    'ctx exposes currentBet/minRaise/myBet for the legality view');
}

// --- 5. legality normalizer (unit) --------------------------------------
{
  const v={toCall:10, currentBet:12, minRaise:6, myBet:2, stack:100};
  let r=normalize({action:'check'}, v);
  ok(r.d.action==='fold' && r.clamps[0].code==='check-facing-bet' && r.rawIllegal,
    'check facing a bet coerced to fold (engine would hang otherwise)');
  r=normalize({action:'raise', amount:14}, v);
  ok(r.d.amount===18 && r.clamps[0].code==='amount-under-min',
    'under-min raise clamped to min target', `amount 14 -> ${r.d.amount}`);
  r=normalize({action:'raise', amount:500}, v);
  ok(r.d.amount===102 && r.clamps[0].code==='amount-over-stack',
    'over-stack raise capped at all-in');
  r=normalize({action:'raise'}, v);
  ok(r.d.amount===18 && r.clamps[0].code==='missing-amount', 'missing amount -> min raise');
  r=normalize({action:'raise', amount:50}, {toCall:98, currentBet:100, minRaise:6, myBet:2, stack:60});
  ok(JSON.stringify(r.d)==='{"action":"call"}' && r.clamps[0].code==='raise-impossible',
    'raise with stack short of a call becomes a bare call (exact shape)');
  r=normalize({action:'shove'}, v);
  ok(r.d.action==='fold' && r.clamps[0].code==='unknown-action', 'unknown action coerced');
  r=normalize({action:'call'}, {toCall:0, currentBet:0, minRaise:2, myBet:0, stack:100});
  ok(r.d.action==='check' && r.rawIllegal, 'call with nothing to call -> check, counted');
  r=normalize({action:'raise', amount:1}, {toCall:59, currentBet:61, minRaise:6, myBet:2, stack:60});
  ok(r.d.action==='raise' && r.d.amount===62 && r.clamps[0].code==='amount-under-min',
    'short all-in raise target capped at all-in, not min-raise');
  r=normalize({action:'call'}, v);
  ok(r.clamps.length===0 && !r.rawIllegal, 'legal call passes untouched');
  // LLM-shaped input: casing, whitespace, fractions, verb confusion
  r=normalize({action:'Fold'}, v);
  ok(r.d.action==='fold' && r.clamps.length===0, 'capitalized action normalized silently');
  r=normalize({action:'  RAISE  ', amount:20}, v);
  ok(r.d.action==='raise' && r.d.amount===20 && r.clamps.length===0, 'padded uppercase action normalized');
  r=normalize({action:'raise', amount:18.6}, v);
  ok(r.d.amount===19 && r.clamps.length===0, 'fractional amount rounded');
  r=normalize({action:'bet', amount:30}, v);
  ok(r.d.action==='raise' && r.d.amount===30 && !r.rawIllegal && r.clamps[0].code==='bet-should-be-raise',
    'bet facing a bet relabelled raise, counted but not illegal');
  r=normalize({action:'raise', amount:6}, {toCall:0, currentBet:0, minRaise:2, myBet:0, stack:100});
  ok(r.d.action==='bet' && r.d.amount===6 && !r.rawIllegal && r.clamps[0].code==='raise-should-be-bet',
    'raise in unopened pot relabelled bet, counted but not illegal');
  r=normalize({action:'fold'}, {toCall:0, currentBet:0, minRaise:2, myBet:0, stack:100});
  ok(r.d.action==='check' && r.clamps[0].code==='fold-when-free' && r.rawIllegal,
    'fold when checking is free -> check, counted');
  r=normalize({action:'call', reason:'x'.repeat(2000)}, v);
  ok(r.d.reason.length===500, 'oversized reason capped');
}

// --- 6. legality vs applyAction: normalized amounts land as predicted ---
// Independent oracle: the ENGINE's post-state, not legality's own numbers.
{
  const h=make(checkFoldHero, {seed:'integ-1'});
  h.G.newSession(); h.drain();
  h.G.newHand(); // fresh preflop, blinds posted, bots queued but not drained
  const S=h.G.S;
  const bots=S.players.filter(p=>!p.isHero && p.bet===0);
  const view=(p)=>({toCall:S.currentBet-p.bet, currentBet:S.currentBet,
    minRaise:S.minRaise, myBet:p.bet, stack:p.stack});

  const p1=bots[0], r1=normalize({action:'raise', amount:3}, view(p1)); // under-min: floor to 4
  S.toAct=p1.idx; submit(h.G,p1,r1.d);
  ok(p1.bet===4 && p1.stack===196 && S.currentBet===4,
    'under-min raise lands at engine min target', `bet=${p1.bet} stack=${p1.stack}`);

  const p2=bots[1], r2=normalize({action:'raise', amount:99999}, view(p2)); // over-stack: all-in
  S.toAct=p2.idx; submit(h.G,p2,r2.d);
  ok(p2.bet===200 && p2.stack===0 && p2.allIn && S.currentBet===200,
    'over-stack raise lands as exact all-in');

  const p3=bots[2]; p3.stack=150; // short stack: raise impossible, becomes all-in call
  const r3=normalize({action:'raise', amount:400}, view(p3));
  S.toAct=p3.idx; submit(h.G,p3,r3.d);
  ok(r3.d.action==='call' && p3.bet===150 && p3.allIn && S.currentBet===200,
    'impossible raise becomes short all-in call, currentBet untouched');
}

// --- 7. prompt builder: purity, determinism, default-deny card scan ----
{
  const fs=require('fs');
  const crypto=require('crypto');
  const P=require('./prompt');
  const src=fs.readFileSync(require.resolve('./prompt'),'utf8');
  ok(!/Math\.random\s*\(|Date\.now\s*\(|new Date\s*\(|process\.|globalThis|\beval\s*\(|new Function|require\s*\(/.test(src),
    'prompt.js has no impurity markers (RNG, clock, env, eval, requires)');
  ok(/^'use strict';/.test(src), 'prompt.js is strict mode (frozen-ctx writes throw, not no-op)');

  // These hashes were captured before the action-only boundary was added.
  // They prevent new-provider work from silently changing the historical pilot.
  const legacyHashes={
    nit:'55e9a1ab384f962c479332a7483ee21af6c374644bcba432c6f52d5ade8ec797',
    solid:'f4d3577f9745439e4cb17b3d6d9fe08db0713891e7a0054430f1d6d56483d32f',
    maniac:'b667fb3c87a1385ab03004abc7f42fb2700c76104bd033c978d70f21672ee585',
    selective:'e90a52b81f3782a1142d07c6f712326ca963f90a79f0054c9357858ab4288cb0',
    station:'7d0b73b01c8e3dabe40af459d7e03e3fef8d4c8603d56dae8b7fd70254b79f53',
  };
  const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
  ok(Object.entries(legacyHashes).every(([tag,hash])=>sha(P.buildPrefix(tag))===hash),
    'historical persona prefixes remain byte-for-byte stable');
  ok(sha(JSON.stringify(P.OUTPUT_SCHEMA))===
    'd9b80b01af3f38b936dca44fe6d145e3ad9d1064e8f3fd85d20552f8401a7c00',
    'historical output schema remains byte-for-byte stable');

  // every persona prefix: exact two-way match with the declared example cards
  // (a superset-only check lets both the prose and the list drift), and
  // plausibly cache-sized
  const used=new Set();
  let minLen=Infinity;
  for(const tag of Object.keys(P.PERSONAS)){
    const pre=P.buildPrefix(tag);
    minLen=Math.min(minLen, pre.length);
    for(const tok of P.scanCards(pre)) used.add(tok);
  }
  const declared=new Set(P.EXAMPLE_CARDS);
  ok(used.size===declared.size && [...used].every(c=>declared.has(c)),
    'prefix cards exactly match the declared example whitelist',
    `used ${used.size}, declared ${declared.size}`);
  ok(minLen>=17000, 'every persona prefix is plausibly above the 4096-token cache minimum',
    `${minLen} chars (exact token count verified in the pilot)`);
  let protoThrew=0;
  for(const bad of ['constructor','__proto__','hasOwnProperty']){
    try{ P.buildPrefix(bad); }catch(e){ protoThrew++; }
    try{ P.buildActionPrefix(bad); }catch(e){ protoThrew++; }
  }
  ok(protoThrew===6, 'both prefix builders reject prototype-chain persona tags');
  const actionPrefixes=Object.keys(P.PERSONAS).map(tag=>P.buildActionPrefix(tag));
  ok(actionPrefixes.every(pre=>!(/WORKED EXAMPLES|"reason"|inner monologue|one or two sentences/i.test(pre))),
    'action-only prefixes contain no examples or narration contract');
  const actionHashes={
    nit:'c312a5b97c9e5719f262335176a562b81a8ce766b4b25a541282de48066d5e82',
    solid:'54278a889c928572b5f477294dc70524d96ac1482ca04be01d3c9daa9f67b1a9',
    maniac:'07725a9d085c8be0314dec8a0bea27561d440fe239a5f9977da94b5f395f0f7b',
    selective:'c23ec2e554f2555a05178ba0801bc502f5e157fb34e43e8413556e0a26902f78',
    station:'d8849bbdb6fae22d947fbaa795b5807be5f0a35e59f2aa1373085280e8a716b0',
  };
  ok(Object.entries(actionHashes).every(([tag,hash])=>sha(P.buildActionPrefix(tag))===hash),
    'action-only persona prefixes match their frozen contract');

  // Production-shaped ctx has betting fields only inside legal. This literal
  // oracle catches accidental fallback to the harness-only top-level copies.
  const actionCtx={
    style:{tag:'solid'},street:'flop',position:'BTN',inPosition:true,
    myCards:[{r:14,s:'s'},{r:13,s:'s'}],
    board:[{r:2,s:'h'},{r:7,s:'c'},{r:11,s:'d'}],
    pot:40,myStack:90,myBet:10,toCall:10,streetBets:1,raisedBefore:false,
    facingReads:null,aggressorHadInitiative:false,
    legal:{ok:true,toCall:10,effectiveCall:10,contestablePot:40,excludedPot:0,
      finalPot:50,need:0.2,actions:[
      {action:'fold'},{action:'call',cost:10,allIn:false},
      {action:'raise',minBetTo:30,maxBetTo:100,shortAllInOnly:false},
    ],aggressive:{action:'raise',minBetTo:30,maxBetTo:100,shortAllInOnly:false}},
  };
  const openSpot=[
    'THE SITUATION',
    'Street: flop. You are in the button (best position), acting after your opponent (in position).',
    'Your cards: A♠ K♠.',
    'Board: 2♥ 7♣ J♦.',
    'Pot: 40. Your stack: 90. You have 10 in on this street.',
    'Available actions: fold, call, raise.',
    'Calling costs 10. You need 20% equity to call profitably.',
    'To raise, the total must be between 30 and 100 (all-in).',
    'Bets/raises this street so far: 1.',
    'You have no real read on the current aggressor yet.',
    'What do you do?',
  ].join('\n');
  ok(P.buildActionSpot(actionCtx)===openSpot,
    'action-only spot matches the production-shaped literal legal-view oracle');
  const closedCtx={...actionCtx,legal:{...actionCtx.legal,
    actions:[{action:'fold'},{action:'call',cost:10,allIn:false}],aggressive:null}};
  const closedSpot=openSpot
    .replace('Available actions: fold, call, raise.','Available actions: fold, call.')
    .replace('To raise, the total must be between 30 and 100 (all-in).\n','');
  ok(P.buildActionSpot(closedCtx)===closedSpot && !/NaN/.test(P.buildActionSpot(closedCtx)),
    'action-only spot omits aggression when raising is not reopened');
  const shortCtx={...actionCtx,myStack:7,pot:40,legal:{
    ok:true,toCall:10,effectiveCall:7,contestablePot:33,excludedPot:7,
    finalPot:40,need:0.175,actions:[
      {action:'fold'},{action:'call',cost:7,allIn:true},
    ],aggressive:null,
  }};
  const shortSpot=P.buildActionSpot(shortCtx);
  ok(shortSpot.includes('Pot you can contest: 33. Another 7 chips are in a deeper layer you cannot win.') &&
    shortSpot.includes('Calling puts your last 7 chips in. You need 18% equity') &&
    !shortSpot.includes('Pot: 40.'),
    'action-only spot prices a short call against only the contestable pot');
  let noLegalThrew=false;
  try{ P.buildActionSpot({...actionCtx,legal:null}); }catch(e){ noLegalThrew=true; }
  ok(noLegalThrew, 'action-only spot fails closed without the engine legal view');

  // determinism + frozen-ctx purity + live scan across real decisions.
  // Two passes in OPPOSITE orders so module-level state or memoization keyed
  // on call order would surface; ctx snapshot proves buildPrompt mutates nothing.
  const seen=[];
  const spy=(ctx, meta, fall)=>{ if(seen.length<300) seen.push(JSON.parse(JSON.stringify(ctx))); return fall(ctx); };
  runBaseline('prompt-1', 40, {decide:spy});
  const deepFreeze=(o)=>{Object.freeze(o); for(const v of Object.values(o)) if(v&&typeof v==='object') deepFreeze(v); return o;};
  let scanned=0, threw=0, mutated=0;
  const passA=[];
  const actionPassA=[];
  for(const ctx of seen){
    const before=JSON.stringify(ctx);
    try{
      passA.push(P.buildPrompt(deepFreeze(ctx)));
      actionPassA.push(P.buildActionPrompt(ctx));
      scanned++;
    }catch(e){ threw++; passA.push(null); actionPassA.push(null); }
    if(JSON.stringify(ctx)!==before) mutated++;
  }
  let deterministic=true;
  for(let i=seen.length-1;i>=0;i--){ // reverse order
    if(!passA[i]) continue;
    const b=P.buildPrompt(seen[i]);
    const a=P.buildActionPrompt(seen[i]);
    if(b.prefix!==passA[i].prefix || b.spot!==passA[i].spot ||
        a.prefix!==actionPassA[i].prefix || a.spot!==actionPassA[i].spot) deterministic=false;
  }
  ok(threw===0 && scanned>=200, 'buildPrompt runs clean on real frozen ctx across decisions',
    `${scanned} decisions, ${threw} threw`);
  ok(mutated===0, 'buildPrompt never mutates ctx');
  ok(deterministic, 'buildPrompt is deterministic and order-independent');

  // the tripwire must fire on a foreign card — both on a literal and when
  // injected into a REAL spot produced by the live code path
  let trip=0;
  try{ P.assertNoForeignCards('he showed K♦ earlier', {myCards:[{r:14,s:'s'},{r:13,s:'s'}], board:[]}); }
  catch(e){ if(/card leak/.test(e.message)) trip++; }
  const realCtx=seen.find(c=>c.toCall>0)||seen[0];
  const inCtx=new Set(P.scanCards(P.buildSpot(realCtx)));
  const foreign=['2♠','3♦','9♠','5♥','K♣'].find(c=>!inCtx.has(c));
  try{ P.assertNoForeignCards(P.buildSpot(realCtx)+` and he tabled ${foreign}`, realCtx); }
  catch(e){ if(/card leak/.test(e.message)) trip++; }
  ok(trip===2, 'foreign-card scan trips on literals and on a poisoned real spot');

  // The OpenAI module is deliberately only a pure request/response boundary.
  // No SDK, key, network call, fallback policy, or spend behavior belongs here.
  const O=require('./openai-decision');
  const req=O.buildRequest(realCtx);
  const schema={
    type:'object',
    properties:{
      action:{type:'string',enum:['fold','check','call','bet','raise']},
      amount:{type:['integer','null'],description:'bet-to total for bet/raise; null otherwise'},
    },
    required:['action','amount'],
    additionalProperties:false,
  };
  const requestContract=JSON.parse(JSON.stringify(req));
  requestContract.instructions='<action prefix>';
  requestContract.input='<spot>';
  requestContract.text.format.schema='<schema>';
  ok(JSON.stringify(requestContract)===JSON.stringify({
    model:'gpt-5.6-terra',
    reasoning:{effort:'low'},
    max_output_tokens:128,
    store:false,
    instructions:'<action prefix>',
    input:'<spot>',
    text:{format:{type:'json_schema',name:'poker_action',strict:true,schema:'<schema>'}},
  }), 'Terra request contract has the exact intended controls');
  ok(req.instructions===P.buildActionPrefix(realCtx.style.tag) && req.input===P.buildActionSpot(realCtx),
    'Terra request uses the action-only prefix and card-scanned live spot');
  ok(JSON.stringify(req.text.format.schema)===JSON.stringify(schema),
    'Terra structured-output schema matches an independent literal oracle');
  const amountTypes=req.text.format.schema.properties.amount.type;
  try{ amountTypes[0]='number'; req.text.format.schema.required.pop(); }
  catch(e){}
  const nextSchema=O.buildRequest(realCtx).text.format.schema;
  ok(amountTypes[0]==='integer' && nextSchema.required.length===2,
    'Terra schema is deeply immutable across requests');

  const response=text=>({status:'completed',output:[
    {type:'reasoning',summary:[]},
    {type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]},
  ]});
  const passive=O.parseResponse(response('{"action":"call","amount":null}'));
  const aggressive=O.parseResponse(response('{"action":"raise","amount":19}'));
  ok(JSON.stringify(passive)==='{"ok":true,"decision":{"action":"call"}}' &&
    JSON.stringify(aggressive)==='{"ok":true,"decision":{"action":"raise","amount":19}}',
    'Terra parser accepts strict actions and canonicalizes passive amount away');
  const rejects=[
    null,
    {status:'incomplete',output:[]},
    {status:'completed',output:[]},
    {status:'completed',output:[{type:'tool_call'}]},
    {status:'completed',output:[
      {type:'message',role:'assistant',content:[{type:'output_text',text:'{"action":"call","amount":null}'}]},
      {type:'message',role:'assistant',content:[{type:'output_text',text:'{"action":"call","amount":null}'}]},
    ]},
    {status:'completed',output:[{type:'message',role:'user',content:[]}]},
    {status:'completed',output:[{type:'message',role:'assistant',content:[
      {type:'output_text',text:'{"action":"call","amount":null}'},
    ]}]},
    {status:'completed',output:[{type:'message',role:'assistant',status:'incomplete',content:[]}]},
    {status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'no'}]}]},
    response('{'),
    response('null'),
    response('{"action":"call","amount":null,"reason":"because"}'),
    response('{"action":"shove","amount":12}'),
    response('{"action":"raise","amount":"19"}'),
    response('{"action":"call"}'),
    response('{"action":"call","amount":19}'),
    response('{"action":"raise","amount":null}'),
    {status:'completed',output:[{type:'message',role:'assistant',content:[
      {type:'output_text',text:'{"action":"call","amount":null}'},
      {type:'output_text',text:'{"action":"fold","amount":null}'},
    ]}]},
  ];
  let parserLeak=null;
  rejects.forEach((candidate,i)=>{
    try{
      const result=O.parseResponse(candidate);
      if(result.ok || result.decision || !result.error || !result.error.code) parserLeak=i;
    }catch(e){ parserLeak=i+' threw '+e.message; }
  });
  ok(parserLeak===null, 'Terra parser fails closed on malformed, refused, or ambiguous output',
    parserLeak===null?`${rejects.length} rejection cases`:String(parserLeak));
}

// --- 8. metric helpers vs hand-computed values --------------------------
// These feed the FROZEN numbers in PLAN.md; they get an independent oracle.
{
  const M=require('./metrics');
  const end={vpip:30, vpipOpps:100, pfr:20, pfrOpps:100, foldToBet:12, foldToBetOpps:20,
    threeBet:2, threeBetOpps:10, foldToCbet:1, foldToCbetOpps:4, agg:9, passive:6, hands:50};
  const mid={vpip:10, vpipOpps:40, pfr:8, pfrOpps:40, foldToBet:5, foldToBetOpps:8,
    threeBet:1, threeBetOpps:4, foldToCbet:0, foldToCbetOpps:1, agg:3, passive:3, hands:25};
  const r=M.rates(end);
  ok(r.vpip===0.3 && r.pfr===0.2 && r.f2bet===0.6 && r.threeBet===0.2 && r.af===1.5,
    'rates() matches hand-computed values');
  ok(M.rates({...end, passive:0}).af===null, 'AF is null (never a count) when passive=0');
  const second=M.diffReads(end, mid);
  ok(second.vpip===20 && second.vpipOpps===60 && second.agg===6,
    'diffReads yields exact second-half counters');
  ok(M.rates(second).vpip+''==='0.3333333333333333', 'second-half rate from diffed counters');
  const acc={};
  M.addTo(acc,'x',{a:1,b:2}); M.addTo(acc,'x',{a:4});
  ok(acc.x.a===5 && acc.x.b===2, 'addTo pools counters');
  ok(M.bb100(-600, 100, 2)===-300 && M.bb100(50, 500, 2)===5,
    'bb/100 matches hand-computed values');
}

// --- 9. spend guard: hand-computed cost, hard caps fire ----------------
{
  const {estimateCostUsd, makeSpendGuard}=require('./spend');
  // 300*$1 + 4000*$1.25 + 9000*$0.10 per MTok in, 60*$5 per MTok out = $0.0065
  const usage={input_tokens:300, cache_creation_input_tokens:4000,
    cache_read_input_tokens:9000, output_tokens:60};
  ok(Math.abs(estimateCostUsd(usage)-0.0065)<1e-12,
    'cost estimate matches hand-computed Haiku 4.5 rates', estimateCostUsd(usage));
  const g=makeSpendGuard({maxCalls:2, maxUsd:100});
  g.beforeCall(); g.record(usage); g.beforeCall(); g.record(usage);
  let calls=false; try{ g.beforeCall(); }catch(e){ calls=!!e.isSpendCap; }
  ok(calls, 'call cap throws before the call that would exceed it');
  const g2=makeSpendGuard({maxCalls:100, maxUsd:0.01});
  g2.beforeCall(); g2.record(usage); g2.record(usage);
  let usd=false; try{ g2.beforeCall(); }catch(e){ usd=!!e.isSpendCap; }
  ok(usd, 'USD cap throws once accrued cost crosses it', '$'+g2.usd.toFixed(4));
}

// --- 9b. parseDecision: paid-call fallback paths never throw ------------
{
  const {parseDecision}=require('./run-pilot');
  const cases=[
    ['truncated json', {stop_reason:'max_tokens', content:[{type:'text', text:'{"action":"ra'}]}],
    ['no text block', {stop_reason:'end_turn', content:[{type:'tool_use'}]}],
    ['empty content', {stop_reason:'end_turn', content:[]}],
    ['missing content', {stop_reason:'refusal'}],
    ['non-string text', {stop_reason:'end_turn', content:[{type:'text', text:null}]}],
  ];
  let bad=null;
  for(const [name,resp] of cases){
    try{
      const r=parseDecision(resp);
      if(!(r.raw===null && typeof r.parseError==='string' && r.parseError.length)) bad=name;
    }catch(e){ bad=name+' threw: '+e.message; }
  }
  ok(bad===null, 'parseDecision degrades every malformed response to null + parseError', bad);
  const norm=normalize(null, {toCall:2, currentBet:2, minRaise:2, myBet:0, stack:100});
  ok(norm.d.action==='fold' && norm.clamps.some(c=>c.code==='unknown-action') && norm.rawIllegal,
    'null decision becomes a counted unknown-action fold');
}

// --- 10. oracle: miss -> abort -> replay converges, ctx stable ----------
{
  (async()=>{
    let resolved=0;
    const {G, cache, attempts}=await runOracleSession({
      make, seed:'orc-1', hands:12, heroPolicy:checkFoldHero,
      resolvePending:(pending, cache)=>{
        for(const p of pending){
          resolved++;
          const d=normalize({action: p.ctx.toCall>0?'call':'check', reason:'external'},
            {toCall:p.ctx.toCall, currentBet:p.ctx.currentBet, minRaise:p.ctx.minRaise,
             myBet:p.ctx.myBet, stack:p.ctx.myStack}).d;
          cache.set(p.key, {ctxJson:p.ctxJson, d});
        }
      },
    });
    ok(G.session.hands===12, 'oracle session completed exactly 12 hands', `${G.session.hands}`);
    ok(attempts===cache.size+1, 'exactly one replay per cached decision',
      `${attempts} attempts, cache=${cache.size}`);
    ok(attempts===resolved+1, 'no attempt wasted', `resolved=${resolved}`);
    ok(G.roster.reduce((a,p)=>a+p.stack,0)===1200, 'chips conserved under oracle replay');
    // divergence detector is live: poison one cache entry and expect a loud failure
    const k=[...cache.keys()][0];
    cache.set(k, {ctxJson:'{"poisoned":true}', d:cache.get(k).d});
    let threw=false;
    try{
      await runOracleSession({make, seed:'orc-1', hands:12, heroPolicy:checkFoldHero,
        resolvePending:()=>{}, cache});
    }catch(e){ threw=/replay divergence/.test(e.message); }
    ok(threw, 'ctx divergence check trips on poisoned cache');

    // --- 11. pilot runner: stub arm end to end, resume, cap abort -------
    const fs=require('fs');
    const path=require('path');
    const {runPilot, makeStubClient}=require('./run-pilot');
    const outDir=path.join(__dirname,'out','t-exp-pilot');
    fs.rmSync(outDir,{recursive:true,force:true});
    const cfg={sessions:1, hands:3, seed:'texp-p', mode:'stub',
      maxCalls:10000, maxUsd:100, outDir, quiet:true};
    const s1=await runPilot({...cfg, client:makeStubClient()});
    ok(s1.volume.totalHands===3 && s1.volume.decisions>0,
      'stub pilot plays the session through the oracle', `${s1.volume.decisions} decisions`);
    ok(s1.volume.strayDraws===0 && s1.volume.conservationBugs===0,
      'stub pilot: streams isolated, chips conserved');
    ok(s1.volume.replayAttempts===s1.volume.decisions+1,
      'stub pilot: one replay per decision');
    ok(s1.legality.rawIllegal>0 && Object.values(s1.legality.byPersona)
      .reduce((a,b)=>a+b.rawIllegal,0)===s1.legality.rawIllegal,
      'clamps flow into the persisted accounting (persona split sums to total)');
    ok((s1.legality.clampHist['amount-under-min']||0)>0
      && (s1.legality.clampHist['missing-amount']||0)>0,
      'bet/raise amount clamps reached (view fields are live, not decorative)',
      JSON.stringify(s1.legality.clampHist));
    const persisted=fs.readFileSync(path.join(outDir,'pilot-stub-texp-p.jsonl'),'utf8')
      .split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(r=>r.type!=='header');
    ok(persisted.filter(r=>r.d.amount!==undefined)
      .every(r=>Number.isInteger(r.d.amount) && r.d.amount>0),
      'every persisted bet/raise amount is a positive integer (no NaN leaks)');
    ok(s1.tokens.postWarmMisses===0, 'warm cache profile shows zero post-warm misses');
    const s2=await runPilot({...cfg, client:makeStubClient()});
    ok(s2.latencyMs.n===0 && s2.volume.replayAttempts===1
      && s2.volume.decisions===s1.volume.decisions,
      'resume replays entirely from disk with zero new calls');
    ok(Math.abs(s2.costUsd.total-s1.costUsd.total)<1e-12 && s2.costUsd.calls===s1.costUsd.calls,
      'resumed spend carries forward against the caps (total budget, not per-invocation)');
    let hdrThrew=false;
    try{ await runPilot({...cfg, hands:4, client:makeStubClient()}); }
    catch(e){ hdrThrew=/different config header/.test(e.message); }
    ok(hdrThrew, 'mismatched config header on an existing record file is rejected');
    let seedThrew=false;
    try{ await runPilot({...cfg, seed:'x/../y', client:makeStubClient()}); }
    catch(e){ seedThrew=/filename-safe/.test(e.message); }
    ok(seedThrew, 'path-escaping seed is rejected before any file is touched');
    const coldDir=path.join(__dirname,'out','t-exp-pilot-cold');
    fs.rmSync(coldDir,{recursive:true,force:true});
    const cold=await runPilot({...cfg, outDir:coldDir, client:makeStubClient({cold:true})});
    ok(cold.tokens.postWarmMisses===cold.volume.decisions-5,
      'zero-read responses are counted as post-warm misses (detector can fire)',
      `${cold.tokens.postWarmMisses} of ${cold.volume.decisions}`);
    const capDir=path.join(__dirname,'out','t-exp-pilot-cap');
    fs.rmSync(capDir,{recursive:true,force:true});
    const capCfg={...cfg, outDir:capDir, maxCalls:4};
    const c1=await runPilot({...capCfg, client:makeStubClient()});
    ok(c1.caps.capHit!==null && c1.volume.decisions===4,
      'call cap aborts the run after exactly the allowed calls', c1.caps.capHit);
    ok(c1.costUsd.perHand===null, 'per-hand cost is withheld on a cap hit, not misreported');
    const cUsd=await runPilot({...capCfg, maxCalls:10000, maxUsd:c1.costUsd.total,
      client:makeStubClient()});
    ok(cUsd.caps.capHit!==null && /spend cap/.test(cUsd.caps.capHit) && cUsd.volume.decisions===4,
      'resumed spend alone trips the USD cap before any new call fires', cUsd.caps.capHit);
    const c2=await runPilot({...capCfg, maxCalls:10000, client:makeStubClient()});
    ok(c2.caps.capHit===null && c2.volume.totalHands===3
      && c2.volume.decisions>4 && c2.latencyMs.n===c2.volume.decisions-4,
      'raising the cap resumes from the persisted 4 decisions and completes');

    summarize();
  })().catch(e=>{ console.log('FAIL oracle block threw: '+e.message); process.exitCode=1; });
}

function summarize(){
  console.log(fail?`\n  ${fail} FAILED`:'\n  clean');
  process.exitCode=fail?1:0;
}
