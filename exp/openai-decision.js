'use strict';

const {buildActionPrompt,ACTION_OUTPUT_SCHEMA,ACTION_NAMES}=require('./prompt');

const MODEL='gpt-5.6-terra';
const REASONING_EFFORT='low';
const MAX_OUTPUT_TOKENS=128;
const SERVICE_TIER='default';
const ACTIONS=new Set(ACTION_NAMES);
const AGGRESSIVE=new Set(['bet','raise']);

function buildRequest(ctx){
  const {prefix,spot}=buildActionPrompt(ctx);
  return {
    model:MODEL,
    reasoning:{effort:REASONING_EFFORT},
    max_output_tokens:MAX_OUTPUT_TOKENS,
    service_tier:SERVICE_TIER,
    store:false,
    instructions:prefix,
    input:spot,
    text:{format:{
      type:'json_schema',
      name:'poker_action',
      strict:true,
      schema:ACTION_OUTPUT_SCHEMA,
    }},
  };
}

const rejected=(code,detail)=>({ok:false,error:{code,detail:detail===undefined?null:detail}});

function parseWireResponse(response){
  if(!response || response.status!=='completed')
    return rejected('response-not-completed',response&&response.status);
  const output=Array.isArray(response.output)?response.output:[];
  if(output.some(item=>!item || !['reasoning','message'].includes(item.type)))
    return rejected('unexpected-output-item');
  const messages=output.filter(item=>item.type==='message');
  if(messages.length!==1) return rejected('message-count',messages.length);
  const message=messages[0];
  if(message.role!=='assistant') return rejected('invalid-message-role',message.role);
  if(message.status!=='completed')
    return rejected('message-not-completed',message.status);
  const content=Array.isArray(message.content)?message.content:[];
  if(content.some(item=>item&&item.type==='refusal')) return rejected('refusal');
  if(content.length!==1 || !content[0] || content[0].type!=='output_text' ||
      typeof content[0].text!=='string')
    return rejected('output-text-count',content.filter(item=>item&&item.type==='output_text').length);

  let raw;
  try{ raw=JSON.parse(content[0].text); }
  catch(e){ return rejected('invalid-json',e.message); }
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) return rejected('invalid-object');
  const keys=Object.keys(raw).sort();
  if(JSON.stringify(keys)!=='["action","amount"]') return rejected('invalid-fields',keys.join(','));
  if(!ACTIONS.has(raw.action)) return rejected('invalid-action',raw.action);
  const aggressive=AGGRESSIVE.has(raw.action);
  if(aggressive ? !Number.isInteger(raw.amount) : raw.amount!==null)
    return rejected('invalid-amount',raw.amount);
  return {ok:true,decision:aggressive?{action:raw.action,amount:raw.amount}:{action:raw.action}};
}

function validateDecision(ctx,decision){
  const view=ctx && ctx.legal;
  if(!view || view.ok!==true || !Number.isInteger(view.actionSeq) || view.actionSeq<0 ||
      !Array.isArray(view.actions) || !view.actions.length)
    return rejected('invalid-legal-view');
  const names=view.actions.map(item=>item&&item.action);
  if(new Set(names).size!==names.length || names.some(name=>!ACTIONS.has(name)))
    return rejected('invalid-legal-view');
  const aggressiveDescriptors=view.actions.filter(item=>AGGRESSIVE.has(item.action));
  if(view.aggressive===null){
    if(aggressiveDescriptors.length) return rejected('invalid-aggressive-view');
  } else if(!view.aggressive || aggressiveDescriptors.length!==1 ||
      aggressiveDescriptors[0].action!==view.aggressive.action ||
      !Number.isInteger(view.aggressive.minBetTo) ||
      !Number.isInteger(view.aggressive.maxBetTo) ||
      view.aggressive.minBetTo<=0 ||
      view.aggressive.maxBetTo<view.aggressive.minBetTo ||
      aggressiveDescriptors[0].minBetTo!==view.aggressive.minBetTo ||
      aggressiveDescriptors[0].maxBetTo!==view.aggressive.maxBetTo)
    return rejected('invalid-aggressive-view');
  if(!decision || typeof decision!=='object' || Array.isArray(decision) ||
      !ACTIONS.has(decision.action))
    return rejected('invalid-decision');
  const descriptors=view.actions.filter(item=>item&&item.action===decision.action);
  if(descriptors.length!==1) return rejected('action-not-legal',decision.action);
  const descriptor=descriptors[0];
  const aggressive=AGGRESSIVE.has(decision.action);
  if(aggressive){
    if(view.aggressive.action!==decision.action)
      return rejected('invalid-aggressive-view');
    if(!Number.isInteger(decision.amount) ||
        decision.amount<descriptor.minBetTo || decision.amount>descriptor.maxBetTo)
      return rejected('amount-not-legal',decision.amount);
  } else if(Object.prototype.hasOwnProperty.call(decision,'amount')){
    return rejected('passive-amount');
  }
  return {ok:true,decision:aggressive
    ?{action:decision.action,amount:decision.amount}:{action:decision.action}};
}

function parseResponse(response,ctx){
  const parsed=parseWireResponse(response);
  return parsed.ok?validateDecision(ctx,parsed.decision):parsed;
}

module.exports=Object.freeze({MODEL,REASONING_EFFORT,MAX_OUTPUT_TOKENS,SERVICE_TIER,
  buildRequest,parseResponse,validateDecision});
