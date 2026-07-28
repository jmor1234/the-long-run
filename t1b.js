const fs=require('fs');
const h=fs.readFileSync('./poker-trainer.html','utf8');
const eng=h.slice(h.indexOf('const SUITS'), h.indexOf('function drawInfo'));
const api=new Function(eng+'; return {evaluate,cmpHand,makeDeck,cardStr,RANK_CH};')();
const {evaluate,cmpHand,makeDeck,cardStr,RANK_CH}=api;
const P=s=>s.split(' ').map(t=>({r:+Object.keys(RANK_CH).find(k=>RANK_CH[k]===t[0]),s:t[1]}));
function h2h(a,b,board,n){
  const used=new Set([...a,...b,...board].map(cardStr));
  const stub=makeDeck().filter(c=>!used.has(cardStr(c)));
  let w=0;
  for(let i=0;i<n;i++){
    const d=stub.slice();
    for(let k=d.length-1;k>0;k--){const j=Math.floor(Math.random()*(k+1));[d[k],d[j]]=[d[j],d[k]];}
    const run=[]; let p=0;
    while(board.length+run.length<5) run.push(d[p++]);
    const bb=[...board,...run];
    const c=cmpHand(evaluate([...a,...bb]),evaluate([...b,...bb]));
    w += c>0?1:c===0?0.5:0;
  }
  return w/n*100;
}
console.log('TEST 1b — corrected draw tests\n');
// Expected values verified by hand. Two of these look wrong at a glance and
// are not — read the comments before "fixing" them.
const cases=[
  ['open-ended straight draw (8 outs)','9c 8c','Ad Ah','Jh Ts 2d', 32.5],
  ['true gutshot, 4 outs, no flush',   '9c 8d','Ad Ah','Jh Qs 2c', 17.0],
  // A4h is NOT a bare 9-out flush draw: any ace beats a pair of kings (3 outs)
  // and any five makes the wheel with A-2-3-4 (3 more). 15 outs of 44 = 34%.
  ['flush draw + ace + wheel, 15 outs','Ah 4h','Ks Qd','Kh 9h 2c 3s', 34.2],
  // six clean outs plus backdoor straight and flush equity
  ['two overcards vs pair',           'As Kd','7c 7h','2d 9s Jc', 26.4],
  // the set is not a 2:1 favourite — it redraws to a full house when the
  // board pairs, which beats the flush. That redraw is worth ~13 points.
  ['set vs flush draw (set redraws)', '9d 9h','Ah Kh','9s 7h 2h', 75.5],
];
let fail=0;
for(const [name,a,b,bd,exp] of cases){
  const got=h2h(P(a),P(b),P(bd),80000);
  const off=Math.abs(got-exp), ok=off<1.8;
  if(!ok) fail++;
  console.log(`  ${ok?'ok  ':'FAIL'} ${name.padEnd(36)} ${got.toFixed(1)}%  expected ~${exp}%`);
}
console.log(fail?`\n  ${fail} FAILED`:'\n  all draw maths correct');
