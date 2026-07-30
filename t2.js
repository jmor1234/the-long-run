const make=require('./harness');
console.log('TEST 2 — chip conservation and rule integrity over 3,000 hands\n');

let topups=0;
const heroPolicy=(G)=>{
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  const r=Math.random();
  let d;
  if(toCall>0) d = r<0.45?{action:'fold'} : r<0.85?{action:'call'} : {action:'bet',amount:hero.bet+toCall+Math.max(2,Math.round(S.pot*0.6))};
  else d = r<0.7?{action:'check'} : {action:'bet',amount:hero.bet+Math.max(2,Math.round(S.pot*0.6))};
  G.applyAction(hero,d);
  S.toAct=G.nextToAct(S.toAct);
  G.step();
};

const {G,drain}=make(heroPolicy);
const errs={negStack:0, potMismatch:0, chipLoss:0, badWinner:0, stuck:0};
let prevTotal=null;

G.newSession(); drain();
for(let i=0;i<3000;i++){
  if(G.session.over){ G.newSession(); drain(); }
  G.newHand();
  drain();
  if(G.session.over) continue;
  const S=G.S;
  if(!S.done){ errs.stuck++; continue; }

  const total = S.players.reduce((a,p)=>a+p.stack,0);
  const invested = S.players.reduce((a,p)=>a+p.invested,0);
  if(S.players.some(p=>p.stack<0)) errs.negStack++;
  if(invested !== S.pot) errs.potMismatch++;

  const rosterTotal = G.roster.reduce((a,p)=>a+p.stack,0);
  if(rosterTotal !== 1200) errs.chipLoss++;

  // whoever won must not have a worse hand than a non-winner who saw showdown
  const alive=S.players.filter(p=>!p.folded);
  if(alive.length>1 && S.board.length===5){
    const best=alive.reduce((a,b)=>G.cmpHand(G.evaluate([...a.cards,...S.board]),G.evaluate([...b.cards,...S.board]))>=0?a:b);
    const bestEv=G.evaluate([...best.cards,...S.board]);
    const anyWorseWon = alive.some(p=>p!==best && p.stack>0 &&
      G.cmpHand(G.evaluate([...p.cards,...S.board]),bestEv)<0 && S.log.some(l=>l.cls==='win'&&l.text.startsWith(p.name)) &&
      !S.log.some(l=>l.cls==='win'&&l.text.startsWith(best.name)));
    if(anyWorseWon) errs.badWinner++;
  }
}

const rows=[
  ['hands completed without hanging', 3000-errs.stuck, 3000],
  ['negative stacks', errs.negStack, 0],
  ['pot != sum of money put in', errs.potMismatch, 0],
  ['table total drifted from 1200', errs.chipLoss, 0],
  ['worse hand awarded the pot', errs.badWinner, 0],
];
let fail=0;
for(const [name,got,exp] of rows){
  const ok = got===exp;
  if(!ok) fail++;
  console.log(`  ${ok?'ok  ':'FAIL'} ${name.padEnd(36)} ${got}`);
}
console.log(`\n  (table always holds exactly 1200 chips — nobody rebuys)`);
console.log(fail?`  ${fail} FAILED`:'  rules and money are sound');
process.exitCode=fail?1:0;
