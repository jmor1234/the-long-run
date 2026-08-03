// Exploitability probes: scripted degenerate heroes vs the bot table.
// Produces the fresh baselines criterion 3 is pre-registered against — the
// ~-3000 bb/100 figure in ARCHITECTURE.md is historical and disclaimed, so
// the criterion is relative to these measured numbers, per arm.
//
//   node exp/run-probes.js [--sessions 30] [--hands 200] [--seed probe1]
//
// bb/100 = hero net chips / hands / BB * 100, pooled across sessions.
// No rebuys: a busting strategy caps its loss at -200 per session, so these
// numbers are a floor on how bad the strategy is, not an unbiased mean —
// fine for a relative cross-arm comparison using identical rules.

const fs=require('fs');
const path=require('path');
const make=require('./exp-harness');
const {bb100}=require('./metrics');

function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--')) fatal(`unexpected argument: ${a}`);
    const key=a.slice(2);
    if(!['sessions','hands','seed','policy','out'].includes(key)) fatal(`unknown flag: ${a}`);
    const val=argv[i+1];
    if(val===undefined || val.startsWith('--')) fatal(`flag ${a} needs a value`);
    args[key]=val; i++;
  }
  return args;
}
function fatal(msg){ console.error('run-probes: '+msg); process.exit(1); }

const args=parseArgs(process.argv.slice(2));
const SESSIONS=args.sessions===undefined?30:+args.sessions;
const HANDS=args.hands===undefined?200:+args.hands;
const SEED=args.seed||'probe1';
const OUT_DIR=args.out===undefined?path.join(__dirname,'out'):path.resolve(args.out);
const OUT_LABEL=args.out===undefined?'exp/out':OUT_DIR;
const POLICY_EXPLICIT=args.policy!==undefined;
let POLICY;
try{ POLICY=make.resolvePolicy(args.policy); }
catch(e){ fatal(e.message); }
if(!Number.isInteger(SESSIONS) || SESSIONS<1) fatal('--sessions must be a positive integer');
if(!Number.isInteger(HANDS) || HANDS<2) fatal('--hands must be an integer >= 2');

// All amounts are bet-to totals (the applyAction contract). Deterministic —
// naive strategies, no randomness, so no hero RNG stream is needed.
const PROBES={
  'always-raise':(G)=>{ // maniac: bet/raise every single turn
    const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
    const view=G.legalActionView(hero), ag=view.aggressive;
    if(!ag) return {action:toCall>0?'call':'check'};
    return {action:ag.action,
      amount:Math.max(ag.minBetTo,Math.min(ag.maxBetTo,
        S.currentBet+Math.max(S.minRaise,Math.round(S.pot*0.8))))};
  },
  'call-station':(G)=>{ // call anything, never fold, never raise
    const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
    return {action:toCall>0?'call':'check'};
  },
  '3bet-preflop':(G)=>{ // re-raise every preflop bet, passive postflop
    const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
    const view=G.legalActionView(hero), ag=view.aggressive;
    if(S.street==='preflop' && toCall>0 && ag)
      return {action:ag.action,
        amount:Math.max(ag.minBetTo,Math.min(ag.maxBetTo,
          S.currentBet+Math.max(S.minRaise,Math.round(S.pot*1.0))))};
    return {action:toCall>0?'call':'check'};
  },
  'check-fold':(G)=>{ // pure blind bleed: the floor any strategy should beat
    const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
    return {action:toCall>0?'fold':'check'};
  },
};

if(SESSIONS!==30||HANDS!==200||SEED!=='probe1')
  console.log(`NOTE: config differs from the frozen registration (30x200, probe1) — output is exploratory`);

