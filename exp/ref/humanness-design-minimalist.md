# Design: minimalist

## Diagnosis
The bots aren't badly tuned, they're structurally missing three dimensions and speaking with one mouth. (1) Sizing has no stochastic, per-persona or per-street input anywhere in the file — six pot-only formulas, two of which are dead because `Math.max(6, …)` at line 737 and `applyAction`'s legal-minimum clamp at line 1099 swallow them — so every open is 6 and every 3-bet is 10 by arithmetic, not by policy. (2) The two highest-frequency decisions at the table (first-in fold at line 749 / facing-a-raise fold at 772, and the postflop call/fold at 816-822) contain no random draw at all, so the code is literally incapable of the loose calls and bad folds that define recreational players, and the five personas differ by 1.3 points of required equity — one calling boundary in five hats. (3) Nothing session-scoped reaches `botDecide`: ctx has no hand index, no outcome history, no self-state, and `style` is a frozen `const`, so no arc can exist even in principle. Layered on top, all reason text is 18 template literals welded to return statements, printing the RNG verbatim in 73% of cases with a 75-word vocabulary and zero persona-conditional prose. The fix is four surgical additions — a sizing dimension, a soft (probabilistic) decision boundary, one decaying per-bot mood/grudge scalar carried in ctx, and a persona-keyed phrase bank replacing the inline strings — all of which keep `botDecide` a pure function of ctx and keep every stated reason welded to the branch that actually fired.

## Mechanisms
### Sizing dimension (kill both collapse points) [small]
Add one helper above `botDecide`:
```js
/* Human sizing: persona base, jittered, snapped to a granularity that
   coarsens as the number grows (people bet 25, not 23). */
function humanSize(base, spread, r){
  const v = base * (1 + spread*(r*2-1));
  const g = v < 12 ? 1 : v < 40 ? 2 : 5;
  return Math.max(2, Math.round(v/g)*g);
}
```
Add `size` (one scalar) to each `BOT_STYLES` entry (poker-trainer.html:831-843): nit 1.15, solid 1.00, maniac 0.82, selective 1.10, station 0.88 — small-sizing maniac, chunky nit, matching the recreational literature. Draw one extra uniform at the top of `botDecide` (`const rz = Math.random();`) and rewrite all six sizing expressions:
- line 737 open: `Math.min(myStack, humanSize(pot * 2.1 * style.size, 0.16, rz))` — delete the `Math.max(6, …)` floor. At pot 3 this spans ~5-8 across personas; a limped pot (5) scales it naturally, which is correct and free.
- lines 761/770 preflop 3-bet: `Math.min(myStack, humanSize(ctx.currentBet * 3.0 * style.size, 0.15, rz))`. This requires adding `currentBet` to ctx in `step()` (line ~1155) — fully public table information, already present in the exp build's extended ctx. Facing an 8 this yields ~21-29 instead of a clamped 10, so the min-raise ladder disappears at its source.
- line 793 postflop bet: `humanSize(pot * (bucket==='strong'?0.72:bucket==='good'?0.55:0.42) * style.size, 0.22, rz)`; delete the now-unused `halfPot`/`fullPot` (780-781).
- lines 807/812 raises: `humanSize(pot * 0.85 * style.size, 0.20, rz) + toCall`.
Keep the clamp at line 1099 as a legality backstop — just stop depending on it.

Closes: Tell 1 (inhuman uniformity) directly and completely: opens stop being one constant, 3-bets stop being the legal minimum, and the ±16-22% jitter makes strong/weak postflop size distributions overlap so the size stops naming the hand. Also dents tell 3, since persona now shows in chips, not just in prose.

### Soft decision boundary + limps for everyone [small]
Three edits, all inside `botDecide`, plus one data edit.
(a) Data: give every persona a nonzero `limp` (nit 0.03, solid 0.10, maniac 0.18, selective 0.05, station 0.40) so no seat is structurally raise-or-fold. Zero code change.
(b) Line 772's terminal fold: insert before it a curiosity-call frequency — `const looseCall = clampFreq(0.055 * looseM / style.fold); if(pct <= thr*3.2 && r3 < looseCall) return call(...)` — using a second new uniform `const r3 = Math.random();` drawn at the top (independent of `roll`, so branches stop being correlated by a single reused draw).
(c) The big one, lines 816-822: replace the step function `effective > need + edgeNeed` with a logistic mix:
```js
const temp = 0.030 * style.fold / (1 + 0.5*Math.abs(mood) + 0.2*heat); // nit sharp, station mushy
const pCall = 1/(1 + Math.exp(-((effective - need - edgeNeed))/temp));
if(r3 < pCall) return call(...) else return fold(...)
```
With temp ≈ 0.041 (nit) vs 0.022 (station… inverted by the `fold` dial: station 0.72 → 0.022 sharp) — set the sign so LOW `fold` widens: use `temp = 0.030 / style.fold`, giving nit 0.022 (near-deterministic, folds correctly) and station 0.042 (calls ~10 points short of the odds maybe a quarter of the time, folds a marginal edge occasionally). That is a genuine, costly, persona-specific leak in the single most frequent decision at the table, and it is still a frequency, not a rule.

