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
- Input: the acting bot's existing `ctx` projection only. No game state object, hero
  cards, or other bots' cards can enter the prompt.
- Output: strict JSON with exactly `action` and `amount`. `amount` is a bet-to total
  for bet or raise and `null` otherwise.
- Failure: malformed, refused, incomplete, or ambiguous output produces no decision.
  A later runner must record and handle that failure explicitly. The parser never
  invents a poker action.
- Legality: the current engine's `ctx.legal` descriptor is authoritative. The older
  `exp/legality.js` adapter describes historical engines and is not sufficient for a
  new live arm by itself.
- Execution: keep the engine synchronous. Use the existing cache-or-abort oracle so
  an external decision is resolved between deterministic replays, not during a hand.

`openai-decision.js` currently implements only the pure request and response boundary.
It has no SDK, credential access, network call, retry, spend, or fallback behavior.
`t-exp.js` locks the request shape, structured-output schema, historical prompt
compatibility, prompt purity, and fail-closed parsing.

## Build sequence

1. **Offline boundary, complete.** Action-only prompt, Terra request contract, strict
   parser, and independent fixtures. Historical Anthropic prefixes and schema are
   hash-locked so this work cannot rewrite their archived contract.
2. **Guarded runner.** Add the OpenAI SDK path behind an explicit live flag. Before
   any call, reserve its worst-case cost under a hard run budget; disable SDK retries
   or include every retry in that reservation. Persist the request context, response,
   usage, model, and failure before caching the decision. Add an offline stub that
   exercises the full runner without credentials or network.
3. **Tiny live smoke.** Requires explicit owner approval after the runner and its
   High-tier verification are complete. Its purpose is contract, latency, cache, and
   real usage validation, not a humanness verdict.
4. **Pre-register the comparison.** Freeze volume, cost ceiling, seeds, legality and
   fairness gates, persona/readability bounds, exploitability floor, and blind
   action-only judging rule before collecting the comparison data.
5. **Run only the cheapest decisive stage.** Stop on a failed gate. Do not integrate
   an LLM into the browser unless the offline experiment first shows a meaningful,
   repeatable improvement in observed play.

## What would count as success

The target is believable human play, not stronger or more optimal poker. A viable arm
must preserve the existing fairness and chip-conservation guarantees, stay within the
pre-registered legality, persona, readability, and exploitability bounds, and win a
blind action-only comparison on shared deals. Latency, availability, and cost remain
product constraints even if the behavioral result is positive.
