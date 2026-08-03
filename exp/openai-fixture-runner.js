'use strict';

// Offline fixture executor for the one-time Terra provider smoke. This module
// owns no SDK, credentials, network client, cache, resume path, or gameplay.
// A later adapter may supply a transport only after this boundary is verified.

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {collectProbes}=require('./openai-probes');
const Decision=require('./openai-decision');

const FORMAT_VERSION=1;
const RUN_ID='terra-provider-smoke-v1';
const PROBE_IDS=Object.freeze(['postflop-bet','short-layered-allin']);
const OFFICIAL_BASE_URL='https://api.openai.com/v1';
const OUT_DIR=path.join(__dirname,'terra-state');
const phase=()=>{};
const MAX_USD=0.05;
const PRICING=Object.freeze({
  checkedOn:'2026-08-03',
  source:'https://developers.openai.com/api/docs/pricing',
  serviceTier:Decision.SERVICE_TIER,
  conservativeInputPerMTok:2.50,
  outputPerMTok:12.00,
  regionalUplift:1.10,
});

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const deepFreeze=value=>{
  Object.freeze(value);
  for(const child of Object.values(value))
    if(child&&typeof child==='object'&&!Object.isFrozen(child)) deepFreeze(child);
  return value;
};
const fault=(code,message)=>Object.assign(new Error(message),{code});

function conservativeUsd(inputUnits,outputUnits){
  const raw=(inputUnits*PRICING.conservativeInputPerMTok+
    outputUnits*PRICING.outputPerMTok)/1e6*PRICING.regionalUplift;
  return Math.ceil(raw*1e8)/1e8;
}

function reserveFor(request){
  // UTF-8 request bytes are a conservative upper bound on input tokens. The
  // higher standard cache-write rate and regional uplift keep this above the
  // published worst case for this short-context, tool-free request.
  const inputBytes=Buffer.byteLength(JSON.stringify(request),'utf8');
  return {inputByteUpperBound:inputBytes,
    maxUsd:conservativeUsd(inputBytes,request.max_output_tokens)};
}

let frozenManifest=null;
function getSmokeManifest(){
  if(frozenManifest) return frozenManifest;
  const probes=new Map(collectProbes().map(probe=>[probe.id,probe]));
  const entries=PROBE_IDS.map(id=>{
    const probe=probes.get(id);
    if(!probe) throw fault('probe-missing',`smoke probe missing: ${id}`);
    const request=deepFreeze(Decision.buildRequest(probe.ctx));
    return {id,ctxHash:probe.ctxHash,requestHash:sha(JSON.stringify(request)),
      reserve:reserveFor(request)};
  });
  const manifest={formatVersion:FORMAT_VERSION,runId:RUN_ID,
    model:Decision.MODEL,endpoint:OFFICIAL_BASE_URL,serviceTier:Decision.SERVICE_TIER,
    maxCalls:entries.length,maxUsd:MAX_USD,pricing:PRICING,entries};
  const reservedUsd=entries.reduce((sum,entry)=>sum+entry.reserve.maxUsd,0);
  if(entries.length!==PROBE_IDS.length || reservedUsd>MAX_USD)
    throw fault('manifest-over-cap','smoke manifest exceeds its fixed ceiling');
  const fingerprint=sha(JSON.stringify(manifest));
  frozenManifest=deepFreeze({...manifest,reservedUsd,fingerprint});
  return frozenManifest;
}

function appendSynced(fd,record){
  fs.writeFileSync(fd,JSON.stringify(record)+'\n');
  fs.fsyncSync(fd);
}

function usageView(usage){
  if(!usage || !Number.isInteger(usage.input_tokens) || usage.input_tokens<0 ||
      !Number.isInteger(usage.output_tokens) || usage.output_tokens<0 ||
      !Number.isInteger(usage.total_tokens) || usage.total_tokens<0 ||
      usage.total_tokens!==usage.input_tokens+usage.output_tokens) return null;
  const input=usage.input_tokens_details;
  const output=usage.output_tokens_details;
  if((input!==undefined && (!input || typeof input!=='object' || Array.isArray(input))) ||
      (output!==undefined && (!output || typeof output!=='object' || Array.isArray(output))))
    return null;
  const detail=(container,key,upper)=>{
    if(!container || !Object.prototype.hasOwnProperty.call(container,key)) return 0;
    const value=container[key];
    return Number.isInteger(value)&&value>=0&&value<=upper?value:null;
  };
  const cachedInputTokens=detail(input,'cached_tokens',usage.input_tokens);
  const cacheWriteTokens=detail(input,'cache_write_tokens',usage.input_tokens);
  const reasoningTokens=detail(output,'reasoning_tokens',usage.output_tokens);
  if(cachedInputTokens===null || cacheWriteTokens===null || reasoningTokens===null) return null;
  return {inputTokens:usage.input_tokens,cachedInputTokens,cacheWriteTokens,
    outputTokens:usage.output_tokens,
    reasoningTokens,
    totalTokens:usage.total_tokens};
}

