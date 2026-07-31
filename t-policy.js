const crypto=require('crypto');
const fs=require('fs');
const make=require('./exp/exp-harness');

console.log('POLICY TEST - Policy A dispatch equivalence\n');
let fails=0;
const chk=(name,ok,detail)=>{
  if(!ok) fails++;
  console.log(`  ${ok?'ok  ':'FAIL'} ${name}${detail?'   '+detail:''}`);
};

const checkFoldHero=(G)=>{
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  const view=G.legalActionView(hero);
  G.applyAction(hero,{...(toCall>0?{action:'fold'}:{action:'check'}),actionSeq:view.actionSeq});
  S.toAct=G.nextToAct(S.toAct);
  G.step();
};

const html=fs.readFileSync('./poker-trainer.html','utf8').replace(/\r\n/g,'\n');
const dispatchDeclaration='const botDecide=function(ctx){';
const dispatchStart=html.indexOf(dispatchDeclaration);
const policyDeclaration='const botPolicyV1=function(ctx){';
const policyStart=html.indexOf(policyDeclaration,dispatchStart);
const policyEnd=html.indexOf('/* ---- BOT VOICE',policyStart);
const dispatcher=html.slice(dispatchStart,policyStart);
const policySource=html.slice(policyStart,policyEnd);
const normalizedPolicySource=policySource
  .replace(policyDeclaration,'function botPolicyV1(ctx){')
  .replace(/\};(\s*)$/,'}$1');
const policyHash=crypto.createHash('sha256').update(normalizedPolicySource).digest('hex');
chk('dispatcher is only the Policy A delegation',
  dispatcher==='const botDecide=function(ctx){\n  return botPolicyV1(ctx);\n};\n\n');
chk('dispatcher has one immutable binding and one game call',
  (html.match(/\bbotDecide\b/g)||[]).length===2 &&
  (html.match(/const botDecide=/g)||[]).length===1);
chk('Policy A has one immutable binding and one dispatcher reference',
  (html.match(/\bbotPolicyV1\b/g)||[]).length===2 &&
  (html.match(/const botPolicyV1=/g)||[]).length===1);
chk('Policy A source matches the 15dbbb4 baseline',
  policyHash==='8f48ffd3eeefa1026d6fc5fc756508a2ccae4d84a4b2938dcb6ceea1ae48d6ae',
  policyHash.slice(0,12));

function play(seed,direct){
  const h=make(checkFoldHero,{seed,policy:direct?'v1':'dispatch',captureDecisions:true});
  const G=h.G, state=h.state;
  const hands=[];
  G.newSession(); h.drain();
  let last=G.session.hands;
  for(let i=0;i<80 && !G.session.over;i++){
    G.newHand();
    if(G.session.over) break;
    const S=G.S;
    const deal={n:S.n,holes:S.players.map(p=>p.cards),deck:S.deck};
    h.drain();
    if(G.session.hands===last) break;
    last=G.session.hands;
    hands.push({deal,log:S.log.map(l=>l.text),reasons:S.decisions,
      roster:G.roster.map(p=>({seat:p.seat,stack:p.stack,mood:p.mood,reads:p.reads})),
      session:{hands:G.session.hands,net:G.session.net,vpip:G.session.vpip,
        hero:G.session.hero,over:G.session.over}});
  }
  return {hands,decisions:state.decisionTrace,strayDraws:state.strayDraws,
    over:G.session.over};
}

for(const seed of ['policy-a1','policy-a2','policy-a3']){
  const dispatched=play(seed,false);
  const direct=play(seed,true);
  const left=JSON.stringify(dispatched), right=JSON.stringify(direct);
  const hash=crypto.createHash('sha256').update(left).digest('hex').slice(0,12);
  chk(`${seed}: dispatcher equals direct Policy A`,left===right,
    `${dispatched.hands.length} hands, ${dispatched.decisions.length} decisions, ${hash}`);
  chk(`${seed}: comparison exercised decisions`,dispatched.decisions.length>=50,
    `${dispatched.decisions.length} decisions`);
  chk(`${seed}: no RNG escaped decision streams`,
    dispatched.strayDraws===0 && direct.strayDraws===0);
}

console.log(fails?`\n  ${fails} FAILED`:'\n  Policy A dispatch is behavior-neutral');
process.exitCode=fails?1:0;
