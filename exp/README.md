# exp/ — LLM-bots experiment (offline)

An experiment testing whether LLM-persona bots simulate human poker behavior better
than the coded frequency policies in `poker-trainer.html`. **The shipped app and its
test suite are untouched** — everything here is a parallel harness build.

Plan with pre-registered pass criteria: see the session plan doc
(`llm-bots-experiment-plan.md`, currently in the working scratchpad; lands here when
the experiment runs). Independent assessment findings are folded in; key design calls:

- **No async engine.** `botDecide` stays synchronous. LLM arms use a decision oracle
  (`oracle.js`): cache hit → return; miss → record prompt, abort session, resolve the
  decision outside the engine, replay from seed. Replays reproduce identical ctx
  (verified on every cache hit — divergence throws).
- **Keyed RNG streams** (`prng.js`, wired in `exp-harness.js`): deck/button per hand
  index, policy rolls + equity Monte Carlo per (hand, decision). Deals are identical
  across arms at the same seed (duplicate-poker variance reduction); draws outside the
  expected windows are counted and must be zero.
- **Legality normalizer** (`legality.js`) runs before `applyAction` for LLM arms —
  the engine accepts `check` facing a bet and would loop forever. Every coercion is
  counted; raw illegality is a pre-registered metric.

| File | Role |
|---|---|
| `exp-harness.js` | harness.js variant: RNG injection, stream switching, decision hook; every source rewrite asserted |
| `prng.js` | keyed deterministic streams (fnv1a + mulberry32) |
| `oracle.js` | cache-or-abort oracle + session replay loop |
| `legality.js` | LLM action/amount normalizer, clamp accounting |
| `run-baseline.js` | coded-bots arm through the metrics pipeline (persona frequency bands, split-half, transcripts) |
| `t-exp.js` | step-1 gate: determinism, cross-arm deal identity, oracle replay, legality (`node exp/t-exp.js`) |

Outputs land in `exp/out/` (gitignored). If `poker-trainer.html`'s `Math.random`
call sites change, `exp-harness.js` fails loudly (expects exactly 5) — re-audit the
stream assignment before bumping the count.
