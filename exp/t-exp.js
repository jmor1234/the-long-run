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
  for(let i=0;i<hands && !h.G.session.over;i++){
    h.G.newHand();
    const S=h.G.S;
    deals.push(JSON.stringify({n:S.n, holes:S.players.map(p=>p.cards), deck:S.deck}));
    h.drain();
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
{
  const stub=(ctx)=>({action: ctx.toCall>0?'fold':'check', reason:'stub arm'});
  const a=runBaseline('dup-1', 40);
  const b=runBaseline('dup-1', 40, {decide:stub});
  // decks are keyed by hand index alone; hole assignment depends on who is
  // still alive, so compare while the rosters still match
  let compared=0, same=true;
  for(let i=0;i<Math.min(a.deals.length,b.deals.length);i++){
    const an=JSON.parse(a.deals[i]).n, bn=JSON.parse(b.deals[i]).n;
    if(an!==bn) break;
    compared++;
    if(a.deals[i]!==b.deals[i]) same=false;
  }
  ok(compared>=10 && same, 'different decision-makers, same seed, identical deals',
    `${compared} hands compared`);
}

// --- 4. oracle: miss -> abort -> replay converges, ctx stable ----------
{
  (async()=>{
    let resolved=0;
    const {G, cache, attempts}=await runOracleSession({
      make, seed:'orc-1', hands:12, heroPolicy:checkFoldHero,
      resolvePending:(pending, cache)=>{
        for(const p of pending){
          resolved++;
          const d=normalize({action: p.ctx.toCall>0?'call':'check', reason:'external'},
            {toCall:p.ctx.toCall, currentBet:0, minRaise:2, myBet:0, stack:p.ctx.myStack}).d;
          cache.set(p.key, {ctxJson:p.ctxJson, d});
        }
      },
    });
    ok(G.session.hands>=12 || G.session.over, 'oracle session completed', `${G.session.hands} hands`);
    ok(attempts===resolved+1, 'one replay per miss, none wasted',
      `${attempts} attempts, ${resolved} resolved`);
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

// --- 5. legality normalizer ---------------------------------------------
{
  const v={toCall:10, currentBet:12, minRaise:6, myBet:2, stack:100};
  let r=normalize({action:'check'}, v);
  ok(r.d.action==='fold' && r.clamps[0].code==='check-facing-bet',
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
  ok(r.d.action==='call' && r.clamps[0].code==='raise-impossible',
    'raise with stack short of a call becomes a call');
  r=normalize({action:'shove'}, v);
  ok(r.d.action==='fold' && r.clamps[0].code==='unknown-action', 'unknown action coerced');
  r=normalize({action:'call'}, {toCall:0, currentBet:0, minRaise:2, myBet:0, stack:100});
  ok(r.d.action==='check' && r.rawIllegal, 'call with nothing to call -> check, counted');
  r=normalize({action:'raise', amount:1}, {toCall:59, currentBet:61, minRaise:6, myBet:2, stack:60});
  ok(r.d.action==='raise' && r.d.amount===62 && r.clamps[0].code==='amount-under-min',
    'short all-in raise target capped at all-in, not min-raise');
  r=normalize({action:'call'}, v);
  ok(r.clamps.length===0 && !r.rawIllegal, 'legal call passes untouched');
}

function summarize(){
  console.log(fail?`\n  ${fail} FAILED`:'\n  clean');
  process.exitCode=fail?1:0;
}
