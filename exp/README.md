# exp/ — LLM-bots experiment (offline)

An experiment testing whether LLM-persona bots simulate human poker behavior better
than the coded frequency policies in `poker-trainer.html`. **The shipped app and its
test suite are untouched** — everything here is a parallel harness build.

Plan with FROZEN pre-registered pass criteria and baseline reference numbers:
[PLAN.md](PLAN.md). Independent assessment findings are folded in; key design calls:

- **No async engine.** `botDecide` stays synchronous. LLM arms use a decision oracle
  (`oracle.js`): cache hit → return; miss → record prompt, abort session, resolve the
  decision outside the engine, replay from seed. Replays reproduce identical ctx
  (verified on every cache hit — divergence throws). Cache keys are scoped by seed so
  a cache shared across runs can never serve another session's decision.
- **ctx is extended in exp builds only** with three public betting-state fields
  (`currentBet`, `minRaise`, `myBet`) that the legality view needs. Shipped ctx is
  unchanged; the extension carries no hidden information.
- **Keyed RNG streams** (`prng.js`, wired in `exp-harness.js`): deck/button per hand
  index, policy rolls + equity Monte Carlo per (hand, decision). Deals are identical
  across arms at the same seed (duplicate-poker variance reduction); draws outside the
  expected windows are counted and must be zero.
- **Legality normalizer** (`legality.js`) runs before `applyAction` for LLM arms —
  the engine accepts `check` facing a bet and would loop forever (the harness `drain`
  throws at its step cap rather than truncating silently). Every coercion is counted;
  raw illegality is a pre-registered metric, with verb-only relabels (bet↔raise)
  counted separately and excluded from it.

| File | Role |
|---|---|
| `exp-harness.js` | harness.js variant: RNG injection, stream switching, decision hook; every source rewrite asserted |
| `prng.js` | keyed deterministic streams (fnv1a + mulberry32) |
| `oracle.js` | cache-or-abort oracle + session replay loop |
| `legality.js` | LLM action/amount normalizer, clamp accounting |
| `run-baseline.js` | coded-bots arm through the metrics pipeline (persona frequency bands, pooled split-half, transcripts) |
| `run-probes.js` | degenerate-hero exploitability probes (criterion-3 reference numbers, per-session audit detail) |
| `run-labels.js` | dossier-label rates at hand 31 with the frozen mapping (criterion-4 reference numbers) |
| `metrics.js` | shared rate/pooling/bb100 helpers, unit-tested against hand-computed values |
| `prompt.js` | pure prompt builder: shared rules + 5 persona prefixes (cache-sized), spot renderer, default-deny card scan, output schema |
| `spend.js` | hard MAX_CALLS / MAX_USD guard + Haiku 4.5 cost math (unit-tested) |
| `run-pilot.js` | step-3 LLM arm: oracle -> buildPrompt -> Haiku 4.5 (cached prefixes, structured output) -> legality -> persisted JSONL. Billing is opt-in (`--live`; a bare invocation errors), `--stub` runs the whole pipeline offline against a fake client that pins the live request shape. Every decision is appended to disk before it enters the cache, so a cap abort or crash resumes without re-spending; stub and api records live in per-mode files and a config header rejects mismatched resumes |
| `PLAN.md` | frozen pre-registered criteria + baseline reference numbers |
| `t-exp.js` | gate suite: determinism, cross-arm deal identity, oracle replay, legality (unit + engine-integration), prompt purity/scan |

Outputs land in `exp/out/` (gitignored scratch; also excluded from Vercel
deploys via `.vercelignore` along with all of `exp/`). Frozen reference
evidence lives in tracked `exp/ref/` — baseline metrics/probes/labels, the
blind feel packet + key + panel verdicts, the pilot's paid decision records,
and the frozen panel instrument (`feel-panel.md`). All of it was measured on
the PRE-HUMANIZE engine (8f0bada and earlier): it is preserved history, so
fresh `exp/out/` results are EXPECTED to diverge from it as the bots change —
never "fix" that divergence, and never regenerate into `exp/ref/`.

`exp/t-exp.js` runs as part of `run-all.sh`, so if `poker-trainer.html`
drifts — a `Math.random` site added, a rewrite anchor renamed — the harness
fails loudly in the normal suite. The expected site count lives in ONE place:
the `EXPECTED_RAND_SITES` export in `exp-harness.js`. Re-audit the stream
assignment before changing it. `run-probes.js` and `run-labels.js` carry
hardcoded exploitability/readability locks (thresholds documented in-file
next to the measured values they were set against) and fail nonzero at the
frozen configs; both run in `run-all.sh`.
