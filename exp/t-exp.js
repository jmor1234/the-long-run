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

const checkFoldHero=(G)=>{
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  G.applyAction(hero, toCall>0?{action:'fold'}:{action:'check'});
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
  ok(underMin===0 && overStack===0,
    'zero emitted amounts altered by the engine floor (normalize oracle)',
    betsSeen+' bets checked');
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
  h.G.applyAction(p1, r1.d);
  ok(p1.bet===4 && p1.stack===196 && S.currentBet===4,
    'under-min raise lands at engine min target', `bet=${p1.bet} stack=${p1.stack}`);

  const p2=bots[1], r2=normalize({action:'raise', amount:99999}, view(p2)); // over-stack: all-in
  h.G.applyAction(p2, r2.d);
  ok(p2.bet===200 && p2.stack===0 && p2.allIn && S.currentBet===200,
    'over-stack raise lands as exact all-in');

  const p3=bots[2]; p3.stack=150; // short stack: raise impossible, becomes all-in call
  const r3=normalize({action:'raise', amount:400}, view(p3));
  h.G.applyAction(p3, r3.d);
  ok(r3.d.action==='call' && p3.bet===150 && p3.allIn && S.currentBet===200,
    'impossible raise becomes short all-in call, currentBet untouched');
}

// --- 7. prompt builder: purity, determinism, default-deny card scan ----
{
  const fs=require('fs');
  const P=require('./prompt');
  const src=fs.readFileSync(require.resolve('./prompt'),'utf8');
  ok(!/Math\.random\s*\(|Date\.now\s*\(|new Date\s*\(|process\.|globalThis|\beval\s*\(|new Function|require\s*\(/.test(src),
    'prompt.js has no impurity markers (RNG, clock, env, eval, requires)');
  ok(/^'use strict';/.test(src), 'prompt.js is strict mode (frozen-ctx writes throw, not no-op)');

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
  }
  ok(protoThrew===3, 'buildPrefix rejects prototype-chain persona tags');

  // determinism + frozen-ctx purity + live scan across real decisions.
  // Two passes in OPPOSITE orders so module-level state or memoization keyed
  // on call order would surface; ctx snapshot proves buildPrompt mutates nothing.
  const seen=[];
  const spy=(ctx, meta, fall)=>{ if(seen.length<300) seen.push(JSON.parse(JSON.stringify(ctx))); return fall(ctx); };
  runBaseline('prompt-1', 40, {decide:spy});
  const deepFreeze=(o)=>{Object.freeze(o); for(const v of Object.values(o)) if(v&&typeof v==='object') deepFreeze(v); return o;};
  let scanned=0, threw=0, mutated=0;
  const passA=[];
  for(const ctx of seen){
    const before=JSON.stringify(ctx);
    try{
      passA.push(P.buildPrompt(deepFreeze(ctx)));
      scanned++;
    }catch(e){ threw++; passA.push(null); }
    if(JSON.stringify(ctx)!==before) mutated++;
  }
  let deterministic=true;
  for(let i=seen.length-1;i>=0;i--){ // reverse order
    if(!passA[i]) continue;
    const b=P.buildPrompt(seen[i]);
    if(b.prefix!==passA[i].prefix || b.spot!==passA[i].spot) deterministic=false;
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
