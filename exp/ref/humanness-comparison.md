# Three designs for humanizing the poker bots — decision brief

All three share a diagnosis and roughly two-thirds of a solution. The real choice is narrower than the documents make it look: **where personality lives, how much of the fairness/verification apparatus you are willing to modify, and how strict the acceptance bar should be.**

---

## 1. Consensus core

Mechanisms all three designs propose, in substantially the same form. If you adopted only this, you would have a coherent build.

| # | Mechanism | Agreement level |
|---|---|---|
| C1 | **Same root-cause diagnosis**: three missing dimensions (sizing, error, time) plus reason-text welded to control flow. All four judge tells are treated as symptoms, not four independent bugs. | Unanimous, near-verbatim |
| C2 | **Kill both sizing collapse points**: delete the `Math.max(6, …)` floor at line 737; raise policy 3-bet sizes above the legal minimum so `applyAction`'s clamp at 1099 stops being the de facto sizer and reverts to a legality backstop. | Unanimous |
| C3 | **One sizing helper**: base × persona factor × uniform jitter → snap to a granularity that coarsens as the number grows → clamp to `[2, stack]`. (`humanSize` / `chipRound`.) | Unanimous; near-identical granularity ladders |
| C4 | **Soft postflop call/fold boundary**: replace the step function at 816-822 with a logistic on `margin = effective − need − edgeNeed`, per-persona temperature. All three call this the single highest-value change, because bad calls are currently impossible *by construction*, not by tuning. | Unanimous |
| C5 | **Decorrelate the RNG**: stop reusing the single `roll` from line 725; independent draws for branch, size, and phrasing. | Unanimous |
| C6 | **Every persona limps**; the unconditional fold at line 772 gets a small gated curiosity-call path. | Unanimous |
| C7 | **One decaying per-seat mood scalar**, written in `endHand` from public chip swings only, decay 0.72–0.78 (≈3-hand half-life), collapsed into a loosen multiplier and an aggression multiplier applied at existing sites. | Unanimous, including the decay constant |
| C8 | **One grudge/nemesis slot**, not a matrix; decays per hand; scoped at the call site to the current aggressor so `botDecide` never sees seat indices. | Unanimous |
| C9 | **Persona-keyed phrase bank** replacing the 18 inline literals; slot-filling only, no generation; truthfulness enforced *structurally* (a draw-claiming template is unreachable without a draw). First person; chips and board texture instead of internal percentages. | Unanimous |
| C10 | **Hard text bans enforced by a new automated check**: no `roll`, no branch names, no raw read counters, no percentage narrating a 0%-probability event. | Unanimous (A folds it into `audit.js`; B/C add a file) |
| C11 | **Reads spoken through confidence tiers** (`unknown` / `lean` / `solid`), replacing the frozen `note` string, so a 5-sample read and a 200-sample read stop sounding identical. | Unanimous |
| C12 | **Latency keyed to decision closeness** — and all three explicitly state it closes **zero** judged tells (transcripts have no timing) and should be cut first. | Unanimous, including the self-deprecation |
| C13 | **Shared refusals**: no LLM in decision or narration; no Tracery grammar; no Perlin noise; no N×N grudge matrix; no mid-session style mutation; no showdown-derived state; no localStorage; no second decision system. | Unanimous |
| C14 | **Shared verification spine**: `run-all.sh` clean → `t3.js` mandatory because ctx changed → bump `exp-harness.js`'s 5-`Math.random()`-site assertion and re-audit stream assignment → exploit probes must still lose badly → paired same-seed A/B blind panel, 16 judges, one 30-hand block each in isolation, bar pre-registered before looking. | Unanimous |

Two consensus points are worth flagging because they are *load-bearing agreements against an obvious temptation*:

- **All three refuse to weaken `READS_PRIOR`/`READS_MIN_HANDS` globally.** The shrinkage is anti-fake-certainty design shared with the UI dossiers. Mood supplies the arc instead. (C carves an exception — see D4.)
- **All three refuse per-persona bespoke branches.** Every persona difference must be a parameter or a bank index, per the frequencies-not-rules doctrine.

