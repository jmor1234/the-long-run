// Experiment foundations test — step 1 gate.
// Any line starting BUG or FAIL is a regression (same convention as ../t*.js).
const make=require('./exp-harness');
const {normalize}=require('./legality');
const {makeOracle, runOracleSession}=require('./oracle');

console.log('EXP TEST — seeded streams, oracle replay, legality\n');
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
  const a=runBaseline('dup-1', 40);
  const b=runBaseline('dup-1', 40, {decide:stub});
  let compared=0, same=true;
  for(let i=0;i<Math.min(a.deals.length,b.deals.length);i++){
    const an=JSON.parse(a.deals[i]).n, bn=JSON.parse(b.deals[i]).n;
    if(an!==bn) break; // rosters diverged; hole assignment no longer comparable
    compared++;
    if(a.deals[i]!==b.deals[i]) same=false;
  }
  ok(compared>=10 && same, 'different decision-makers, same seed, identical deals',
    `${compared} hands compared`);
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
  ok(!/Math\.random\s*\(|Date\.now\s*\(|new Date\s*\(|process\.env|require\s*\(/.test(src),
    'prompt.js is statically pure (no RNG, clock, env, or requires)');

  // every persona prefix: only whitelisted example cards, plausibly cache-sized
  const allowed=new Set(P.EXAMPLE_CARDS);
  let prefixOk=true, minLen=Infinity;
  for(const tag of Object.keys(P.PERSONAS)){
    const pre=P.buildPrefix(tag);
    minLen=Math.min(minLen, pre.length);
    for(const tok of P.scanCards(pre)) if(!allowed.has(tok)) prefixOk=false;
  }
  ok(prefixOk, 'prefix cards are all from the declared example whitelist');
  ok(minLen>=16000, 'every persona prefix is plausibly above the 4096-token cache minimum',
    `${minLen} chars (exact token count verified in the pilot)`);

  // determinism + frozen-ctx purity + live scan across real decisions
  const seen=[];
  const spy=(ctx, meta, fall)=>{ if(seen.length<300) seen.push(JSON.parse(JSON.stringify(ctx))); return fall(ctx); };
  runBaseline('prompt-1', 40, {decide:spy});
  let deterministic=true, scanned=0, threw=0;
  for(const ctx of seen){
    const deepFreeze=(o)=>{Object.freeze(o); for(const v of Object.values(o)) if(v&&typeof v==='object') deepFreeze(v); return o;};
    try{
      const a=P.buildPrompt(deepFreeze(ctx));
      const b=P.buildPrompt(ctx);
      if(a.prefix!==b.prefix || a.spot!==b.spot) deterministic=false;
      scanned++;
    }catch(e){ threw++; }
  }
  ok(threw===0 && scanned>=200, 'buildPrompt runs clean on real frozen ctx across decisions',
    `${scanned} decisions, ${threw} threw`);
  ok(deterministic, 'buildPrompt is deterministic (same ctx, byte-identical prompt)');

  // the tripwire itself must fire on a genuinely foreign card
  let trip=false;
  try{ P.assertNoForeignCards('he showed K♦ earlier', {myCards:[{r:14,s:'s'},{r:13,s:'s'}], board:[]}); }
  catch(e){ trip=/card leak/.test(e.message); }
  ok(trip, 'foreign-card scan trips on a card outside own+board');
}

// --- 8. oracle: miss -> abort -> replay converges, ctx stable ----------
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
    summarize();
  })();
}

function summarize(){
  console.log(fail?`\n  ${fail} FAILED`:'\n  clean');
  process.exitCode=fail?1:0;
}
