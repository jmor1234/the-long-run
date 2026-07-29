// Hard spend controls for API arms (PLAN.md "Spend controls": unit-tested).
//
// Cost is computed from the response usage object at published Haiku 4.5
// rates. The guard is checked BEFORE every call and the run aborts loudly
// the moment either cap is crossed — a cap hit mid-run is safe because every
// resolved decision is already persisted and a re-run resumes from disk.
//
// Cap semantics: maxCalls is exact (the N+1th call never fires). maxUsd is
// stop-after-crossing — cost accrues from actual usage after each response,
// so the final call may overshoot the cap by its own cost (~$0.01 worst case
// at pilot sizes: one uncached prefix write). Calls count billed decisions;
// the SDK may internally retry transient failures within one counted call.

const PRICES_HAIKU_45={
  inputPerMTok:1.00,
  outputPerMTok:5.00,
  cacheWriteMult:1.25, // 5-minute TTL ephemeral writes
  cacheReadMult:0.10,
};

function estimateCostUsd(usage, prices=PRICES_HAIKU_45){
  const inTok=usage.input_tokens||0;
  const wTok=usage.cache_creation_input_tokens||0;
  const rTok=usage.cache_read_input_tokens||0;
  const outTok=usage.output_tokens||0;
  return (inTok*prices.inputPerMTok
        + wTok*prices.inputPerMTok*prices.cacheWriteMult
        + rTok*prices.inputPerMTok*prices.cacheReadMult)/1e6
        + outTok*prices.outputPerMTok/1e6;
}

class SpendCapExceeded extends Error {
  constructor(msg){ super(msg); this.isSpendCap=true; }
}

// beforeCall() throws before the call that would exceed a cap fires;
// record(usage) accrues actual cost after each response.
function makeSpendGuard({maxCalls, maxUsd, prices=PRICES_HAIKU_45}){
  if(!(maxCalls>0) || !(maxUsd>0)) throw new Error('spend guard needs positive maxCalls and maxUsd');
  let calls=0, usd=0;
  return {
    beforeCall(){
      if(calls>=maxCalls) throw new SpendCapExceeded(`call cap hit: ${calls}/${maxCalls} calls`);
      if(usd>=maxUsd) throw new SpendCapExceeded(`spend cap hit: $${usd.toFixed(4)} >= $${maxUsd}`);
    },
    record(usage){ calls++; usd+=estimateCostUsd(usage, prices); },
    get calls(){ return calls; },
    get usd(){ return usd; },
  };
}

module.exports={PRICES_HAIKU_45, estimateCostUsd, makeSpendGuard, SpendCapExceeded};