---

## 2. Genuine disagreements

Ordered by how much rides on the answer.

### D1 — Where does personality live: archetype dials, or per-seat DNA?
- **A and C**: add named dials to the five shared, frozen `BOT_STYLES` entries. A explicitly *refuses* a per-seat trait vector: "five more dials that no judge could attribute to a specific bot inside 30 hands."
- **B**: replaces the frozen archetype reference with `makeSeat(arch, rnd)` — ±12% jitter on existing dials plus ~11 new named traits drawn once per session (`sizeBase`, `sizeNoise`, `sizeTell`, `oddSize`, `edge`, `temp`, `chase`, `tilt`, `patience`, `voice`). B's argument is that the uniformity tell *is* "two bots of the same persona are the same bot."

**What hinges on it:** whether readable, fixed, learnable seat archetypes (the trainer's actual curriculum) are more valuable than individuation. Also testability — B's realized rates become distribution-valued across seeds, so PLAN.md's frozen ±0.06 VPIP bands stop being expressible as point bands. B keeps §12 intact by separating identity (traits, fixed) from state (mood, drifts), which is a clean answer, but it is a new concept in the model.

### D2 — Is boundary softness enough, or do errors need to be *correlated within a hand*?
- **A**: soft boundary only. Errors are independent per decision.
- **B**: soft boundary plus trait-level `edge`/`chase`/`temp`, and argues mood makes errors arrive in *clusters* with a visible cause, which pure noise cannot imitate.
- **C**: adds `style.misread` applied to strength `s` *before* bucketing, so bucket, bet frequency, sizing, and the call boundary all err together — "a bot that misjudges a hand plays it wrongly and consistently wrongly."

**What hinges on it:** whether a judge reading a transcript distinguishes "dice" from "judgment." C's mechanism is the strongest answer and also the only one that lets a bot hold a **false belief about its own hand** and state it out loud. C handles this by quoting `sHat` so the reason stays truthful *to the decision*. That is defensible and arguably the most human thing in any of the three designs, but it is a new category under the truthful-reasons constraint and deserves an explicit ruling rather than being absorbed as a detail.

### D3 — May mood move the premium threshold `thr`?
- **A**: deliberately not. "Widening the threshold would also corrupt what counts as premium."
- **B**: `thr *= (1 + 1.6*looseAdd)`.
- **C**: `thr *= 1 + 0.35*steam*tilt + min(0.30, 0.035*cold)`.

**What hinges on it:** one line of code, and whether the trainer's teachable notion of a premium range must stay stable while the bot's *willingness* drifts. A is alone here and states the reason crisply; B and C treat range-widening as the primary observable of tilt. This is the sharpest small conflict in the set.

### D4 — One prior, or two?
- **A, B**: leave `facingNudge` coefficients and the prior alone; mood carries the arc.
- **C**: roughly double the vpip/foldToBet coefficients and use `READS_PRIOR = 12` for the nudge path only, leaving 20 for the dossier and its confidence tiers.

**What hinges on it:** whether "the bot's gut is looser than what the UI is willing to display" is honest design or a fig leaf that reintroduces the fake certainty the rule exists to prevent. It also creates a second source of truth for one mutable fact (how much evidence counts as evidence), which cuts against the single-source-of-truth principle.

### D5 — Does `botDecide` speak, or only decide?
- **A, C**: prose assembled at the return sites (`say(tag, slot, …)` / `reasonFor(spot)`), still inside `botDecide`.
- **B**: `botDecide` returns `{intent, slots}` and never prose; a separate `BOT VOICE` section renders it. Buys a mechanically testable truth table (every emitted intent matches the returned action) and per-template `needs:[…]` preconditions validated at emit time.

**Cost B alone names:** the phrase layer sits *outside* `t3.js`'s static scan slice (`function botDecide` → GAME STATE banner), so the fairness ban list silently stops covering code that runs inside a bot decision unless the slice is widened. That is a change to the repo's trust anchor.

Sub-disagreement: B adds a 6-deep no-repeat ring in roster state. A and C both explicitly refuse a repeat guard as cosmetic state ("humans repeat themselves too").

### D6 — How much ctx growth, and how much modification to `t3.js`?
- **A**: +3 flat scalars (`currentBet`, `mood`, `rivalHeat`). No change to the scanner.
- **B**: +`self` (a **nested object**), `liveOpps`, `currentBet`, `minRaise` — and notes t3's runtime leak scan only inspects top-level values, so **the scanner must be extended**. Plus the static slice widening from D5.
- **C**: +6 flat fields including `aggName`, a **string sourced from another seat** — public (it is printed in the log) but a new kind of value in ctx.

**What hinges on it:** the fairness test is the highest-trust artifact in the repo. Two of three designs require modifying it in the same commit that expands what it must catch. That is not disqualifying, but it inverts the usual order and should be a conscious call.

### D7 — Is loosening safe without a multiway bound?
- **B** ships `liveOpps` and shifts bucket boundaries and bluff frequencies by field size, framing it explicitly as *the safety valve* for mood-loosening: without it, tilt produces "absurd five-way spew."
- **A and C** both refuse it this increment — A as "real modelling defect, belongs on the open-work list, a judge reading a transcript cannot tell"; C as "not a cause of any tell, would double the increment."

**What hinges on it:** this is the one refusal in two designs that a third contradicts *on safety grounds rather than taste*. Every bot currently evaluates its hand against exactly one random opponent regardless of how many are live; all three designs are about to make bots enter more pots. Worth an independent check before accepting the majority.

### D8 — Should the UI narrate bot mood?
- **C** alone adds one word to `readsLiveLine` ("steaming" / "card-dead"), on anti-theatre grounds: the UI should not know less about the bots than the bots do.
- **A, B** keep it internal; B surfaces it only through voice.

**What hinges on it:** whether an explicit label helps the learner attribute the behavior change, or hands them the answer the prose was supposed to teach them to read.

### D9 — How strict is the acceptance bar, and what does failure mean?
| | Bar | Protocol notes |
|---|---|---|
| **A** | mean ≥5.0; each tell in <half of blocks | **Check mechanical metrics first** — a bad score with unfired mechanisms is a bug, not a bad design |
| **B** | mean ≥5.0; strict majority of paired blocks new>old | Adds `t7`/`t8` as permanent deterministic audits with independent oracles |
| **C** | mean ≥**5.5**; **every** new block strictly above its pair; no original tell in a majority; any *new* converged tell is a finding to act on | Git-checks-out the pre-change file into a temp path so the A arm is genuinely pre-change; requires re-freezing PLAN.md criterion 2a bands as an explicit documented act |

C's "every block strictly above its pair" over 8 paired blocks is materially harsher than the other two and could fail a good change on judge noise. A's ordering discipline (mechanical metrics before judge scores) is the most operationally useful idea in this row and is compatible with any bar.

---

## 3. Complexity vs coverage

Coverage marks are each design's own claim, restated: ●● closes the tell outright, ● partial/secondary, ○ explicitly disclaimed.

| | Tell 1 sizing | Tell 2 discipline | Tell 3 voice | Tell 4 arc | Mechanisms | ctx growth | New/modified test surface | Other cost |
|---|---|---|---|---|---|---|---|---|
| **A — minimalist** | ●● `style.size` + `humanSize`, both collapse points deleted | ●● logistic boundary + curiosity call + limps for all | ●● 11 slots × 5 personas ≈110 strings + 4 clause builders | ●● one mood scalar + rivalHeat | 4 (+1 trivial) | +3 flat scalars | regex assertion added to existing `audit.js`; harness draw-count bump | Smallest diff. Refuses multiway bound, trait vectors, repeat guard, nudge retune. Docs: §3.1, §3.4, §12 + one new invariant |
| **B — model-first** | ●● `humanSize` + per-seat `sizeBase`/`sizeNoise`/`sizeTell`/`oddSize` | ●● logistic + `edge`/`temp`/`chase` traits + mood clustering | ●● intent/slots split, ≥6 templates per (persona,intent), no-repeat ring, needs-tag validation | ●● mood + bore + rival heat + stackBB | 7 (+1 trivial) | +nested `self`, `liveOpps`, `currentBet`, `minRaise` | **two new files (`t7`,`t8`) plus two modifications to `t3.js`** (nested-object walk; widened static slice) | Largest diff; file → ~1850 lines. Only design shipping the multiway guardrail. Only design where two seats of one persona differ |
| **C — judge-adversarial** | ●● 4 sizing dials + `chipRound` with `roundBias` and a 6% odd-value tail | ●● logistic + **`style.misread`** correlating errors within a hand + widened entry paths | ●● composed `spotClause + readClause + moodClause`, 4-6 variants/slot ≈100-140 strings | ●● steam + cold + nemesis, **plus** 2× nudge coefficients and a split `READS_PRIOR` | 4 (+1 trivial) | +6 flat, incl. `aggName` string | new `t7.js` + `exp/run-voice.js` + `exp/run-feel-ab.js`; **re-freeze PLAN.md criterion 2a bands**; `exp-harness` `mustReplace` becomes a no-op and throws | Touches UI (`readsLiveLine`) and the reads engine. Strictest acceptance bar. Only design that makes bots hold false beliefs |
| **all three** | — | — | — | — | latency | — | — | ○ closes nothing measured; cut first |

Cost read across the row: A and C are comparable in code volume and differ mainly in *what extra surfaces they touch* (C reaches into the reads engine, the UI, and the experiment criteria; A touches none of those). B is roughly 1.5–2× either in surface area, and it is the only one that requires editing the fairness test itself in two places.

---

## 4. Questions to answer before choosing

Ordered so that early answers eliminate options.

1. **Must two seats of the same archetype behave differently, or are fixed readable personas the product?** Answering "fixed personas" eliminates B's seat DNA and collapses most of B's extra cost. Answering "they must differ" makes A's refusal the weak point.

2. **Is "premium" a fixed teachable concept?** If yes, mood must not touch `thr` (A's position) and B/C need that line removed. If no, A is leaving the most legible tilt signal on the table. One line, real curriculum consequence.

3. **May a bot hold and state a false belief about its own hand strength?** C's `misread` is the strongest error model in the set precisely because it does this. Rule on it explicitly under the truthful-reasons constraint before it ships as an implementation detail.

4. **One prior, or two?** If the bot's gut may run on 12 samples while the dossier still requires 20, C's arc becomes visible inside the 30-hand window. If that reads as the fake certainty the prior exists to prevent, C's D4 component is cut and its arc leans entirely on steam/nemesis.

5. **Who enforces truthfulness — architecture, or a reviewed data table plus regex?** B buys a structural guarantee (intent↔action truth table, `needs` preconditions) at the price of modifying `t3.js`'s scan window. A and C buy a cheaper guarantee that, as C states plainly, "cannot catch 'I've got a good feeling about this board' written into a fold bank." How much do you trust future edits to that table?

6. **Is loosening safe without a multiway bound?** B says no and ships one; A and C say it is out of scope. This is the disagreement most worth resolving with an independent check rather than a preference, because it is a safety claim, not an aesthetic one.

7. **What churn to `t3.js` and the harness contracts is acceptable in one commit?** Two of three designs modify the fairness test in the same increment that expands what it must catch. If the answer is "none," A is the only design that clears it as written.

8. **Is the blind panel a gate or an instrument?** A treats a low score with unfired mechanisms as a bug. C treats a per-block miss as failure. If there is budget for exactly one panel run, A's ordering (mechanical metrics first, judges second) is the safer protocol regardless of which design you pick.

9. **Are you willing to re-freeze PLAN.md's criterion 2a VPIP/F2bet bands, and who signs that off?** C alone names this as a required, deliberate, documented act. It is true for all three — moving those rates is the whole point — so it becomes an unowned obligation in A and B.

10. **One increment or two?** The consensus core (C2–C6, C9–C10) is separable from every contested item. Shipping the shared spine first would produce a measurable panel result that tells you whether the contested layers (seat DNA, misread, nudge retune, multiway bound) are still needed — at the cost of two panel runs instead of one. None of the three designs proposes this; all three are written as a single increment.