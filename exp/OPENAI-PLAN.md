# Action-only LLM poker experiment

## Question

Can an LLM make poker decisions that feel more like a real recreational player than
the coded policy, while the game remains fair, legal, testable, and affordable?

This is not a rerun of the 2026-07-30 Haiku experiment. That experiment asked the
model to choose an action and narrate why. It improved perceived humanness slightly,
but fabricated poker facts in its reasons. The new hypothesis removes narration
entirely. The model supplies only a decision. The engine remains the authority on
cards, rules, state, and any player-facing explanation.

The shipped game is unchanged. Its default remains the coded Policy A.

## Boundary

- Model: `gpt-5.6-terra`, Responses API, low reasoning effort.
- Input: the acting bot's `ctx` projection only. It contains that bot's cards and the
  public information available to a player, including the exact visible action line.
  No game state object, hero cards, or other bots' cards can enter the prompt.
- Output: strict JSON with exactly `action` and `amount`. `amount` is a bet-to total
  for bet or raise and `null` otherwise.
- Failure: malformed, refused, incomplete, ambiguous, or context-illegal output
  produces no decision. A later runner must record and handle that failure explicitly.
  The parser never invents, clamps, relabels, or falls back to a poker action.
- Legality: the current engine's `ctx.legal` descriptor is authoritative. The older
  `exp/legality.js` adapter describes historical engines and is not sufficient for a
  new live arm by itself.
- Execution: keep the engine synchronous. Use the existing cache-or-abort oracle so
  an external decision is resolved between deterministic replays, not during a hand.

The offline diagnostic gate and offline fixture executor are complete.
`openai-decision.js` implements the pure request boundary, strict wire parser, and
semantic legality check against `ctx.legal`. `openai-probes.js` freezes nine real
Policy A decisions spanning all five personas, heads-up play, postflop betting, closed
raising, and a layered short-stack call. The probe contexts and Policy A answers are
hash-locked. They are development fixtures, not evaluation evidence.

`openai-fixture-runner.js` narrows the future provider smoke to two of those burned
spots. One immutable manifest fixes their request hashes, Terra, the official endpoint,
standard service tier, two-call ceiling, and $0.05 maximum. An exact fingerprint must
be approved before the executor creates output. The executor then owns one exclusive
append-only journal under `exp/terra-state/`. Each record is fsynced before the next
external boundary. A completed, failed, or interrupted identity cannot be resumed or
repeated automatically while that journal claim exists. Persisted provider data is an
explicit allowlist. `t-openai-fixture.js` proves these properties with fake responses,
six abrupt child-process exits, and a barrier-controlled two-process race.

The process-crash proof does not claim that a newly created directory entry survives
host power loss on every filesystem. A power loss after approval is indeterminate and
must never trigger an automatic retry. The owner must first reconcile the journal and
provider usage before deciding whether any further call is acceptable.

There is still no OpenAI SDK, credential access, network call, provider retry, live
spend, cache, gameplay path, or fallback behavior. The older `run-pilot.js`,
`spend.js`, and `legality.js` implement the concluded Haiku experiment and are not
authoritative for this Terra path. `t-exp.js` locks the request shape,
structured-output schema, historical prompt compatibility, prompt purity, semantic
legality, and probe corpus. `t3.js` proves the fair observation boundary at the
engine decision hook.

## Build sequence

1. **Offline diagnostic gate, complete.** Fair public observation, action-only prompt,
   Terra request contract, strict semantic validation, and nine frozen real spots.
   Historical Anthropic prefixes and schema remain hash-locked.
2. **Offline fixture executor, complete.** It runs exactly two frozen spots through an
   injected transport, reserves the whole run below $0.05, freezes the approved request,
   and proves exclusive, non-resumable journal semantics without credentials or egress.
3. **Thin live adapter.** Check the current official SDK, Responses API contract,
   service-tier behavior, and pricing again before implementation. The adapter may only
   read the API key, call the official endpoint with retries disabled, and return the
   raw response to the verified executor. Reject endpoint overrides. It must not own
   policy, persistence, resumption, caching, or gameplay.
4. **Tiny live smoke.** This requires explicit owner approval of the exact manifest
   fingerprint after the adapter and its High-tier verification are complete. Use only
   the two burned development spots, at most two calls and $0.05. Its purpose is to
   validate the real provider envelope, model and tier identity, usage, latency, and
   journal. It does not test humanness.
5. **Full oracle session runner, conditional.** Build the cache-or-abort replay path
   only if the smoke passes. Provider, parse, and legality failures remain terminal
   recorded outcomes, never silent fallbacks.
6. **Pre-register the comparison.** Compare Terra with a fresh run of the current
   Policy A on the same engine, seeds, and public observations. Freeze volume, cost
   ceiling, legality and fairness gates, persona/readability bounds, exploitability
   floor, and blind action-only judging before collecting comparison data.
7. **Run only the cheapest decisive stage.** Stop on a failed gate. Do not integrate
   an LLM into the browser unless the offline experiment first shows a meaningful,
   repeatable improvement in observed play.

## What would count as success

The target is believable human play, not stronger or more optimal poker. A viable arm
must preserve the existing fairness and chip-conservation guarantees, stay within the
pre-registered legality, persona, readability, and exploitability bounds, and win a
blind action-only comparison on shared deals. Latency, availability, and cost remain
product constraints even if the behavioral result is positive.
