// Step-3 pilot: the LLM arm (Variant A) end to end, at small volume.
//
//   node exp/run-pilot.js --stub                  # offline pipeline check, no API
//   node exp/run-pilot.js --live [--sessions 2] [--hands 75] [--seed pilot1]
//
// The billed arm is opt-in: --live is required, needs ANTHROPIC_API_KEY in
// the environment, and fires live requests to api.anthropic.com (Haiku 4.5)
// — do not run it without the owner's spend go-ahead. Hard caps (calls +
// USD, spend.js) are checked before every request; hitting one aborts the
// run, and because every resolved decision is persisted to exp/out/ as
// JSONL first, a re-run with the same config resumes from disk without
// re-spending.
//
// Decision flow per oracle miss (oracle.js replays the session after each):
//   buildPrompt(ctx)  — pure; the in-builder card scan throws on any foreign
//                       card (criterion-5 tripwire: a throw kills the run)
//   messages.create   — per-persona prefix under cache_control; calls are
//                       sequential (one miss per replay), so the first call
//                       per persona writes the cache and later ones read it
//   legality.normalize — clamps counted ONCE per decision, at resolve time;
//                       the oracle cache stores the normalized action, so
//                       replays never re-count
//
// Measured (PLAN.md step 3): raw illegality, clamp histogram, tokens per
// decision, zero-cache-read calls after each persona's first (a silent
// prefix invalidator if nonzero), $ total and per hand, latency.

const fs=require('fs');
const path=require('path');
const make=require('./exp-harness');
const {runOracleSession}=require('./oracle');
const {normalize}=require('./legality');
const {buildPrompt, OUTPUT_SCHEMA}=require('./prompt');
const {makeSpendGuard, SpendCapExceeded}=require('./spend');

const MODEL='claude-haiku-4-5';
const MAX_OUTPUT_TOKENS=400; // JSON action + a two-sentence reason

function checkFoldHero(G){
  const S=G.S, hero=S.players[0], toCall=S.currentBet-hero.bet;
  const d={action:toCall>0?'fold':'check'};
  G.applyAction(hero,G.legalActionView?{...d,actionSeq:G.legalActionView(hero).actionSeq}:d);
  S.toAct=G.nextToAct(S.toAct);
  G.step();
}

function callModel(client, prefix, spot){
  return client.messages.create({
    model:MODEL,
    max_tokens:MAX_OUTPUT_TOKENS,
    system:[{type:'text', text:prefix, cache_control:{type:'ephemeral'}}],
    messages:[{role:'user', content:spot}],
    output_config:{format:{type:'json_schema', schema:OUTPUT_SCHEMA}},
  });
}

// output_config.format guarantees valid JSON in the first text block; the
// fallback paths (truncation, empty content, non-string text) feed null
// into normalize, which counts it as unknown-action rather than crashing
// the run — nothing in here may throw after a call has been paid for.
function parseDecision(response){
  const block=((response&&response.content)||[]).find(b=>b&&b.type==='text');
  const text=(block && typeof block.text==='string') ? block.text : null;
  if(text===null)
    return {raw:null, parseError:'no text block (stop_reason: '+(response&&response.stop_reason)+')'};
  try{ return {raw:JSON.parse(text)}; }
  catch(e){ return {raw:null, parseError:'unparseable: '+text.slice(0,200)}; }
}

