# exp/ — measurement toolkit (offline, never deployed)

**Three things live here.** First, the measurement toolkit for behavioral claims: the
seeded harness, gate suite, locks, and blind A/B generator. Second, the concluded 2026
Haiku experiment, whose narration-bearing LLM arm was rejected ([PLAN.md](PLAN.md)
§ Status). Third, a new action-only Terra experiment that tests LLM decisions without
LLM narration ([OPENAI-PLAN.md](OPENAI-PLAN.md)).

**Current action-only LLM work:** the offline diagnostic gate and fixture executor are complete.
`openai-decision.js` builds a `gpt-5.6-terra` Responses API request from the acting
bot's fair `ctx`, strictly parses `{action, amount}`, and rejects any decision that is
not valid under that context's exact `legal` descriptor. `openai-probes.js` freezes
nine real Policy A spots for development checks. `openai-fixture-runner.js` fixes a
two-spot, $0.05 maximum provider smoke behind exact fingerprint approval, an exclusive
canonical journal claim, and fsynced records. It still does not import an SDK, read
credentials, make a network call, choose a fallback, or spend money. The next
increment is the thin live adapter in `OPENAI-PLAN.md`, not a full session runner.

**Policy A versus Policy B:**

```bash
node exp/run-policy-gate.js
```

This runs the explicit `v1` and `v2` arms through the frozen persona gate, then
continues to the existing exploitability and readability locks only if the persona
gate passes. Policy-qualified outputs are isolated under `exp/out/`; raw size fitting
is counted, while a rejected or fallback action in Policy B's owned non-layered
postflop path fails. The 2026-08-03 run stopped at persona fidelity, so Policy B was
not promoted and no blind panel was run. Frozen result:
[`ref/policy-b-objective.md`](ref/policy-b-objective.md).

**How to re-measure whether the bots feel human** (the thing most likely to be needed):

```bash
node exp/run-ab.js --seed <fresh> --action-only   # play only — the headline instrument
node exp/run-ab.js --seed <fresh>                 # full transcripts (play + stated reasons)
```

The old arm is genuinely the old engine, not a memory: `run-ab.js` git-shows a
commitish (default `8f0bada`, the frozen pre-humanize engine anchor) into `exp/out/` and
loads it through `exp-harness`'s `htmlPath` + `expectedRandSites`. That constant
is load-bearing — it is also the readability lock's reference and the `old` arm of
every archived panel. Later experiment-only commits preceded the first humanize engine
change, but their `poker-trainer.html` blob is identical to this anchor.

Then run the protocol frozen in [ref/feel-panel.md](ref/feel-panel.md) — judges get ONE
block file each and never repo access (`ref/` holds the answer key and every prior
verdict; a judge who has seen it is burned).

The shipped app is never modified by anything in here — every runner loads
`poker-trainer.html` (or an older build, via `htmlPath`) and rewrites it in memory.

Key design calls, with independent-assessment findings folded in:

- **No async engine.** `botDecide` stays synchronous. LLM arms use a decision oracle
  (`oracle.js`): cache hit → return; miss → record prompt, abort session, resolve the
  decision outside the engine, replay from seed. Replays reproduce identical ctx
  (verified on every cache hit — divergence throws). Cache keys are scoped by seed so
  a cache shared across runs can never serve another session's decision.
- **ctx is extended in older exp builds** with `currentBet` and `minRaise` for the
  external legality normalizer. Current builds already ship the exact `legal` view and
  detached public opponent ranges. `exp-harness.js` still branches by engine generation
  so historical A/B runs remain reproducible. The extension carries no hidden data.
- **Keyed RNG streams** (`prng.js`, wired in `exp-harness.js`): button per session,
  deck per hand index, policy rolls + equity Monte Carlo per (hand, decision). Deals are identical
  across arms at the same seed (duplicate-poker variance reduction); draws outside the
  expected windows are counted and must be zero.
