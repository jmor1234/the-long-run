'use strict';

// Development-only Terra smoke corpus. Each case is a real Policy A decision
// selected by seeded hand/decision coordinates. These cases may validate the
// provider boundary, but must never count as humanness evaluation evidence.

const crypto=require('crypto');
const make=require('./exp-harness');

const SPECS=Object.freeze([
  {id:'persona-nit',seed:'terra-probe-v1|s0',hand:1,index:0,
    ctxHash:'d895040c61d9afdc17483657f161396759239e17b6e56de20a1b992b66d94597',
    policyA:{action:'fold'}},
  {id:'persona-solid',seed:'terra-probe-v1|s0',hand:1,index:1,
    ctxHash:'44767b49692297cc9944f38920fcabfc26ef277390e2fd2d3513c0d4d1a846d8',
    policyA:{action:'raise',amount:5}},
  {id:'persona-maniac',seed:'terra-probe-v1|s0',hand:1,index:2,
    ctxHash:'c4d92b7f693823d1bda777661098c3d4cc62a2d0aa7326d3a61aab2732fbf3d7',
    policyA:{action:'fold'}},
  {id:'persona-selective',seed:'terra-probe-v1|s0',hand:1,index:3,
    ctxHash:'a3dbb284269158f39b6ab43ca1158389f383ad7f3dbb8ffade99beab02c3a6df',
    policyA:{action:'fold'}},
  {id:'persona-station',seed:'terra-probe-v1|s0',hand:1,index:4,
    ctxHash:'77772c0df19f5d5a0b28679d44745828965bcdf0965b39cca84ea5b5bd7ce53e',
    policyA:{action:'fold'}},
  {id:'postflop-bet',seed:'terra-probe-v1|s0',hand:18,index:5,
    ctxHash:'fb5b58f6e37bc58606b57e4787afd5a4479a86b144a9d90c40ec1343102d55b5',
    policyA:{action:'check'}},
  {id:'raise-closed',seed:'terra-probe-v1|s0',hand:43,index:14,
    ctxHash:'c986c7252929a8376e44f527ce2d426c29c4088e762b262cf79d996aa490a9f2',
    policyA:{action:'call'}},
  {id:'short-layered-allin',seed:'terra-probe-v1|s0',hand:45,index:16,
    ctxHash:'de22528e119e3bb1345d30f58d56772a7c3378788afd033226d531206687c830',
    policyA:{action:'call'}},
  {id:'heads-up',seed:'terra-probe-v1|s19',hand:58,index:0,
    ctxHash:'cee3ac4b5fe95cbc441ce7515195be71aef435ceaee77c9240e354087ffe9d29',
    policyA:{action:'raise',amount:4}},
]);

const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
const actionOnly=d=>d&&({action:d.action,...(Number.isInteger(d.amount)?{amount:d.amount}:{})});
const deepFreeze=o=>{
  Object.freeze(o);
  for(const value of Object.values(o))
    if(value&&typeof value==='object'&&!Object.isFrozen(value)) deepFreeze(value);
  return o;
};
for(const spec of SPECS){ Object.freeze(spec.policyA); Object.freeze(spec); }

function checkFoldHero(G){
  const S=G.S,hero=S.players[0],view=G.legalActionView(hero);
  const d=view.actions.some(a=>a.action==='fold')?{action:'fold'}:{action:'check'};
  G.applyAction(hero,{...d,actionSeq:view.actionSeq});
  S.toAct=G.nextToAct(S.toAct);
  G.step();
}

function collectSeed(seed,specs){
  const wanted=new Map(specs.map(spec=>[`${spec.hand}:${spec.index}`,spec]));
  const found=new Map();
  const decide=(ctx,meta,fallthrough)=>{
    const result=fallthrough(ctx);
    const key=`${meta.hand}:${meta.index}`;
    if(wanted.has(key)){
      const productionCtx=JSON.parse(JSON.stringify(ctx));
      // The experiment harness injects these only for historical normalizer
      // compatibility. Current production ctx owns them under `legal`.
      delete productionCtx.currentBet;
      delete productionCtx.minRaise;
      found.set(key,{ctx:productionCtx,policyA:actionOnly(result)});
    }
    return result;
  };
  const run=make(checkFoldHero,{seed,decide});
  run.G.newSession();
  run.drain();
  const lastHand=Math.max(...specs.map(spec=>spec.hand));
  let completed=run.G.session.hands;
  while(!run.G.session.over && run.state.hand<=lastHand && found.size<wanted.size){
    run.G.newHand();
    run.drain();
    if(run.G.session.hands===completed) break;
    completed=run.G.session.hands;
  }
  if(run.state.strayDraws) throw new Error(`Terra probes: ${run.state.strayDraws} stray RNG draws`);
  return found;
}

function collectProbes(){
  const bySeed=new Map();
  for(const spec of SPECS){
    if(!bySeed.has(spec.seed)) bySeed.set(spec.seed,[]);
    bySeed.get(spec.seed).push(spec);
  }
  const found=new Map();
  for(const [seed,specs] of bySeed){
    for(const [key,value] of collectSeed(seed,specs)) found.set(`${seed}|${key}`,value);
  }
  return SPECS.map(spec=>{
    const value=found.get(`${spec.seed}|${spec.hand}:${spec.index}`);
    if(!value) throw new Error(`Terra probe missing: ${spec.id}`);
    const ctxJson=JSON.stringify(value.ctx);
    if(sha(ctxJson)!==spec.ctxHash) throw new Error(`Terra probe ctx drift: ${spec.id}`);
    if(JSON.stringify(value.policyA)!==JSON.stringify(spec.policyA))
      throw new Error(`Terra probe Policy A drift: ${spec.id}`);
    return deepFreeze({id:spec.id,ctxHash:spec.ctxHash,ctx:value.ctx,policyA:value.policyA});
  });
}

module.exports=Object.freeze({SPECS,collectProbes});