const config={sessions:SESSIONS, hands:HANDS, seed:SEED};
if(POLICY_EXPLICIT) config.policy=POLICY;
const report={config, probes:{}};
let bugs=0;
const observedPolicies=new Set();
for(const [name,policy] of Object.entries(PROBES)){
  let net=0, hands=0, busts=0, stray=0, conservation=0;
  let policyFits=0, policyRejects=0, policyFallbacks=0;
  let challengerRejects=0, challengerFallbacks=0;
  const perSession=[];
  const heroPolicy=(G)=>{
    const S=G.S, hero=S.players[0];
    const view=G.legalActionView(hero);
    G.applyAction(hero,{...policy(G),actionSeq:view.actionSeq});
    S.toAct=G.nextToAct(S.toAct);
    G.step();
  };
  for(let s=0;s<SESSIONS;s++){
    const h=make(heroPolicy, {seed:`${SEED}|${name}|s${s}`, policy:POLICY});
    observedPolicies.add(h.state.policy);
    h.G.newSession(); h.drain();
    let lastHands=h.G.session.hands;
    while(h.G.session.hands<HANDS && !h.G.session.over){
      h.G.newHand(); h.drain();
      if(h.G.session.hands===lastHands) break;
      lastHands=h.G.session.hands;
      if(h.G.roster.reduce((a,p)=>a+p.stack,0)!==6*h.G.START) conservation++;
    }
    const sNet=h.G.roster[0].stack-h.G.START;
    perSession.push({net:sNet, hands:h.G.session.hands, over:h.G.session.over||null});
    net+=sNet;
    hands+=h.G.session.hands;
    if(h.G.session.over==='busted') busts++;
    stray+=h.state.strayDraws;
    policyFits+=h.state.policyFits;
    policyRejects+=h.state.policyRejects;
    policyFallbacks+=h.state.policyFallbacks;
    challengerRejects+=h.state.challengerRejects;
    challengerFallbacks+=h.state.challengerFallbacks;
    var BB=h.G.BB, START=h.G.START;
  }
  const rate=bb100(net, hands, BB);
  report.probes[name]={bb100:rate, net, hands, busts, sessions:SESSIONS, BB, START, perSession};
  if(POLICY_EXPLICIT) report.probes[name].policyActions={
    fits:policyFits,rejects:policyRejects,fallbacks:policyFallbacks,
    challengerRejects,challengerFallbacks,
    observedPolicy:observedPolicies.size===1?[...observedPolicies][0]:null};
  if(stray){ console.log(`BUG ${name}: ${stray} stray RNG draws`); bugs++; }
  if(conservation){ console.log(`BUG ${name}: chips drifted in ${conservation} hands`); bugs++; }
  if(POLICY_EXPLICIT && policyRejects) console.log(`NOTE: ${name}: ${policyRejects} legacy/delegated policy actions were rejected`);
  if(POLICY_EXPLICIT && policyFallbacks) console.log(`NOTE: ${name}: ${policyFallbacks} legacy/delegated policy actions used safe fallback`);
  if(POLICY_EXPLICIT && challengerRejects){ console.log(`BUG ${name}: ${challengerRejects} Policy B-owned actions were rejected`); bugs++; }
  if(POLICY_EXPLICIT && challengerFallbacks){ console.log(`BUG ${name}: ${challengerFallbacks} Policy B-owned actions used safe fallback`); bugs++; }
  console.log(`  ${name.padEnd(14)} ${String(rate).padStart(6)} bb/100   ${hands} hands, busted ${busts}/${SESSIONS}`);
}

fs.mkdirSync(OUT_DIR,{recursive:true});
const outputName=POLICY_EXPLICIT?`probes-${POLICY}.json`:'probes-baseline.json';
fs.writeFileSync(path.join(OUT_DIR,outputName), JSON.stringify(report,null,2));
console.log(`\nwrote ${OUT_LABEL}/${outputName}`);

// Exploitability lock: degenerate strategies must keep losing hard even as
// the bots gain looseness/texture. Thresholds = ~50% of the values measured
// @ 6cd6b29 (-1111 / -1056 / -787 / -36), so a halving of exploitability
// resistance fails the gate, not just a total collapse. Re-freeze alongside
// any deliberate dial change. Enforced only at the frozen config.
let locked=0;
if(POLICY_EXPLICIT && (observedPolicies.size!==1 || !observedPolicies.has(POLICY))){
  console.log(`BUG runner requested ${POLICY} but harness observed ${[...observedPolicies].join(', ')||'none'}`);
  bugs++;
}
const lockArmed=SESSIONS===30 && HANDS===200 && SEED==='probe1';
if(lockArmed){
  const LOCK={'always-raise':-550,'call-station':-500,'3bet-preflop':-390,'check-fold':-18};
  for(const [name,maxRate] of Object.entries(LOCK)){
    const p=report.probes[name];
    if(!p){ console.log(`FAIL ${name}: probe missing`); locked++; continue; }
    if(!(p.bb100<=maxRate)){ console.log(`FAIL ${name}: ${p.bb100} bb/100 (must be <= ${maxRate})`); locked++; }
  }
  if(!locked) console.log('exploitability lock: all probes within bounds');
} else {
  console.log('lock skipped: exploratory config');
}
if(POLICY_EXPLICIT){
  report.lock={armed:lockArmed,passed:lockArmed && !locked && !bugs};
  fs.writeFileSync(path.join(OUT_DIR,outputName), JSON.stringify(report,null,2));
}
process.exitCode=(locked||bugs)?1:0;