- **The shipped engine has a strict legal-action boundary.** Historical LLM arms pass
  through `normalize()` and measure any deterministic fallback. The Terra boundary is
  stricter: malformed or context-illegal output is a terminal rejected decision, not
  a fitted action or fallback. Every `amount` is a bet-**to** total for the street,
  never an increment.
- **Legality normalizer** (`legality.js`) runs before `applyAction` for LLM arms.
  Historical engines accepted malformed actions that could stall the loop, while the
  current boundary rejects them. Every coercion is counted;
  raw illegality is a pre-registered metric, with verb-only relabels (bet↔raise)
  counted separately and excluded from it.

**Live tooling** — used by `run-all.sh` or by anyone re-measuring the bots:

⚠ `run-all.sh` is not read-only. `t-exp.js` removes and recreates test directories, and
the probe and label locks overwrite their matching files under `exp/out/`. Those outputs
are disposable and gitignored, but run the suite only when replacing scratch state is
acceptable.

`exp/terra-state/` is different. It is ignored local audit state for the one-time
Terra smoke, not disposable output. Never delete it after approving or starting the
smoke. If it is lost, the prior approval is spent; reconcile provider usage and obtain
fresh explicit owner approval before any further call.

| File | Role |
|---|---|
| `exp-harness.js` | seeded harness: RNG stream injection, explicit `dispatch`/`v1`/`v2` policy selection, coded-policy fit/rejection observation, decision hook, and `htmlPath` for cross-version A/B; every source rewrite asserted |
| `t-exp.js` | the gate suite — humanize gates (sizing, boundary blur, roll governance, short-stack raises, voice bans, mood) plus experiment infrastructure (determinism, deal identity, oracle replay, legality, prompt purity, provider request/response contracts) |
| `t-policy-gate.js` | policy-runner routing/provenance, isolated outputs, fit-vs-rejection observation, and literal pass/fail oracle fixtures |
| `run-policy-gate.js` | frozen Policy A/B staircase: persona fidelity first, then the existing exploitability and readability locks; exits on the first failed stage |
| `run-probes.js` | exploitability LOCK — degenerate heroes must keep losing badly; fails the build otherwise. **Arms only at 30×200/`probe1`**; any other config prints `lock skipped` and exits 0. bb/100 here is a *floor*, not an estimate: no rebuys, so a busting strategy caps its loss at −200 per session — valid for relative comparison only |
| `run-labels.js` | readability LOCK — bots must stay legible; `--html`/`--sites` re-measures another engine build (that is how the bounds were set). **Arms only at 90 sessions/`label1`** |
| `run-ab.js` | blind A/B packet: 8 isolated 30-hand blocks, old engine vs current, shared deal seeds, key sequestered. `--action-only` emits the play log alone (the format behind the headline 3.00-vs-2.13); default emits full transcripts. Scores compare only within a format — use the matching judge prompt |
| `run-baseline.js` | persona frequency bands + pooled split-half + transcripts; `--policy` writes self-identifying arm outputs without replacing legacy scratch names |
| `prng.js` / `metrics.js` | keyed deterministic streams; rate/pooling/bb100 helpers (unit-tested against hand-computed values) |

**LLM experiment files:** the old narration-bearing pilot is preserved as history;
the new action-only work is isolated from it:

