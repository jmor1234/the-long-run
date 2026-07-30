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
- 16 independent LLM judges, TWO per block, each judge sees exactly ONE block
  in isolation. **Standing judge model: claude-opus-5, medium effort** (since
  2026-07-30); earlier rounds used a different model — see the history table,
  and keep the model constant within a run. Judges are never told an experiment exists, which arm
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

## The action-only judge prompt (verbatim; use with `run-ab.js --action-only`)

Identical to the above except the file is an action log with no bracketed
reasoning, and the question is about play rather than voice:

> Read the file <path>/block-${letter}.txt — it contains 30 consecutive hands
> of a 6-max no-limit hold'em home game (blinds 1/2), as an action log. One
> seat ("You") is a player sitting out, folding everything — ignore that seat
> entirely.
>
> Question: do the FIVE OPPONENTS at this table PLAY like real recreational
> human poker players, or like scripted algorithms? Consider whatever you'd
> naturally weigh — how their lines flow hand to hand, sizing habits, who gets
> stubborn or backs off, whether their tendencies drift over the session,
> whether different players feel like genuinely different people.
>
> Judge only from this transcript. Give your gut read as a verdict, a 0-10
> humanness score, confidence, and a short rationale.

**Scores from the two prompts are not comparable** — the same engine scores
~3.0 on full transcripts and ~3.0-3.1 on action-only, but the old engine
scores 1.0-1.25 and 2.13 respectively. Always compare within a format.

## Baseline (2026-07-30, verdicts in feel-panel-baseline.json)

The transcript blocks these judges read are not archived — they rebuild
byte-identically with `node exp/run-feel.js --engine 8f0bada` (verified).
`feel-key.json` is kept so the verdicts stay interpretable without doing that.

- Coded bots (@ 8f0bada engine, identical to dc0938f here): humanness 1-1.5/10, 8/8 verdicts mechanical.
- LLM pilot bots: 3-3.5/10, 8/8 mechanical (plus hallucinated reasoning).
- The four converged tells (uniform sizing / flawless discipline / one
  templated voice / no arc) are the reference list for the "no original tell
  in >= half of new-arm blocks" criterion.

## Frozen bar for the humanize increment (plan v3)

New-arm mean >= 5.0 AND no single original tell cited by judges in >= half
of new-arm blocks. Secondary signal: majority of shared-seed pairs new > old.

## Instrument history (scores comparable only within a row)

| run | judges | format | old | new |
|---|---|---|---|---|
| baseline + LLM exp (2026-07-30) | fable | full transcript | 1.0-1.5 | LLM arm 3-3.5 |
| humanize round 1 (feelab1) | fable | full transcript | 1.0 | 2.6 |
| humanize round 2 (feelab2) | fable | full transcript | 1.25 | 3.0 |
| bare round (feelab3) | fable | action-only | 2.88 | 3.13 |
| FINAL (feelab4) | opus-5 medium | action-only | 2.13 | 3.00 |

Judge model changed to claude-opus-5 medium (owner directive, 2026-07-30);
all future panels use opus-5 medium. Caveat on feelab1-3: those rounds ran
with a say()-shadowing bug (found post-hoc, fixed at 1531453) that halved
variant diversity and disabled sentence capitalization — their new-arm
scores understate the fixed voice. The 5.0 bar was never met on the
transcript instrument and is recorded as unmet — the surviving tells
(verbatim bank repetition, exhaustive narration) are format properties the
in-game player never experiences; on action-only play the new engine leads
3.00 vs 2.13. Across the four rounds 15 of 16 shared-seed pairs improved; the one regression
was in the action-only Fable round (feelab3). Pair-level detail is re-derivable
only for feelab1 and feelab4 — ab2 and bare archived arm means only.
