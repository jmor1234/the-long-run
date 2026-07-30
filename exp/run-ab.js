// C6: blind A/B feel packet — pre-humanize engine vs the working file.
//
//   node exp/run-ab.js [--old <commitish>] [--seed feelab1]
//
// Same protocol as the baseline instrument (exp/ref/feel-panel.md): 30-hand
// blocks, shared deal seeds across arms (cards identical until decisions
// diverge the roster), deterministic shuffle, key sequestered. Judges get
// ONE extracted block file each and never repo access.

const fs=require('fs');
const path=require('path');
const cp=require('child_process');
const make=require('./exp-harness');
const {stream}=require('./prng');

function fatal(msg){ console.error('run-ab: '+msg); process.exit(1); }
const args={};
{
  const argv=process.argv.slice(2);
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--')||!['old','seed'].includes(a.slice(2))) fatal('unknown arg '+a);
    const v=argv[i+1];
    if(v===undefined||v.startsWith('--')) fatal('flag '+a+' needs a value');
    args[a.slice(2)]=v; i++;
  }
}
const OLD=args.old||'8f0bada';   // last pre-humanize engine commit
const SEED=args.seed||'feelab1';
if(!/^[A-Za-z0-9_-]+$/.test(SEED)) fatal('--seed must be filename-safe');
if(!/^[A-Za-z0-9_./-]+$/.test(OLD)) fatal('--old must be a plain commitish');

const outDir=path.join(__dirname,'out');
fs.mkdirSync(outDir,{recursive:true});
const oldPath=path.join(outDir,'ab-old-engine.html');
const oldHtml=cp.execFileSync('git', ['show', OLD+':poker-trainer.html'],
  {cwd:path.join(__dirname,'..'), maxBuffer:16*1024*1024, encoding:'utf8'});
fs.writeFileSync(oldPath, oldHtml);

const checkFoldHero=(G)=>{
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  G.applyAction(hero, toCall>0?{action:'fold'}:{action:'check'});
  S.toAct=G.nextToAct(S.toAct);
  G.step();
};
const renderHand=(G)=>{
  const S=G.S;
  return `--- hand ${S.handNum} ---\n`+
    S.log.map(l=>l.text).join('\n')+'\n'+
    S.decisions.map(d=>`  [${d.name} ${d.street} ${d.action}] ${d.reason}`).join('\n');
};

// arm: 'new' = working file; 'old' = pre-humanize build (5 Math.random sites).
function playSession(seed, arm){
  const h=make(checkFoldHero, arm==='old'
    ? {seed, htmlPath:oldPath, expectedRandSites:5}
    : {seed});
  const hands=[];
  h.G.newSession(); h.drain();
  hands.push(renderHand(h.G));
  let last=h.G.session.hands;
  while(h.G.session.hands<75 && !h.G.session.over){
    h.G.newHand(); h.drain();
    if(h.G.session.hands===last) break;
    last=h.G.session.hands;
    hands.push(renderHand(h.G));
  }
  if(h.state.strayDraws) fatal(arm+' arm: stray RNG draws — transcripts untrustworthy');
  return hands;
}

const RANGES=[[1,30],[31,60]];
const blocks=[];
for(let s=0;s<2;s++){
  const seed=`${SEED}|s${s}`;
  const neu=playSession(seed,'new');
  const old=playSession(seed,'old');
  for(const [from,to] of RANGES){
    if(neu.length<to || old.length<to) fatal(`session ${seed} shorter than ${to} hands`);
    const pair=`s${s}:${from}-${to}`;
    blocks.push({pair, arm:'new', text:neu.slice(from-1,to).join('\n\n')});
    blocks.push({pair, arm:'old', text:old.slice(from-1,to).join('\n\n')});
  }
}

const rand=stream(SEED+'|shuffle');
for(let i=blocks.length-1;i>0;i--){
  const j=Math.floor(rand()*(i+1));
  [blocks[i],blocks[j]]=[blocks[j],blocks[i]];
}
const LETTERS='ABCDEFGH';
if(blocks.length!==LETTERS.length) fatal('expected 8 blocks, got '+blocks.length);

const blockDir=path.join(outDir,'ab-blocks');
fs.rmSync(blockDir,{recursive:true,force:true});
fs.mkdirSync(blockDir,{recursive:true});
blocks.forEach((b,i)=>fs.writeFileSync(path.join(blockDir,'block-'+LETTERS[i]+'.txt'), b.text+'\n'));
fs.writeFileSync(path.join(outDir,'ab-key.json'), JSON.stringify({
  oldCommit:OLD, seed:SEED,
  scoring:'frozen bar: new-arm mean >= 5.0 AND no original tell cited in >= half of new-arm blocks; secondary: majority of pairs new > old',
  blocks:Object.fromEntries(blocks.map((b,i)=>[LETTERS[i],{arm:b.arm, pair:b.pair}])),
},null,2));
console.log(`wrote ${blocks.length} isolated blocks to exp/out/ab-blocks/ and ab-key.json (judges must never see the key or the repo)`);
