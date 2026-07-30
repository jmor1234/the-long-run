# LLM-bots experiment — plan and PRE-REGISTERED criteria

Goal: settle with data whether LLM-persona bots (Haiku 4.5, persona prompts) simulate
human poker behavior better than the coded frequency policies, without touching the
shipped app. Architecture and file map: [README.md](README.md). Design history: v1
plan was independently assessed (assess-plan, 2026-07-29); the oracle+replay design,
gated staircase, and these relative criteria came out of that triage.

**The numbers below were measured from the coded-baseline arm and FROZEN before any
LLM call is made. They do not move. An LLM arm passes only if ALL of criteria 1–5
hold; criterion 6 is the product judgment on top.**

## Baseline reference numbers (frozen 2026-07-29)

Baseline volume: 40 sessions x 150 hands, seed `exp1`, check-fold hero
(`exp/out/baseline-metrics.json`). Pooled rates:

| persona   | VPIP | PFR  | F2bet | 3bet | AF   | split-half Δ (vpip/pfr/f2bet) |
|-----------|------|------|-------|------|------|-------------------------------|
| nit       | .194 | .163 | .738  | .026 | 0.97 | .029 / .040 / .013 |
| solid     | .314 | .256 | .615  | .043 | 1.25 | .043 / .041 / .010 |
| maniac    | .438 | .345 | .494  | .077 | 1.80 | .128 / .135 / .096 |
| selective | .266 | .206 | .656  | .040 | 1.27 | .073 / .081 / .069 |
| station   | .444 | .239 | .488  | .034 | 0.74 | .088 / .098 / .057 |

(The larger maniac/station deltas are real table-shortening drift — ranges widen as
bots bust — which affects every arm identically under shared seeds. AF is excluded
from convergence criteria: its small denominators are unstable even pooled.)

Exploitability probes: 30 sessions x ≤200 hands each, seed `probe1`, no rebuys
(`exp/out/probes-baseline.json`): always-raise **−992**, call-station **−898**,
3bet-preflop **−612**, check-fold **−33** bb/100.

Dossier labels at hand 31, 30 sessions, seed `label1` (correct% / contradiction%):
nit 73/3, solid 43/10, maniac 33/20, selective 70/0, station 33/23 — reproducible on
the ORIGINAL engine via `node exp/run-labels.js --sessions 30 --html <8f0bada build>
--sites 5` (the script's default later moved to 90 sessions when the readability
lock was re-instrumented; see the comment in run-labels.js).
Label mapping (fragment sets, fixed):
correct — nit {tight, folds often}; solid {folds often}; maniac {loose, 3-bets light,
aggressive, sticky}; selective {tight, folds often, aggressive}; station {loose,
sticky, passive pre, calls c-bets, 3-bets rare}.
contradiction — nit {loose, sticky, 3-bets light, aggressive}; solid {tight, loose};
maniac {tight, folds often}; selective {loose, sticky, passive}; station {tight,
folds often}. "(none)" is neither. Any-contradicting-fragment counts as contradiction.

## Pass criteria

1. **Legality.** Raw illegality (non-cosmetic clamps in `legality.js`; verb relabels
   excluded) < **0.5%** of decisions. No retries — clamp-only.
2. **Persona fidelity and convergence** (pooled over a volume run with the same
   config: 40x150, matched seeds):
   a. VPIP within **±0.06** and F2bet within **±0.08** of each persona's baseline
      pooled value.
   b. Identity ordering: VPIP — nit < selective < solid < min(maniac, station);
      F2bet — nit highest, station lowest, nit−station ≥ **0.15**;
      AF(maniac) − AF(station) ≥ **0.5**.
   c. Convergence: pooled split-half delta ≤ baseline delta + **0.05**, per persona,
      for VPIP, PFR, F2bet.
3. **Non-exploitability** (same probe config/seeds): always-raise, call-station, and
   3bet-preflop each lose ≥ **300 bb/100** against the LLM table; check-fold stays
   ≤ **−15 bb/100**. LLM-arm cost note: the busting probes are cheap (~250–350 hands
   each), but check-fold survives ~6,000 hands at full config — for the LLM arm it
   runs capped at **10 sessions × 100 hands** (a blind-bleed rate converges long
   before that), and the criterion applies to that capped run.
4. **Reads validity** (30 sessions to hand 31, frozen mapping above): per persona,
   correct-label rate ≥ baseline − **10pp** AND contradiction rate ≤ baseline + **10pp**.
5. **Fairness.** The load-bearing guarantee is structural: ctx carries only the
   acting bot's own cards (t3-verified) and `buildPrompt` is a pure function of ctx
   (strict mode; determinism, no-mutation, and order-independence tested against
   real decisions) — so no hero or opponent hole cards can leave the machine. The
   in-`buildPrompt` card scan is a prose-drift TRIPWIRE, not the proof (it cannot
   fail while the spot derives only from ctx — which is the property it pins).
   Criterion: purity tests stay green AND zero tripwire failures across 100% of
   decisions.