Closes: Tell 2 (flawless discipline) — this is the only change that can produce a bad call or a bad fold, because today the code cannot. Also tell 3's behavioural half: the five personas stop sharing one calling boundary; the spread goes from 1.3 points of required equity to visibly different call/fold texture in identical spots.

### Decaying mood + grudge (the arc) [moderate]
New persistent per-bot state on `roster[i]`, seeded in `newSession` (line ~936): `mood:0, rival:null, rivalHeat:0`. Updated once per hand at the end of `endHand` (the existing roster loop at lines ~1249-1254), from public chip movement only:
```js
const delta = (p.stack - r.stack) / START;                 // r.stack is pre-update
r.mood = Math.max(-1, Math.min(1, r.mood*0.72 + delta*3));
r.rivalHeat = Math.max(0, r.rivalHeat - 1);
if(delta < -0.10 && biggestWinnerSeat != null && biggestWinnerSeat !== r.seat){
  r.rival = biggestWinnerSeat; r.rivalHeat = Math.min(3, r.rivalHeat + 2);
}
```
(`biggestWinnerSeat` comes from the `tally` map already built a few lines above.) The 0.72 decay puts a 40-chip loss at mood -0.6 falling under 0.15 in ~5 hands — the transient, multi-hand tilt window the clinical literature describes, and winner's tilt falls out of the positive sign for free.
ctx gains two public scalars in `step()`: `mood: rosterOf(p).mood` and `rivalHeat: (agg && rosterOf(p).rival===agg.seat) ? rosterOf(p).rivalHeat : 0`. Neither encodes a card.
At the top of `botDecide`, two derived multipliers used at six existing sites:
```js
const mood=ctx.mood||0, heat=ctx.rivalHeat||0;
const steam=Math.max(0,-mood), heater=Math.max(0,mood);
const looseM = 1 + 0.30*steam + 0.18*heater + 0.12*heat;  // enter/call wider
const aggM   = 1 + 0.15*steam + 0.30*heater + 0.15*heat;  // bet/raise more
```
Applied as `f *= looseM` on the open frequency (736), limp frequency (745), `defendCall`/`spewCall`/`looseCall` (756-757), `betFreq` (792); `*= aggM` on `threeBet`/`bluff3` (755, 758), `raiseFreq` (806), `bluffRaise` (811); and into `temp` above. Deliberately NOT touching `thr` — widening the threshold would also corrupt what counts as premium.

Closes: Tell 4 (no arc) — the only mechanism here that can produce one, because ctx currently carries no time, history or self-knowledge and `style` is immutable. Magnitude is roughly +0.10 VPIP for a handful of hands after a big pot, matching the tracker-measured tilt anchor, i.e. an order of magnitude above the existing sub-perceptual ±4% reads nudge. The grudge term is the BotPrize finding (bots that irrationally over-pursue one rival rate as more human) and gives a visible cross-hand storyline between two named seats. Also feeds tell 2: tilt-driven loose calls are exactly the human mistakes the panel found missing.

