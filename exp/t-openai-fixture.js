'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const cp=require('child_process');
const Module=require('module');
const Decision=require('./openai-decision');
const {collectProbes}=require('./openai-probes');
const Fixture=require('./openai-fixture-runner');

const ROOT=path.join(__dirname,'..');
const RUNNER_PATH=path.join(__dirname,'openai-fixture-runner.js');
const RUNNER_SOURCE=fs.readFileSync(RUNNER_PATH,'utf8');
const OUT_DECL="const OUT_DIR=path.join(__dirname,'terra-state');";
const PHASE_DECL='const phase=()=>{};';

function fixtureAt(outDir,crashPhase=null){
  const outMatches=RUNNER_SOURCE.split(OUT_DECL).length-1;
  const phaseMatches=RUNNER_SOURCE.split(PHASE_DECL).length-1;
  if(outMatches!==1 || phaseMatches!==1)
    throw new Error(`fixture transforms matched output=${outMatches}, phase=${phaseMatches}`);
  const phaseSource=crashPhase
    ?`const phase=name=>{if(name===${JSON.stringify(crashPhase)}) process.exit(71);};`
    :PHASE_DECL;
  const source=RUNNER_SOURCE
    .replace(OUT_DECL,`const OUT_DIR=${JSON.stringify(outDir)};`)
    .replace(PHASE_DECL,phaseSource);
  const instance=new Module(RUNNER_PATH,module);
  instance.filename=RUNNER_PATH;
  instance.paths=Module._nodeModulePaths(__dirname);
  instance._compile(source,RUNNER_PATH);
  return instance.exports;
}

function responseFor(decision,extra={}){
  return {
    status:'completed',
    model:Decision.MODEL,
    service_tier:Decision.SERVICE_TIER,
    usage:{
      input_tokens:100,
      input_tokens_details:{cached_tokens:0,cache_write_tokens:0},
      output_tokens:10,
      output_tokens_details:{reasoning_tokens:2},
      total_tokens:110,
    },
    output:[
      {type:'reasoning',summary:[]},
      {type:'message',role:'assistant',status:'completed',content:[{
        type:'output_text',
        text:JSON.stringify({action:decision.action,
          amount:Number.isInteger(decision.amount)?decision.amount:null}),
      }]},
    ],
    ...extra,
  };
}

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const waitForFile=async file=>{
  for(let i=0;i<500;i++){
    if(fs.existsSync(file)) return;
    await delay(10);
  }
  throw new Error(`timed out waiting for ${path.basename(file)}`);
};

async function childMain(outDir,mode){
  const crashPhase=mode.startsWith('crash-')?mode.slice(6):null;
  const fixture=fixtureAt(outDir,crashPhase);
  const marker=path.join(outDir,'transport-calls.txt');
  const release=path.join(outDir,'release');
  const probes=new Map(collectProbes().map(probe=>[probe.id,probe]));
  const manifest=fixture.getSmokeManifest();
  let call=0;
  try{
    await fixture.runFixtureSmoke({
      approvedFingerprint:manifest.fingerprint,
      transport:async request=>{
        const probe=probes.get(manifest.entries[call++].id);
        fs.appendFileSync(marker,probe.id+'\n');
        if(mode==='hold'){
          for(let i=0;i<1000&&!fs.existsSync(release);i++) await delay(10);
          if(!fs.existsSync(release)) throw new Error('hold-timeout');
        }
        return responseFor(probe.policyA);
      },
    });
  } catch(e){
    process.stderr.write(`error:${e&&e.code?e.code:'unknown'}\n`);
    process.exitCode=2;
  }
}

const readLines=file=>fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean);
const readJournal=file=>readLines(file).map(line=>JSON.parse(line));
const spawnChild=(outDir,mode)=>new Promise(resolve=>{
  const child=cp.spawn(process.execPath,[__filename,'--worker',outDir,mode],{
    cwd:ROOT,stdio:['ignore','pipe','pipe'],
  });
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{ stdout+=chunk; });
  child.stderr.on('data',chunk=>{ stderr+=chunk; });
  child.on('close',(status,signal)=>resolve({status,signal,stdout,stderr}));
});
const deeplyFrozen=value=>!value || typeof value!=='object' ||
  (Object.isFrozen(value) && Object.values(value).every(deeplyFrozen));