6. **Feel (the product question).** Blind protocol, fixed before viewing: 30-hand
   transcript blocks per arm, unlabeled, shuffled; the owner marks each block
   human/mechanical before seeing any metrics. The LLM arm must win a strict
   majority of paired comparisons. Run only if 1–5 pass; live-play A/B is the
   confirmation step, not the primary.

**Design decision (stated, not hidden):** the persona cards tell each bot its
approximate target rates in plain language ("you play about a third of your hands").
Criterion 2 therefore tests *embodiment* — whether the model can consistently live a
stated identity across thousands of independent decisions (bands + convergence +
ordering) — not blind discovery of rates it was never told. A model cannot pass 2b/2c
by parroting a number; a human told "play 40% of hands" still can't do it without
skill. Persona text was audited against the frozen bands for internal consistency
(maniac range aligned; selective fold-direction corrected) so an obedient model is
never *penalized* by its own instructions.

Documented losses regardless of outcome: stated-reason-as-cause becomes narrative;
offline play; free instant regression testing; sustained outbound API traffic.

## Staircase (remaining)

- **Step 3 — pilot** (needs API key + owner go-ahead, hard cap **$5**): ~150–200
  hands, Variant A only, live API, bounded concurrency, per-persona cached prefixes
  (warm-first). Measures: raw illegality, scan failures, real tokens/decision,
  `cache_read_input_tokens` (zero reads = a silent invalidator = pilot failure),
  $/hand, latency. Gate: criteria 1 & 5 must not already fail; volume budget is
  recomputed from measured cost and re-approved.
- **Step 4 — transcript feel pilot** (near-free): early read on criterion 6 from
  pilot transcripts vs baseline transcripts. Can stop the experiment before volume.
  AMENDED 2026-07-30: the owner declined to judge (too early in their poker
  journey) and directed a blind LLM panel instead — two independent judges per
  block, each seeing one block in isolation with no knowledge of the experiment
  or that any block is model-generated (`run-feel.js` packet, 4 paired 30-hand
  blocks, shared cards per pair). Scored per the frozen rule on binary verdicts,
  plus paired humanness scores as a sensitivity read. The formal criterion-6
  judge, if steps 1-5 pass, remains an open design question (owner or panel).
- **Step 5 — volume run** (Variant A): only for criteria still open.
- **Step 6 — Variant B** (distribution-elicited): ONLY if A fails criterion 2.
  Sonnet 5 arm: ONLY if results are ambiguous.
- **Step 7 — live-play shim**: ONLY if 1–5 pass. First async decision path; ships
  with a re-derived async-safe fairness trap plus a negative test (mid-await peek
  must trip) before any session is trusted.

## Spend controls

Runner enforces hard MAX_CALLS / MAX_USD aborts (unit-tested; the USD cap is
stop-after-crossing, so the overshoot is bounded by one call's cost); billing is
opt-in via `--live`; API key from environment only; `exp/out/` gitignored and
Vercel-ignored; per-decision prompts/responses/seeds persisted so results are
recomputable without re-spending.

## Status — EXPERIMENT CONCLUDED (2026-07-30)

- Steps 1–3 ran as registered. The pilot ($0.90, 150 hands, 1005 decisions)
  PASSED criteria 1 and 5 (0.10% illegality; zero fairness tripwires; cache
  economics as designed — evidence in `exp/ref/pilot-api-pilot1.jsonl`).
- Step 4 (blind feel, amended to an LLM panel — see the amendment above)
  ENDED the staircase: LLM bots scored 3-3.5/10 vs coded 1-1.5/10, ALL 16
  verdicts mechanical, 0/4 pairs won under the frozen rule — and the judges'
  top tell was hallucinated reasoning (draws not on the board, "checking"
  while betting). For a trainer whose reasons are curriculum, that is
  disqualifying independent of the score. Steps 5-7 never ran; no further
  spend.
- VERDICT on the original question: LLM persona bots are marginally more
  human-feeling and categorically still bots, and they buy the margin with
  fabricated narration. The fix went into the CODED bots instead (the
  "humanize" arc: sizing spread, soft boundaries, voice banks, mood, table
  texture — see ARCHITECTURE §12 and `exp/ref/humanness-*.md` for the
  root-cause dossier and three-design synthesis). Measured trajectory on
  this panel instrument: coded bots 1.0 → 3.0 (full transcripts, Fable
  judges), 2.13 vs 3.00 old-vs-new (action-only, opus-5-medium judges,
  `exp/ref/feel-panel-final.json`). The 5.0 transcript bar was NOT met and
  is recorded as unmet: the residual tells are properties of the
  narrate-every-decision transcript format (finite phrase banks repeat;
  humans don't narrate at all), which the in-game player never sees.
- Reusable assets this experiment left behind: the seeded cross-version A/B
  harness (`exp-harness.js` htmlPath), the blind-panel instrument
  (`ref/feel-panel.md`), exploitability + readability locks in `run-all.sh`,
  and the archived evidence in `exp/ref/`.