// Offline stand-in with the same surface as the SDK client. It pins the
// live request contract (a field drift in callModel fails the suite, not
// the first billed call) and emits a deterministic action mix that reaches
// every legality branch: mostly calls (call-with-nothing-to-call is a real
// non-cosmetic clamp), plus under-min raises and missing-amount bets.
// opts.cold makes every response a full-price miss (zero cache tokens) so
// the post-warm miss detector can be proven to fire.
function makeStubClient(opts={}){
  const warmed=new Set();
  let n=0;
  return {messages:{async create(req){
    if(req.model!==MODEL) throw new Error('stub: wrong model '+req.model);
    if(req.max_tokens!==MAX_OUTPUT_TOKENS) throw new Error('stub: wrong max_tokens');
    if(!req.system || req.system[0].cache_control.type!=='ephemeral')
      throw new Error('stub: system prefix not under ephemeral cache_control');
    if(req.output_config.format.type!=='json_schema' || req.output_config.format.schema!==OUTPUT_SCHEMA)
      throw new Error('stub: output_config is not the pinned OUTPUT_SCHEMA');
    if(!Array.isArray(req.messages) || req.messages.length!==1 || req.messages[0].role!=='user')
      throw new Error('stub: expected a single user message');
    const prefix=req.system[0].text;
    const first=!warmed.has(prefix); warmed.add(prefix);
    n++;
    const d = n%5===0 ? {action:'raise', amount:1, reason:'stub under-min raise'}
            : n%7===0 ? {action:'bet', reason:'stub bet with no amount'}
            : {action:'call', reason:'stub flats'};
    return {
      model:'stub',
      stop_reason:'end_turn',
      content:[{type:'text', text:JSON.stringify(d)}],
      usage:opts.cold
        ? {input_tokens:5050, cache_creation_input_tokens:0, cache_read_input_tokens:0, output_tokens:30}
        : {input_tokens:250,
           cache_creation_input_tokens:first?4800:0,
           cache_read_input_tokens:first?0:4800,
           output_tokens:30},
    };
  }}};
}

function percentile(sorted, p){
  if(!sorted.length) return null;
  return sorted[Math.min(sorted.length-1, Math.floor(p/100*sorted.length))];
}