function providerView(response){
  if(!response || typeof response!=='object') return null;
  const model=typeof response.model==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(response.model)
    ?response.model:null;
  const serviceTier=typeof response.service_tier==='string'&&
    /^[A-Za-z0-9._-]{1,40}$/.test(response.service_tier)?response.service_tier:null;
  const usage=usageView(response.usage);
  return model&&serviceTier&&usage?{model,serviceTier,usage}:null;
}

function internalFailure(fd,probeId,code,provider,elapsedMs,outcome='rejected'){
  const record={type:'result',probeId,ok:false,outcome,error:{code},
    ...(provider?{provider}:{}),elapsedMs};
  appendSynced(fd,record);
  return fault(code,`Terra fixture ${probeId}: ${code}`);
}

async function runFixtureSmoke(opts={}){
  const manifest=getSmokeManifest();
  if(opts.approvedFingerprint!==manifest.fingerprint)
    throw fault('approval-mismatch','exact smoke manifest fingerprint was not approved');
  if(typeof opts.transport!=='function')
    throw fault('transport-missing','fixture executor requires an injected transport');
  const probes=new Map(collectProbes().map(probe=>[probe.id,probe]));
  fs.mkdirSync(OUT_DIR,{recursive:true});
  const journalPath=path.join(OUT_DIR,`${manifest.runId}.jsonl`);
  let fd=null,chargedUsd=0;
  try{
    try{ fd=fs.openSync(journalPath,'wx'); }
    catch(e){
      if(e&&e.code==='EEXIST')
        throw fault('run-already-exists','this Terra smoke identity is already claimed');
      throw e;
    }
    phase('after-journal-claim');
    appendSynced(fd,{type:'run',fingerprint:manifest.fingerprint,manifest});
    phase('after-run-intent');

    for(const entry of manifest.entries){
      const probe=probes.get(entry.id);
      const request=deepFreeze(Decision.buildRequest(probe.ctx));
      if(sha(JSON.stringify(request))!==entry.requestHash)
        throw internalFailure(fd,entry.id,'request-drift',null,0);
      appendSynced(fd,{type:'attempt',probeId:entry.id,requestHash:entry.requestHash,
        reservedUsd:entry.reserve.maxUsd});
      phase('after-attempt-intent');
      const started=Date.now();
      let response;
      try{ response=await opts.transport(request); }
      catch(e){
        const elapsedMs=Math.max(0,Date.now()-started);
        appendSynced(fd,{type:'result',probeId:entry.id,ok:false,outcome:'indeterminate',
          error:{code:'transport-failure'},elapsedMs});
        throw fault('transport-failure',`Terra fixture ${entry.id}: transport failed`);
      }
      const elapsedMs=Math.max(0,Date.now()-started);
      phase('after-transport');
      const provider=providerView(response);
      if(!provider) throw internalFailure(fd,entry.id,'invalid-provider-metadata',null,
        elapsedMs,'indeterminate');
      if(provider.model!==manifest.model)
        throw internalFailure(fd,entry.id,'model-mismatch',provider,elapsedMs);
      if(provider.serviceTier!==manifest.serviceTier)
        throw internalFailure(fd,entry.id,'service-tier-mismatch',provider,elapsedMs);
      const responseUsd=conservativeUsd(provider.usage.inputTokens,
        provider.usage.outputTokens);
      if(provider.usage.inputTokens>entry.reserve.inputByteUpperBound ||
          provider.usage.outputTokens>request.max_output_tokens ||
          responseUsd>entry.reserve.maxUsd ||
          chargedUsd+responseUsd>manifest.maxUsd)
        throw internalFailure(fd,entry.id,'usage-over-reserve',provider,elapsedMs,
          'indeterminate');
      const parsed=Decision.parseResponse(response,probe.ctx);
      if(!parsed.ok)
        throw internalFailure(fd,entry.id,parsed.error.code,provider,elapsedMs);
      chargedUsd+=responseUsd;
      appendSynced(fd,{type:'result',probeId:entry.id,ok:true,
        decision:parsed.decision,provider,runCostUpperBoundUsd:chargedUsd,elapsedMs});
      phase('after-result-'+entry.id);
    }
    appendSynced(fd,{type:'complete',calls:manifest.maxCalls,
      runCostUpperBoundUsd:chargedUsd});
    return {journalPath,manifest};
  } finally {
    if(fd!==null) fs.closeSync(fd);
  }
}

module.exports=Object.freeze({FORMAT_VERSION,RUN_ID,PROBE_IDS,OFFICIAL_BASE_URL,
  MAX_USD,PRICING,getSmokeManifest,runFixtureSmoke,usageView,providerView});