async function testMain(){
  console.log('OPENAI FIXTURE TEST - manifest, journal, concurrency, and crash boundaries\n');
  process.exitCode=1;
  let fails=0;
  const ok=(condition,name,detail)=>{
    if(!condition) fails++;
    console.log(`  ${condition?'ok  ':'FAIL'} ${name}${detail?'   '+detail:''}`);
  };
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'poker-terra-fixture-'));
  process.on('exit',()=>fs.rmSync(temp,{recursive:true,force:true}));
  const fresh=name=>path.join(temp,name);
  const journal=dir=>path.join(dir,`${Fixture.RUN_ID}.jsonl`);
  const manifest=Fixture.getSmokeManifest();
  const probes=new Map(collectProbes().map(probe=>[probe.id,probe]));

  ok(Object.isFrozen(manifest) && Object.isFrozen(manifest.entries) &&
    manifest.entries.every(entry=>Object.isFrozen(entry)&&Object.isFrozen(entry.reserve)),
  'manifest and nested entries are immutable');
  ok(JSON.stringify(manifest.entries.map(entry=>entry.id))===
    JSON.stringify(['postflop-bet','short-layered-allin']) &&
    manifest.model==='gpt-5.6-terra' && manifest.endpoint==='https://api.openai.com/v1' &&
    manifest.serviceTier==='default' && manifest.maxCalls===2 && manifest.maxUsd===0.05,
  'manifest fixes the exact two probes, model, endpoint, tier, call cap, and USD cap');
  const independentlyReserved=manifest.entries.reduce((sum,entry)=>{
    const request=Decision.buildRequest(probes.get(entry.id).ctx);
    const bytes=Buffer.byteLength(JSON.stringify(request),'utf8');
    return sum+Math.ceil(((bytes*2.5+request.max_output_tokens*12)/1e6*1.1)*1e8)/1e8;
  },0);
  ok(manifest.reservedUsd===independentlyReserved && manifest.reservedUsd<=manifest.maxUsd,
    'official-rate arithmetic independently reserves the run below its fixed cap',
    `$${manifest.reservedUsd.toFixed(8)} reserved`);
  ok(manifest.fingerprint==='cb4fec5eafbb4cd8b1a3190c7af63508df8803bf26143b4c7dd186503f9f0f8a' &&
    JSON.stringify(manifest.entries.map(entry=>entry.requestHash))===JSON.stringify([
      '63f7016bfce0464478d799b27cb05eb3f5aa1ffa5a94a945d3800fc054a62c57',
      '1cddec2ea5d4d88e6ba7f14f7a11a597b510820c0b04879978d4936ed3da1bce',
    ]),
  'manifest fingerprint and request hashes match frozen golden values');
  ok(RUNNER_SOURCE.split(OUT_DECL).length-1===1 &&
    RUNNER_SOURCE.split(PHASE_DECL).length-1===1 &&
    !/opts\.(outDir|onPhase)/.test(RUNNER_SOURCE),
  'production executor owns one canonical journal location and no test hook');
  ok(![
    /process\.env/,
    /require\(['"]openai['"]\)/,
    /\bfetch\s*\(/,
    /https?\.request\s*\(/,
    /run-pilot/,
    /require\(['"]\.\/spend['"]\)/,
    /require\(['"]\.\/legality['"]\)/,
    /require\(['"]\.\/oracle['"]\)/,
  ].some(pattern=>pattern.test(RUNNER_SOURCE)),
  'executor has no credential, SDK, network, or historical-runner dependency');

  {
    const dir=fresh('approval');
    const fixture=fixtureAt(dir);
    let calls=0,code=null;
    try{
      await fixture.runFixtureSmoke({approvedFingerprint:'wrong',
        transport:async()=>{ calls++; }});
    } catch(e){ code=e.code; }
    ok(code==='approval-mismatch' && calls===0 && !fs.existsSync(dir),
      'approval mismatch fails before output creation or transport');
  }

  {
    const dir=fresh('success');
    const fixture=fixtureAt(dir);
    const alternate={
      'postflop-bet':{action:'bet',amount:2},
      'short-layered-allin':{action:'fold'},
    };
    let calls=0,intentsVisible=true,immutableRequests=true,syncs=0;
    const originalFsync=fs.fsyncSync;
    fs.fsyncSync=fd=>{ syncs++; return originalFsync(fd); };
    let result;
    try{
      result=await fixture.runFixtureSmoke({
        approvedFingerprint:manifest.fingerprint,
        transport:async request=>{
          const probe=probes.get(manifest.entries[calls].id);
          const records=readJournal(journal(dir));
          intentsVisible=intentsVisible && records[0].type==='run' &&
            records.at(-1).type==='attempt' && records.at(-1).probeId===probe.id &&
            syncs>=(calls===0?2:4);
          immutableRequests=immutableRequests && deeplyFrozen(request);
          let topRejected=false,nestedRejected=false;
          try{ request.max_output_tokens=999999; } catch(e){ topRejected=true; }
          try{ request.text.format.schema.type='array'; } catch(e){ nestedRejected=true; }
          immutableRequests=immutableRequests && topRejected && nestedRejected &&
            request.max_output_tokens===128 && request.text.format.schema.type==='object';
          calls++;
          return responseFor(alternate[probe.id],{poison:'DO-NOT-PERSIST'});
        },
      });
    } finally {
      fs.fsyncSync=originalFsync;
    }
    const raw=fs.readFileSync(result.journalPath,'utf8');
    const records=readJournal(result.journalPath);
    const results=records.filter(record=>record.type==='result');
    ok(calls===2 && intentsVisible && immutableRequests && syncs===6,
      'approved requests are deeply immutable and each record is fsynced before use');
    ok(JSON.stringify(records.map(record=>record.type))===
      JSON.stringify(['run','attempt','result','attempt','result','complete']) &&
      JSON.stringify(results.map(record=>record.decision))===
      JSON.stringify(manifest.entries.map(entry=>alternate[entry.id])) &&
      results[0].runCostUpperBoundUsd>0 &&
      results[1].runCostUpperBoundUsd>results[0].runCostUpperBoundUsd &&
      records.at(-1).runCostUpperBoundUsd===results[1].runCostUpperBoundUsd &&
      records.at(-1).runCostUpperBoundUsd<=manifest.maxUsd,
    'successful run journals the two independent legal provider decisions and cost bound');
    ok(!raw.includes('DO-NOT-PERSIST'),
      'journal allowlist excludes unknown provider data');
    let rerunCalls=0,rerunCode=null;
    try{
      await fixture.runFixtureSmoke({approvedFingerprint:manifest.fingerprint,
        transport:async()=>{ rerunCalls++; }});
    } catch(e){ rerunCode=e.code; }
    ok(rerunCode==='run-already-exists' && rerunCalls===0,
      'completed run identity cannot be resumed or repeated');
  }

  {
    const dir=fresh('illegal');
    const fixture=fixtureAt(dir);
    let calls=0,code=null;
    try{
      await fixture.runFixtureSmoke({approvedFingerprint:manifest.fingerprint,
        transport:async request=>{
          const probe=probes.get(manifest.entries[calls].id);
          calls++;
          const legal=new Set(probe.ctx.legal.actions.map(item=>item.action));
          const unavailable=['fold','check','call','bet','raise']
            .find(action=>!legal.has(action));
          return responseFor({action:unavailable});
        }});
    } catch(e){ code=e.code; }
    const records=readJournal(journal(dir));
    ok(code==='action-not-legal' && calls===1 &&
      records.at(-1).type==='result' && records.at(-1).outcome==='rejected',
    'context-illegal provider action stops before the second call and is rejected');
  }

  {
    const dir=fresh('metadata');
    const fixture=fixtureAt(dir);
    let calls=0,code=null;
    try{
      await fixture.runFixtureSmoke({approvedFingerprint:manifest.fingerprint,
        transport:async request=>{
          const probe=probes.get(manifest.entries[calls].id);
          calls++;
          const response=responseFor(probe.policyA);
          response.usage.input_tokens_details.cached_tokens=101;
          return response;
        }});
    } catch(e){ code=e.code; }
    const records=readJournal(journal(dir));
    ok(code==='invalid-provider-metadata' && calls===1 &&
      records.at(-1).outcome==='indeterminate' && !records.at(-1).provider,
    'invalid usage metadata fails closed as indeterminate');
  }

  {
    const dir=fresh('usage-over');
    const fixture=fixtureAt(dir);
    let calls=0,code=null;
    try{
      await fixture.runFixtureSmoke({approvedFingerprint:manifest.fingerprint,
        transport:async request=>{
          const entry=manifest.entries[calls];
          const probe=probes.get(entry.id);
          calls++;
          const response=responseFor(probe.policyA);
          response.usage.input_tokens=entry.reserve.inputByteUpperBound+1;
          response.usage.total_tokens=response.usage.input_tokens+
            response.usage.output_tokens;
          return response;
        }});
    } catch(e){ code=e.code; }
    const records=readJournal(journal(dir));
    ok(code==='usage-over-reserve' && calls===1 &&
      records.at(-1).outcome==='indeterminate' &&
      records.at(-1).error.code==='usage-over-reserve',
    'provider usage over the approved reserve burns the run before call two');
  }

  for(const [field,value,expected] of [
    ['model','gpt-5.6-luna','model-mismatch'],
    ['service_tier','flex','service-tier-mismatch'],
  ]){
    const dir=fresh(expected);
    const fixture=fixtureAt(dir);
    let calls=0,code=null;
    try{
      await fixture.runFixtureSmoke({approvedFingerprint:manifest.fingerprint,
        transport:async request=>{
          const probe=probes.get(manifest.entries[calls].id);
          calls++;
          return responseFor(probe.policyA,{[field]:value});
        }});
    } catch(e){ code=e.code; }
    const records=readJournal(journal(dir));
    ok(code===expected && calls===1 && records.at(-1).outcome==='rejected' &&
      records.at(-1).provider,
    `${field} mismatch is recorded and stops before call two`);
  }

  {
    const dir=fresh('transport');
    const fixture=fixtureAt(dir);
    let calls=0,code=null;
    try{
      await fixture.runFixtureSmoke({approvedFingerprint:manifest.fingerprint,
        transport:async()=>{ calls++; throw new Error('SECRET-TRANSPORT-DATA'); }});
    } catch(e){ code=e.code; }
    const raw=fs.readFileSync(journal(dir),'utf8');
    const records=readJournal(journal(dir));
    ok(code==='transport-failure' && calls===1 &&
      records.at(-1).outcome==='indeterminate' && !raw.includes('SECRET-TRANSPORT-DATA'),
    'transport failure persists only a stable code and never the thrown data');
  }

  {
    const dir=fresh('corrupt');
    const fixture=fixtureAt(dir);
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(journal(dir),'not-json\n');
    let calls=0,code=null;
    try{
      await fixture.runFixtureSmoke({approvedFingerprint:manifest.fingerprint,
        transport:async()=>{ calls++; }});
    } catch(e){ code=e.code; }
    ok(code==='run-already-exists' && calls===0,
      'any existing journal blocks transport without reading or replacing it');
  }

  const crashes=[
    ['after-journal-claim',0,0],
    ['after-run-intent',1,0],
    ['after-attempt-intent',2,0],
    ['after-transport',2,1],
    ['after-result-postflop-bet',3,1],
    ['after-result-short-layered-allin',5,2],
  ];
  for(const [phase,lineCount,markerCount] of crashes){
    const dir=fresh(`crash-${phase}`);
    const first=await spawnChild(dir,`crash-${phase}`);
    const records=readJournal(journal(dir));
    const marker=path.join(dir,'transport-calls.txt');
    const calls=fs.existsSync(marker)?readLines(marker).length:0;
    const second=await spawnChild(dir,'normal');
    const cumulativeOk=phase!=='after-result-short-layered-allin' ||
      records[4].runCostUpperBoundUsd>records[2].runCostUpperBoundUsd;
    ok(first.status===71 && records.length===lineCount && calls===markerCount &&
      cumulativeOk && second.status===2 && /error:run-already-exists/.test(second.stderr),
    `abrupt ${phase} crash leaves one claimed, non-resumable identity`);
  }

  {
    const dir=fresh('race');
    const marker=path.join(dir,'transport-calls.txt');
    const release=path.join(dir,'release');
    const firstPromise=spawnChild(dir,'hold');
    await waitForFile(marker);
    const second=await spawnChild(dir,'normal');
    fs.writeFileSync(release,'release\n');
    const first=await firstPromise;
    const calls=readLines(marker);
    ok(first.status===0 && second.status===2 &&
      /error:run-already-exists/.test(second.stderr) && calls.length===2 &&
      JSON.stringify(calls)===JSON.stringify(manifest.entries.map(entry=>entry.id)),
    'contender is rejected while the winning process still owns the journal');
  }

  console.log(fails?'\n  OPENAI FIXTURE FAILURES PRESENT':
    '\n  OpenAI fixture boundary is independently constrained');
  process.exitCode=fails?1:0;
}

if(process.argv[2]==='--worker') childMain(process.argv[3],process.argv[4]);
else testMain().catch(e=>{
  console.error(`FAIL fixture test threw: ${e.message}`);
  process.exitCode=1;
});
