// Shared metric helpers — extracted so t-exp.js can test them against
// hand-computed values instead of trusting the runners' inline math.

const rate=(y,o)=>o>0? y/o : null;

// reads counters -> display rates. AF is null (not a count) when never passive.
const rates=(rd)=>({
  vpip:rate(rd.vpip,rd.vpipOpps), pfr:rate(rd.pfr,rd.pfrOpps),
  f2bet:rate(rd.foldToBet,rd.foldToBetOpps), threeBet:rate(rd.threeBet,rd.threeBetOpps),
  f2cbet:rate(rd.foldToCbet,rd.foldToCbetOpps),
  af:rd.passive>0? rd.agg/rd.passive : null,
});

// second-half raw counters = end - mid
const diffReads=(end,mid)=>{
  const d={};
  for(const k of Object.keys(end)) d[k]=end[k]-(mid?mid[k]:0);
  return d;
};

const addTo=(acc,tag,counters)=>{
  acc[tag]=acc[tag]||{};
  for(const [k,v] of Object.entries(counters)) acc[tag][k]=(acc[tag][k]||0)+v;
};

// hero winrate in big blinds per 100 hands
const bb100=(net,hands,BB)=>+(net/hands/BB*100).toFixed(0);

module.exports={rate, rates, diffReads, addTo, bb100};
