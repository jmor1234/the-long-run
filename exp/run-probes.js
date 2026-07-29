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

function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--')) fatal(`unexpected argument: ${a}`);
    const key=a.slice(2);
    if(!['sessions','hands','seed'].includes(key)) fatal(`unknown flag: ${a}`);
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
if(!Number.isInteger(SESSIONS) || SESSIONS<1) fatal('--sessions must be a positive integer');
if(!Number.isInteger(HANDS) || HANDS<2) fatal('--hands must be an integer >= 2');

// All amounts are bet-to totals (the applyAction contract). Deterministic —
// naive strategies, no randomness, so no hero RNG stream is needed.
const PROBES={
  'always-raise':(G)=>{ // maniac: bet/raise every single turn
    const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
    return {action:toCall>0?'raise':'bet',
      amount:Math.min(hero.bet+hero.stack, S.currentBet+Math.max(S.minRaise, Math.round(S.pot*0.8)))};
  },
  'call-station':(G)=>{ // call anything, never fold, never raise
    const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
    return {action:toCall>0?'call':'check'};
  },
  '3bet-preflop':(G)=>{ // re-raise every preflop bet, passive postflop
    const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
    if(S.street==='preflop' && toCall>0)
      return {action:'raise',
        amount:Math.min(hero.bet+hero.stack, S.currentBet+Math.max(S.minRaise, Math.round(S.pot*1.0)))};
    return {action:toCall>0?'call':'check'};
  },
  'check-fold':(G)=>{ // pure blind bleed: the floor any strategy should beat
    const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
    return {action:toCall>0?'fold':'check'};
  },
};

const report={config:{sessions:SESSIONS, hands:HANDS, seed:SEED}, probes:{}};
for(const [name,policy] of Object.entries(PROBES)){
  let net=0, hands=0, busts=0, stray=0;
  const heroPolicy=(G)=>{
    const S=G.S, hero=S.players[0];
    G.applyAction(hero, policy(G));
    S.toAct=G.nextToAct(S.toAct);
    G.step();
  };
  for(let s=0;s<SESSIONS;s++){
    const h=make(heroPolicy, {seed:`${SEED}|${name}|s${s}`});
    h.G.newSession(); h.drain();
    let lastHands=h.G.session.hands;
    while(h.G.session.hands<HANDS && !h.G.session.over){
      h.G.newHand(); h.drain();
      if(h.G.session.hands===lastHands) break;
      lastHands=h.G.session.hands;
    }
    net+=h.G.roster[0].stack-h.G.START;
    hands+=h.G.session.hands;
    if(h.G.session.over==='busted') busts++;
    stray+=h.state.strayDraws;
  }
  const bb100=+(net/hands/2*100).toFixed(0);
  report.probes[name]={bb100, hands, busts, sessions:SESSIONS};
  if(stray) console.log(`BUG ${name}: ${stray} stray RNG draws`);
  console.log(`  ${name.padEnd(14)} ${String(bb100).padStart(6)} bb/100   ${hands} hands, busted ${busts}/${SESSIONS}`);
}

const outDir=path.join(__dirname,'out');
fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'probes-baseline.json'), JSON.stringify(report,null,2));
console.log('\nwrote exp/out/probes-baseline.json');
