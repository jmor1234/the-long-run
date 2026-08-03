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

The offline diagnostic gate is complete. `openai-decision.js` implements the pure
request boundary, strict wire parser, and semantic legality check against `ctx.legal`.
`openai-probes.js` freezes nine real Policy A decisions spanning all five personas,
heads-up play, postflop betting, closed raising, and a layered short-stack call. The
probe contexts and Policy A answers are hash-locked. They are development fixtures,
not evaluation evidence.

There is still no SDK, credential access, network call, retry, spend, persistence, or
fallback behavior. `t-exp.js` locks the request shape, structured-output schema,
historical prompt compatibility, prompt purity, semantic legality, and probe corpus.
`t3.js` proves the actor identity, table size, live-opponent count, and full public
action snapshot exactly match engine state at the decision hook. It also proves the
snapshot is detached and that no foreign private cards enter the context.

## Build sequence

1. **Offline diagnostic gate, complete.** Fair public observation, action-only prompt,
   Terra request contract, strict semantic validation, and nine frozen real spots.
   Historical Anthropic prefixes and schema remain hash-locked.
2. **Narrow fixture runner.** Exercise only the frozen spots through an injected fake
   transport first, then make the live transport available behind an explicit flag,
   credential check, hard call cap, and hard USD cap. Give each run an exclusive lease
   and identity fingerprint. Before egress, durably reserve the attempt's maximum cost.
   Disable provider retries. Persist the allowlisted request, response, usage, model,
   and terminal failure before accepting or caching a decision. An unresolved attempt
   is indeterminate and blocks automatic replay. Keep all records under ignored
   `exp/out/`. Check the current SDK contract, service tier, and pricing when this step
   is implemented.
3. **Tiny live smoke.** This requires explicit owner approval after the fixture runner
   and its High-tier verification are complete. Use only the frozen development spots.
   Its purpose is to validate the provider contract, persistence, real usage, latency,
   and caps. These burned spots never count toward a humanness result.
4. **Full oracle session runner, conditional.** Build the cache-or-abort replay path
   only if the smoke passes. Provider, parse, and legality failures remain terminal
   recorded outcomes, never silent fallbacks.
5. **Pre-register the comparison.** Compare Terra with a fresh run of the current
   Policy A on the same engine, seeds, and public observations. Freeze volume, cost
   ceiling, legality and fairness gates, persona/readability bounds, exploitability
   floor, and blind action-only judging before collecting comparison data.
6. **Run only the cheapest decisive stage.** Stop on a failed gate. Do not integrate
   an LLM into the browser unless the offline experiment first shows a meaningful,
   repeatable improvement in observed play.

## What would count as success

The target is believable human play, not stronger or more optimal poker. A viable arm
must preserve the existing fairness and chip-conservation guarantees, stay within the
pre-registered legality, persona, readability, and exploitability bounds, and win a
blind action-only comparison on shared deals. Latency, availability, and cost remain
product constraints even if the behavioral result is positive.