// opts: {sessions, hands, seed, client, mode:'stub'|'api', maxCalls, maxUsd, outDir, quiet}
async function runPilot(opts){
  const {sessions, hands, seed, client, mode}=opts;
  // The seed lands in output filenames; anything else could escape outDir.
  if(!/^[A-Za-z0-9_-]+$/.test(String(seed)))
    throw new Error('seed must be filename-safe ([A-Za-z0-9_-]+), got: '+seed);
  const log=opts.quiet?()=>{}:console.log;
  const outDir=opts.outDir||path.join(__dirname,'out');
  fs.mkdirSync(outDir,{recursive:true});
  const jsonlPath=path.join(outDir, `pilot-${mode}-${seed}.jsonl`);
  const guard=makeSpendGuard({maxCalls:opts.maxCalls, maxUsd:opts.maxUsd});

  // Resume: reload persisted decisions into the oracle cache. Spend already
  // made counts against this run's caps too — the approval is a total budget,
  // not a per-invocation one. Stub and api records live in different files
  // (mode is in the filename); the header additionally pins the full config
  // so a mismatched sessions/hands/seed file is rejected, not misread.
  const cache=new Map();
  const header={type:'header', config:{sessions, hands, seed, mode, model:mode==='stub'?'stub':MODEL}};
  if(fs.existsSync(jsonlPath)){
    const rawLines=fs.readFileSync(jsonlPath,'utf8').split('\n').filter(Boolean);
    const lines=[];
    for(let i=0;i<rawLines.length;i++){
      try{ lines.push(JSON.parse(rawLines[i])); }
      catch(e){
        // A kill mid-append can tear the final line; its decision never made
        // the oracle cache, so dropping it is lossless. Anything else is real
        // corruption and must stay loud.
        if(i===rawLines.length-1){ log(`dropping torn final line of ${path.basename(jsonlPath)}`); break; }
        throw new Error(`corrupt line ${i+1} in ${jsonlPath}: ${e.message}`);
      }
    }
    if(!lines.length || lines[0].type!=='header' || JSON.stringify(lines[0].config)!==JSON.stringify(header.config))
      throw new Error(`existing ${jsonlPath} has a different config header — move it aside or match the config`);
    for(const rec of lines.slice(1)){
      cache.set(rec.key, {ctxJson:rec.ctxJson, d:rec.d});
      guard.record(rec.usage);
    }
    log(`resumed ${cache.size} decisions from ${path.basename(jsonlPath)} ($${guard.usd.toFixed(4)} already spent)`);
  } else {
    fs.writeFileSync(jsonlPath, JSON.stringify(header)+'\n');
  }

  const records=[];   // new decisions this invocation, in call order
  const seenPersona=new Set();

  async function resolvePending(pending, oracleCache){
    for(const p of pending){
      const {prefix, spot}=buildPrompt(p.ctx); // tripwire: throws on foreign cards
      guard.beforeCall();
      const persona=p.ctx.style.tag;
      const warmCall=!seenPersona.has(persona); seenPersona.add(persona);
      const t0=Date.now();
      const response=await callModel(client, prefix, spot);
      const ms=Date.now()-t0;
      const {raw, parseError}=parseDecision(response);
      const view={toCall:p.ctx.toCall, currentBet:p.ctx.currentBet, minRaise:p.ctx.minRaise,
        myBet:p.ctx.myBet, stack:p.ctx.myStack};
      const norm=normalize(raw, view);
      const rec={key:p.key, persona, ctxJson:p.ctxJson, raw, parseError:parseError||null,
        d:norm.d, clamps:norm.clamps, rawIllegal:norm.rawIllegal, warmCall,
        usage:response.usage, ms, model:response.model, ts:new Date().toISOString()};
      // Persist first, then account, then cache: a billed call may never
      // exist outside the JSONL, and a crash at any point re-accounts the
      // persisted record on resume instead of losing it.
      fs.appendFileSync(jsonlPath, JSON.stringify(rec)+'\n');
      guard.record(response.usage);
      records.push(rec);
      oracleCache.set(p.key, {ctxJson:p.ctxJson, d:norm.d});
    }
  }

  let totalHands=0, attempts=0, stray=0, conservationBugs=0, capHit=null;
  const perSession=[];
  try{
    for(let s=0;s<sessions;s++){
      const res=await runOracleSession({make, seed:`${seed}|s${s}`, hands,
        heroPolicy:checkFoldHero, resolvePending, cache});
      const chips=res.G.roster.reduce((a,p)=>a+p.stack,0);
      if(chips!==6*res.G.START){ conservationBugs++; log(`BUG s${s}: chips ${chips} != ${6*res.G.START}`); }
      totalHands+=res.G.session.hands;
      attempts+=res.attempts;
      stray+=res.state.strayDraws;
      perSession.push({session:s, hands:res.G.session.hands, attempts:res.attempts,
        over:res.G.session.over||null});
      log(`  s${s}: ${res.G.session.hands} hands, ${res.attempts} replays, ` +
        `$${guard.usd.toFixed(4)} spent, ${guard.calls} calls`);
    }
  } catch(e){
    if(!e.isSpendCap) throw e;
    capHit=e.message;
    log(`SPEND CAP: ${e.message} — all resolved decisions are persisted; re-run to resume`);
  }

  // Summary over EVERY persisted decision for this config (resumed + new);
  // call-order stats (latency, cold reads) only cover this invocation.
  const all=[...fs.readFileSync(jsonlPath,'utf8').split('\n').filter(Boolean)
    .map(l=>JSON.parse(l)).filter(r=>r.type!=='header')];
  const byPersona={};
  const clampHist={};
  let rawIllegal=0, cosmeticOnly=0, parseErrors=0;
  for(const r of all){
    const b=byPersona[r.persona]||(byPersona[r.persona]={decisions:0, rawIllegal:0});
    b.decisions++;
    if(r.rawIllegal){ rawIllegal++; b.rawIllegal++; }
    else if(r.clamps.length) cosmeticOnly++;
    if(r.parseError) parseErrors++;
    for(const c of r.clamps) clampHist[c.code]=(clampHist[c.code]||0)+1;
  }
  const u=k=>all.reduce((a,r)=>a+(r.usage[k]||0),0);
  const lat=records.map(r=>r.ms).sort((a,b)=>a-b);
  // Any post-warm call that reads zero prefix tokens missed the cache — a
  // silent invalidator shows up as a WRITE on every call (never a read), so
  // writes must count as misses too. The PLAN's "zero reads = pilot failure"
  // gate rides on this number; a handful from 5-minute TTL expiry is benign,
  // per-call misses are not.
  const postWarmMisses=records.filter(r=>!r.warmCall &&
    !(r.usage.cache_read_input_tokens>0)).length;

  const summary={
    config:header.config,
    caps:{maxCalls:opts.maxCalls, maxUsd:opts.maxUsd, capHit},
    volume:{sessions:perSession.length, totalHands, decisions:all.length,
      replayAttempts:attempts, strayDraws:stray, conservationBugs, perSession},
    legality:{rawIllegal, rawIllegalRate:all.length?rawIllegal/all.length:null,
      cosmeticOnly, parseErrors, clampHist, byPersona},
    tokens:{perDecision:all.length?{
      input:u('input_tokens')/all.length,
      cacheWrite:u('cache_creation_input_tokens')/all.length,
      cacheRead:u('cache_read_input_tokens')/all.length,
      output:u('output_tokens')/all.length}:null,
      postWarmMisses},
    // perHand is the pilot's headline economics number; on a cap hit the
    // spend covers a partially played session whose hands are not counted,
    // so the ratio would read high — report null instead of a wrong number.
    costUsd:{total:guard.usd, calls:guard.calls,
      perHand:(totalHands && !capHit)?guard.usd/totalHands:null},
    latencyMs:{p50:percentile(lat,50), p95:percentile(lat,95), n:lat.length},
  };
  const summaryPath=path.join(outDir, `pilot-${mode}-${seed}-summary.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary,null,2));
  log(`\nwrote ${path.relative(process.cwd(), summaryPath)}`);
  return summary;
}

// ---------- CLI ----------
function fatal(msg){ console.error('run-pilot: '+msg); process.exit(1); }
function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--stub'){ args.stub=true; continue; }
    if(a==='--live'){ args.live=true; continue; }
    if(!a.startsWith('--')) fatal(`unexpected argument: ${a}`);
    const key=a.slice(2);
    if(!['sessions','hands','seed','max-usd','max-calls'].includes(key)) fatal(`unknown flag: ${a}`);
    const val=argv[i+1];
    if(val===undefined || val.startsWith('--')) fatal(`flag ${a} needs a value`);
    args[key]=val; i++;
  }
  return args;
}

if(require.main===module){
  const args=parseArgs(process.argv.slice(2));
  const SESSIONS=args.sessions===undefined?2:+args.sessions;
  const HANDS=args.hands===undefined?75:+args.hands;
  const SEED=args.seed||'pilot1';
  const MAX_USD=args['max-usd']===undefined?5:+args['max-usd'];
  const MAX_CALLS=args['max-calls']===undefined?2500:+args['max-calls'];
  if(!Number.isInteger(SESSIONS)||SESSIONS<1) fatal('--sessions must be a positive integer');
  if(!Number.isInteger(HANDS)||HANDS<2) fatal('--hands must be an integer >= 2');
  if(!(MAX_USD>0)||!(MAX_CALLS>0)) fatal('caps must be positive');

  // Spending real money is opt-in: a bare invocation must never bill.
  if(args.stub && args.live) fatal('--stub and --live are mutually exclusive');
  if(!args.stub && !args.live) fatal('choose a mode: --stub (offline pipeline check) or --live (billed API run)');

  let client, mode;
  if(args.stub){ client=makeStubClient(); mode='stub'; }
  else {
    if(!process.env.ANTHROPIC_API_KEY) fatal('ANTHROPIC_API_KEY not set');
    let Anthropic;
    try{ Anthropic=require('@anthropic-ai/sdk'); }
    catch(e){ fatal('@anthropic-ai/sdk not installed — run: npm install --prefix exp'); }
    client=new Anthropic();
    mode='api';
    console.log(`LIVE RUN: ${MODEL}, caps $${MAX_USD} / ${MAX_CALLS} calls`);
  }
  if(mode==='api' && (SESSIONS!==2||HANDS!==75||SEED!=='pilot1'))
    console.log('NOTE: config differs from the pilot registration (2x75, pilot1) — output is exploratory');

  runPilot({sessions:SESSIONS, hands:HANDS, seed:SEED, client, mode,
    maxCalls:MAX_CALLS, maxUsd:MAX_USD})
    .then(s=>{
      if(s.caps.capHit) process.exitCode=2;
      console.log(`decisions ${s.volume.decisions}, rawIllegal ${(s.legality.rawIllegalRate*100).toFixed(2)}%, `+
        `$${s.costUsd.total.toFixed(4)} total`+(s.costUsd.perHand?` ($${s.costUsd.perHand.toFixed(5)}/hand)`:''));
    })
    .catch(e=>{ console.error(e.stack||e); process.exit(1); });
}

module.exports={runPilot, makeStubClient, checkFoldHero, parseDecision, MODEL};
