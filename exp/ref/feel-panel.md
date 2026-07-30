# Blind feel panel — frozen instrument

The humanness measurement used for the LLM experiment's step-4 read
(2026-07-30) and for all future A/B re-measures. Frozen here so every run is
comparable; any change to the prompt or protocol makes scores incomparable
and must be called a new instrument.

## CONTAMINATION WARNING

This directory contains the unblinding key (feel-key.json) and all prior
verdicts. A judge must NEVER be given repository access — hand each judge
ONLY its one extracted block file, exactly as the baseline run did. Any
judge that has seen this repo is burned for scoring purposes.

## Protocol

- Transcript blocks of 30 consecutive hands, one table, hero sitting out
  (check-fold). Blocks generated at shared deal seeds across arms (cards
  identical per pair until decisions diverge the roster — pairs are a
  preference signal, not matched pairs).
- 16 independent LLM judges (claude-opus-5, medium effort at the baseline
  run; keep constant per run), TWO per block, each judge sees exactly ONE
  block in isolation. Judges are never told an experiment exists, which arm
  is which, or that any content is model-generated.
- Structured verdict per judge: verdict human|mechanical, humanness 0-10,
  confidence low|medium|high, 2-4 sentence rationale.

## The judge prompt (verbatim template; ${letter} = block file)

> You are judging a poker hand-history transcript.
>
> Read the file <path>/block-${letter}.txt — it contains 30 consecutive hands
> of a 6-max no-limit hold'em home game (blinds 1/2). One seat ("You") is a
> player sitting out, folding everything — ignore that seat entirely. Each
> hand shows the action log followed by each opponent's stated reasoning in
> [brackets].
>
> Question: do the FIVE OPPONENTS at this table read like real recreational
> human poker players, or like scripted algorithms? Consider whatever you'd
> naturally weigh — how their lines flow, whether their choices and stated
> reasoning feel like people (with moods, inconsistency, table-awareness,
> occasional bad logic) or like rule-followers; whether different players
> feel like genuinely different people.
>
> Judge only from this transcript. Give your gut read as a verdict, a 0-10
> humanness score, confidence, and a short rationale.

## Baseline (2026-07-30, verdicts in feel-panel-baseline.json)

- Coded bots (@ dc0938f engine): humanness 1-1.5/10, 8/8 verdicts mechanical.
- LLM pilot bots: 3-3.5/10, 8/8 mechanical (plus hallucinated reasoning).
- The four converged tells (uniform sizing / flawless discipline / one
  templated voice / no arc) are the reference list for the "no original tell
  in >= half of new-arm blocks" criterion.

## Frozen bar for the humanize increment (plan v3)

New-arm mean >= 5.0 AND no single original tell cited by judges in >= half
of new-arm blocks. Secondary signal: majority of shared-seed pairs new > old.