### Persona phrase bank replacing the 18 inline literals [moderate]
New `VOICE` const in the BOT POLICY section, keyed by `style.tag` (already in ctx, never read today):
```js
const VOICE = { nit:{ openPre:[…], foldPre:[…], limp:[…], callPre:[…], reraise:[…],
  bet:[…], betBluff:[…], check:[…], callPost:[…], foldPost:[…], raisePost:[…] },
  solid:{…}, maniac:{…}, selective:{…}, station:{…} };
function pick(a,r){ return a[Math.floor(r*a.length)%a.length]; }
function say(tag, slot, r, ...clauses){
  return [pick((VOICE[tag]||VOICE.solid)[slot], r), ...clauses.filter(Boolean)].join(' ');
}
```
11 slots × 5 personas × 2-3 fragments ≈ 110 short first-person strings — data, not logic. Each `return` in `botDecide` swaps its template literal for `say(style.tag, '<slot>', rv, …)`, where `rv` is a third new uniform. Because the slot is welded to the branch, a fold can never emit call prose.
Four truthful clause builders (each a pure function of ctx values already in scope):
- `boardClause(board)` → 'Two hearts out there.' / 'Paired board.' / 'Nothing scary on this one.' — derived from the actual board.
- `oddsClause(toCall,pot)` → 'I'm getting about three to one.' (from `1/need - 1`, rounded to a spoken ratio).
- `readClause(nudge)` → `facingNudge` keeps its `tags` array but its frozen `note` string is deleted; instead tags map to qualitative, confidence-hedged speech: `s.conf < 0.35` → 'I haven't seen enough from them yet.'; loose → 'They're in every pot.'; sticky → 'They never fold, so a bluff is pointless.'; 3-bets light → 'They re-raise light, so this is wider than it looks.'
- `moodClause(mood, heat)` → emitted only when `|mood| > 0.35` or `heat > 0`: 'Still stinging from that last one.' / 'Running good, so I'll take a swing.' / 'This is the one I keep tangling with tonight.' Phrased as disposition, which is exactly what the state is — it was computed from real chip swings.
Hard bans, enforced by a new regex assertion in `audit.js` over every bot reason produced in a 500-hand run: no `roll`, no `%`, no `branch`, no digit-followed-by-percent. That kills the RNG leak (552/753 reasons), the code-structure leak ('flat-call branch', 'the slow branch'), the 0%-frequency coin-flip nonsense (190 reasons), and the stats-engine register in one guard.

Closes: Tell 3 (one voice, five hats) — the entire tell is text, and this is its only fix: five distinct registers, first person, situational detail from the real board and real chips, and internal counters translated to hedged qualitative judgements instead of quoted verbatim. Top-3 skeleton coverage should fall from 53% to under 25%; vocabulary from ~75 word types to several hundred.

### Thinking time tied to decision closeness [trivial]
In `step()` (poker-trainer.html:~1150), compute `d = botDecide(...)` immediately, then `setTimeout(() => { applyAction(p,d); … }, 340 + Math.round(Math.random()*220) + Math.round(900*(d.think||0)))`. `botDecide` sets `think` (0..1) in the two branches where closeness is already computed: `Math.max(0, 1 - Math.abs(effective-need-edgeNeed)/0.10)` postflop, and `Math.max(0, 1 - Math.abs(pct-defend)/8)` on the preflop defend boundary. Default 0 elsewhere, so trivial folds snap and river guesses stall.

Closes: None of the four, honestly — the panel judged text transcripts and cannot see timing. Included because it is four lines, it is the top finding in the reaction-time and bot-detection literature (flat latency is itself a tell), and it serves the owner's actual goal of a table that feels alive to a live player. Cut it first if anything has to go.

## Refused
- Per-bot hidden trait vectors (bluff bias, patience, tilt susceptibility) on top of the five styles. `style.size` plus one mood scalar already give per-seat separation in chips, in calling boundary, and in voice; a second parallel personality system would be five more dials that no judge could attribute to a specific bot inside 30 hands.
- Tracery-style no-repeat-within-N-hands memory for reason phrasing. It needs either state in ctx or a mutable module-level ring buffer (which would break the purity story for a cosmetic gain). Two-to-three fragments per slot crossed with four independent situational clauses already produces enough surface variety; exact-line repeats inside 30 hands will be rare and, when they happen, humans repeat themselves too.
- Stack-depth-driven frequencies. `myStack` is the obvious dead input, but mood already carries the same 'having a bad night' signal with a decay curve, and short-stack policy is a genuinely different strategic problem (push/fold ranges) that would need real work to get right rather than a multiplier.
- Loosening `READS_PRIOR` (20) or `READS_MIN_HANDS` (30) to make the reads nudge visible sooner. The shrinkage is load-bearing anti-fake-certainty design (ARCHITECTURE.md §0) shared with the UI dossiers; weakening it would make the panels print confidence they haven't earned. Mood and grudge supply the arc instead, and `readClause` surfaces the reads that do exist in hedged language, which is the disclosure half of the problem without touching the math.
- Board-texture and opponent-count terms in the bet-sizing and strength functions (`strengthVsRandom` vs one random hand regardless of how many are live; `multiway` keying off `streetBets` rather than live opponents). These are real modelling defects and they belong on the open-work list, but they change what the bots know, not how human they sound — a judge reading a transcript cannot tell that a 3-way pot was evaluated heads-up.
- Any second decision system, LLM narration layer, or richer private bot model. Already ruled out, and the last would make the shared-reads guarantee (§12) a lie.