| File | Role |
|---|---|
| `PLAN.md` | historical Haiku pre-registration: frozen criteria, staircase, and final verdict |
| `OPENAI-PLAN.md` | current action-only Terra hypothesis, boundaries, build sequence, and status |
| `oracle.js` | cache-or-abort decision oracle + session replay (kept the engine synchronous) |
| `legality.js` | LLM action/amount normalizer + clamp accounting — also reused as the sizing gate's independent oracle |
| `prompt.js` | pure historical and action-only prompt builders, 5 persona profiles, spot renderer, default-deny card scan |
| `openai-decision.js` | pure Terra request builder, fail-closed response parser, and exact `ctx.legal` semantic validator; no live API path |
| `openai-probes.js` | nine hash-locked real Policy A contexts for development and provider smoke checks; excluded from humanness evidence |
| `openai-fixture-runner.js` | offline two-probe manifest and executor: exact approval fingerprint, immutable requests, fixed cap, one exclusive allowlisted journal, and no resume |
| `t-openai-fixture.js` | fake-provider, fsync, abrupt-exit, journal, and barrier-controlled competing-process proof for the Terra executor |
| `terra-state/` | ignored retained audit state for the one-time Terra smoke; never scratch, never delete after approval |
| `spend.js` / `run-pilot.js` | historical Haiku spend and billed runner; resumable semantics are not reused by the Terra path |
| `run-feel.js` | the original LLM-vs-coded blind packet (superseded by `run-ab.js` for engine-vs-engine work) |

Outputs land in `exp/out/` (gitignored scratch; also excluded from Vercel
deploys via `.vercelignore` along with all of `exp/`). This does not include the
retained `exp/terra-state/` journal. Frozen evidence lives in
tracked `exp/ref/`, in two kinds — don't conflate them:

- **Pre-humanize measurements** (engine 8f0bada and earlier): `baseline-metrics`,
  `probes-baseline`, `labels-baseline`, `baseline-transcripts`, `feel-key` (the
  packet it unlocks is regenerated, not stored — see below), and the LLM pilot's
  paid decision records.
- **Old-vs-new panel results** whose `new` arm is a humanize-arc commit:
  `feel-panel-ab1` (689911c), `ab2` (f0a157d), `bare` (a495960), `final` (4c4f544).
  Only `ab1` and `final` archived enough to re-derive their pair-by-pair results.

Either way it is history: fresh `exp/out/` results are EXPECTED to diverge as the
bots change — never "fix" that divergence, and never regenerate into `exp/ref/`.

⚠ **`pilot-api-pilot1.jsonl` cannot be recreated at any price** — it is the paid LLM
pilot (1005 decisions, ~$0.90) and the only record in which you can *see* a bot claim
a draw that isn't on the board, the hallucination finding that ended the LLM approach.
It is ~80% of `exp/`'s bytes and it is the evidentiary base for the project's largest
decision. Everything derived from it, however, IS reproducible and therefore is not
archived: the original blind packet rebuilds byte-identically with

```bash
node exp/run-feel.js --engine 8f0bada     # writes feel-packet.txt + key to exp/out/
```

The `--engine` flag is mandatory there and worth understanding: the pilot's cached
decisions were recorded against the pre-humanize ctx, so replaying them on today's
bots trips the oracle's divergence check — correctly. (An earlier note in this file
claimed the packet was unrecoverable; that was wrong, and the flag above is the fix.)

⚠ **Nothing enforces that but you.** No test, no ignore rule — and every runner
writes to `exp/out/` under the *same filename* as its `ref/` counterpart
(`probes-baseline.json`, `labels-baseline.json`, `baseline-metrics.json`,
`baseline-transcripts.txt`), so one careless copy overwrites archived evidence —
and the engine those numbers describe is gone from the working
tree. `ref/` is git-tracked, so `git checkout -- exp/ref/` recovers an uncommitted
clobber. The same directory holds every panel's answer key, which is why judges get
individual block files and never repo access.

`exp/t-exp.js` runs as part of `run-all.sh`, so if `poker-trainer.html`
drifts — a `Math.random` site added, a rewrite anchor renamed — the harness
fails loudly in the normal suite. The expected site count lives in ONE place:
the `EXPECTED_RAND_SITES` export in `exp-harness.js`. Re-audit the stream
assignment before changing it. `run-probes.js` and `run-labels.js` carry
hardcoded exploitability/readability locks (thresholds documented in-file
next to the measured values they were set against) and fail nonzero at the
frozen configs; both run in `run-all.sh`.
