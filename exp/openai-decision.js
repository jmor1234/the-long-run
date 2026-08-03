'use strict';

const {buildActionPrompt,ACTION_OUTPUT_SCHEMA,ACTION_NAMES}=require('./prompt');

const MODEL='gpt-5.6-terra';
const REASONING_EFFORT='low';
const MAX_OUTPUT_TOKENS=128;
const ACTIONS=new Set(ACTION_NAMES);
const AGGRESSIVE=new Set(['bet','raise']);

function buildRequest(ctx){
  const {prefix,spot}=buildActionPrompt(ctx);
  return {
    model:MODEL,
    reasoning:{effort:REASONING_EFFORT},
    max_output_tokens:MAX_OUTPUT_TOKENS,
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

const rejected=(code,detail)=>({ok:false,error:{code,detail:detail||null}});

function parseResponse(response){
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

module.exports=Object.freeze({MODEL,REASONING_EFFORT,MAX_OUTPUT_TOKENS,buildRequest,parseResponse});