## Risks
- Exploitability regression. The soft calling boundary and the tilt loosening both hand the hero EV. `exp/run-probes.js` exists exactly for this: the degenerate-hero probes must still show a maniac hero losing badly and 'always re-raise when bet at' losing badly. Treat a large drop in either as a calibration failure of `temp` / `looseM`, not as success.
- ctx additions (`currentBet`, `mood`, `rivalHeat`) mandate a `t3.js` re-run per §3.1. None of the three is card-derived, and the static ban list (`isHero`, `players[0]`, `hero`, `S.`) is untouched, but the ctx-leak check is the thing that proves it.
- `exp/exp-harness.js:44-46` asserts exactly 5 `Math.random()` sites and will throw. Three new sites (`rz`, `r3`, `rv`) plus the timing jitter in `step()` take it to 9; bump the constant and re-audit the stream assignment. All three new draws happen inside `botDecide`, so they land on the per-decision stream and determinism holds — but verify that, don't assume it.
- The mood clause is the one place voice could drift from truth. `mood` is derived from real chip swings, so 'still stinging from that last one' is factual — but only if the fragments stay dispositional. A fragment that claims causation ('so I'm calling wider than I would have') would be a lie in the cases where the multiplier didn't actually flip the branch. Keep the bank dispositional and review every fragment against that rule.
- Grudge could look like scripted theatre if `rivalHeat` fires too often. The `delta < -0.10` gate (a tenth of a buy-in) plus decay of 1/hand should make it a few hands per session, not a standing feud. Check the realized frequency in the transcripts before shipping.
- Sizing changes touch the money path. Chips stay conserved because `applyAction` still clamps to legal minimum and to stack, but `t2.js`/`t6.js`/`audit.js` are the proof, and `audit.js`'s incomplete-raise case is now reachable more often since sizes vary.
- Docs go stale immediately: §3.1 ctx field list, §3.4's 'some postflop call/fold branches are threshold-based' (now none are), §12's styles table and 'no separate fields' note, and a new invariant stating that bot reason text may not contain raw rolls, percentages or branch names.

## Verification
"Primary, pre-registered before any judging (the failure mode here is moving the goalposts after seeing scores). Fork `exp/run-feel.js` into a coded-vs-coded pairing: arm A is the current HEAD build, arm B the new build, both replaying the identical `SESSION_SEEDS` so the pairs share cards and differ only in decisions; blocks shuffled and letter-labelled, key withheld. Reuse the exact 16-judge single-block prompt from the original panel (one 30-hand block per judge, no mention of AI), scoring 1-10 on 'do these opponents read like real people' plus a yes/no on each of the four named tells. Pass bar, frozen up front: mean humanness >= 5.0 (from 1-1.5), and each tell flagged in under half the blocks. Cost is the same ~$0 seeded-replay + cheap-judge path the original used.\n\nSecondary mechanical metrics, computed straight off the transcripts, so we know each mechanism actually fired even if the judges are noisy — these are the ones to check FIRST, since a failed judge score with unfired mechanisms means a bug, not a bad design:\n- distinct raise-to values per 30-hand block >= 12 (baseline: 2, `raises to 6` and `raises to 10`)\n- share of preflop opens equal to the modal size < 35% (baseline: 100%)\n- share of 3-bets landing exactly on the legal minimum < 20% (baseline: 100%)\n- limps per 30-hand block >= 12 across the five seats, with all five seats non-zero (baseline: 2-8, three seats structurally zero)\n- postflop call/fold decisions that go AGAINST the old step function: 8-18% overall, and at least 2x higher for station than for nit (baseline: 0%)\n- per-bot mood trace exported alongside the block: at least two excursions past |0.35| per session, each decaying within ~6 hands\n- reason text: top-3 skeleton coverage < 25% (baseline 53%), distinct English word types > 250 (baseline ~75), and zero matches for /roll|%|branch/ across all reasons\n\nGates that must be green before any of the above counts: `bash run-all.sh` clean, `node t3.js` clean (mandatory — ctx changed), `node exp/t-exp.js` clean after the Math.random-count bump, and `node exp/run-probes.js` showing exploit probes still losing at roughly baseline magnitude."