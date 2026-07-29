// Decision oracle for LLM arms: answer from cache or abort the session.
//
// botDecide stays synchronous (the engine and all tests are untouched).
// On a cache miss the oracle records the pending prompt context and throws
// AbortSession; the runner resolves the decision outside the engine (API
// call), fills the cache, and replays the session from the same seed.
// Deterministic streams (exp-harness) make the replay reproduce identical
// ctx at every cached key — verified on every hit, so any nondeterminism
// is a loud failure instead of silent data corruption.

class AbortSession extends Error {
  constructor(key){ super('oracle miss at '+key); this.key=key; this.isOracleAbort=true; }
}

// cache: Map key -> {ctxJson, d}; pending: array the runner drains
function makeOracle({cache, pending}){
  return function decide(ctx, meta /*, fallthrough */){
    const key=`${meta.hand}:${meta.index}`;
    const ctxJson=JSON.stringify(ctx);
    const hit=cache.get(key);
    if(hit){
      if(hit.ctxJson!==ctxJson)
        throw new Error(`oracle replay divergence at ${key}:\n was ${hit.ctxJson}\n now ${ctxJson}`);
      return hit.d;
    }
    pending.push({key, ctx, ctxJson});
    throw new AbortSession(key);
  };
}

// Runs one session to `hands` hands, replaying on every oracle miss.
// resolvePending(pending, cache) fills the cache (may be async — API calls).
async function runOracleSession({make, seed, hands, heroPolicy, resolvePending, cache}){
  cache=cache||new Map();
  const maxAttempts=hands*60; // generous bound; a real bug signal if hit
  for(let attempt=1; attempt<=maxAttempts; attempt++){
    const pending=[];
    const decide=makeOracle({cache, pending});
    const h=make(heroPolicy, {seed, decide});
    try{
      h.G.newSession(); h.drain();
      while(!h.G.session.over && h.G.session.hands<hands){ h.G.newHand(); h.drain(); }
      return {G:h.G, state:h.state, cache, attempts:attempt};
    } catch(e){
      if(!e.isOracleAbort) throw e;
      await resolvePending(pending, cache);
      if(pending.some(p=>!cache.has(p.key)))
        throw new Error('resolvePending left the missed key unresolved: '+pending[0].key);
    }
  }
  throw new Error('oracle session did not converge within '+maxAttempts+' replays');
}

module.exports={makeOracle, runOracleSession, AbortSession};
