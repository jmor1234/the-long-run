const fs=require('fs');
const os=require('os');
const path=require('path');
const make=require('./harness');
const makeExp=require('./exp/exp-harness');

console.log('HARNESS TEST - transformation guards and hook execution\n');
let fails=0;
const chk=(name,ok,detail)=>{
  if(!ok) fails++;
  console.log(`  ${ok?'ok  ':'FAIL'} ${name}${detail?'   '+detail:''}`);
};
const throws=(fn,pattern)=>{
  try{ fn(); return false; }
  catch(err){ return pattern.test(err.message); }
};

const html=fs.readFileSync('./poker-trainer.html','utf8');
const heroAnchor='if(p.isHero){ renderActions(); return; }';
const bootstrap='updateSession();\nnewSession();';
chk('current engine source transforms successfully', typeof make.buildSrc(html)==='string');
chk('missing rewrite anchor fails closed',
  throws(()=>make.buildSrc(html.replace(heroAnchor, 'if(p.isHero){ renderActions(); /* changed */ return; }')),
    /hero hook anchor, found 0$/));
chk('duplicated rewrite anchor fails closed',
  throws(()=>make.buildSrc(html.replace(heroAnchor, heroAnchor+'\n'+heroAnchor)),
    /hero hook anchor, found 2$/));
const duplicatedBootstrap=html.replace(bootstrap, bootstrap+'\n'+bootstrap);
chk('duplicated bootstrap fails closed in root harness',
  throws(()=>make.buildSrc(duplicatedBootstrap), /bootstrap strip anchor must terminate the engine script$/));
const tempHtml=path.join(os.tmpdir(), `poker-harness-${process.pid}-${Date.now()}.html`);
let expRejected=false;
try{
  fs.writeFileSync(tempHtml,duplicatedBootstrap);
  expRejected=throws(()=>makeExp(()=>{}, {htmlPath:tempHtml, expectedRandSites:4}),
    /bootstrap strip anchor must terminate the engine script$/);
} finally {
  if(fs.existsSync(tempHtml)) fs.unlinkSync(tempHtml);
}
chk('duplicated bootstrap fails closed in experiment harness', expRejected);

let heroCalls=0;
const heroPolicy=(G)=>{
  heroCalls++;
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  const view=G.legalActionView(hero);
  G.applyAction(hero,{...(toCall>0?{action:'fold'}:{action:'check'}),actionSeq:view.actionSeq});
  S.toAct=G.nextToAct(S.toAct);
  G.step();
};
const h=make(heroPolicy);
chk('bootstrap is stripped before explicit session start', h.G.S===null && h.queue.length===0);
h.G.newSession();
h.drain();
chk('hero hook executes', heroCalls>0, `calls=${heroCalls}`);
chk('bot decision hook executes', !!h.state.lastBotCtx);

console.log(fails?`\n  ${fails} FAILED`:'\n  harness guards are live');
process.exitCode=fails?1:0;
