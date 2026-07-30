# The Long Run — architecture & handoff

A 6-max No-Limit Hold'em trainer. Single self-contained HTML file, no build step, no
npm dependencies. Game logic runs entirely in the browser (Google Fonts may load from
the network when online). Opens locally or via the Vercel static deploy.

**Read this before changing anything.** Several design choices look like mistakes and
are not. They are marked ⚠ throughout.

---

## 0. Cold start (agents)

**Mental model in one line:** one HTML file deals fair 6-max NLHE; bots are
**frequency policies** with fixed recreational styles and a shared **public-action
reads** model — not LLMs, not GTO solvers.

### Read in this order

1. This section (§0) and §1 (purpose)
2. §3 (invariants — do not break)
3. §2 (where files and script sections live)
4. §5 (state machine) → §12 (styles / reads / UI)
5. §9 (how to run tests; harness string-match traps)
6. §10–11 (limits and open work) before inventing new systems

### Where to change what

| Goal | Touch |
|---|---|
| Bot decisions / frequencies | `botDecide` in `poker-trainer.html` (BOT POLICY) |
| Styles / limps / blurbs | `BOT_STYLES` + limp branch in `botDecide` |
| Cross-hand memory | `freshReads` / `applyAction` reads block / `facingNudge` / `readLabel` |
| Table / pots / streets | GAME STATE (`step`, `applyAction`, `buildPots`, `endHand`) |
| Seats, dossiers, strip, export | RENDER |
| Tests | `harness.js` + `t*.js` / `audit.js` — keep `function botDecide(ctx){` literal |

### Load-bearing decisions (do not casually reverse)

| Decision | Rationale |
|---|---|
| **Frequencies, not fixed rules** | A bot that always folds to 3-bets teaches a habit that dies at a real table (§3.4) |
| **`botDecide` is ctx-only** | Fairness is structural: never read `S` or others’ hole cards; `t3.js` enforces it |
| **Coded policy, not LLM decisions** | LLMs are weak/unreliable at NLHE, break offline/simple/testable fairness, and separate “reason” from cause. Optional LLM *narration* of public stats is a later experiment — not the action chooser |
| **Recreational leaks, not GTO** | Target is beginner–intermediate opponents you can learn to read (limp, station, maniac), not solver-perfect play |
| **One shared reads model** | UI dossiers, export, and bot nudges share one public counter set. If bots used a richer private model, the UI would lie — review becomes theatre |
| **Priors + confidence tiers** | Small samples must not print fake certainty (`unknown` → `lean` → `solid`) |
| **No browser persistence** | `localStorage`/`sessionStorage` fail in some sandboxes; also keeps each session a clean slate (no silent carry-over). Export is the review path |
| **Mint = machine signal** | Prefer mint for equity/odds/verdicts and primary actions; never mint-decorate dossiers/style pills or the signal dilutes |
| **Percentile opens, not 5 tiers** | Old coarse tiers were 3–5× too tight vs real players (§8.1) |
| **Hero is always seat / `players[0]`** | Single-hero trainer; indexing, Proxy fairness traps, and UI assume this — don’t “generalize” seats without rewriting those |

### Quick verify after changes

```bash
bash run-all.sh    # any BUG/FAIL line = regression
node t3.js         # always after touching botDecide or its ctx
```

---

## 1. What this is for

A fair table to **play and learn** against readable opponents — not a casino skin with
hints bolted on. Outcomes over a short sample are noisy, so the app also separates
*decision* from *outcome* where it can (equity strip, full hand export, verbatim bot
reasons).

| Feature | What it's actually for |
|---|---|
| Bots cannot see your cards | Without this the post-hand review is theatre |
| Bots act on **frequencies**, not rules | A deterministic bot is solvable; you'd learn to beat *it*, not poker |
| Distinct seat styles + public reads | A table of people, not five copies of one policy |
| Limps, 3-bet / c-bet patterns | Recreational leaks you can actually practice reading |
| Bots log their real reason | The stated reason **is** the cause, so it can be trusted |
| Equity vs pot odds strip | Reduces every betting decision to one comparison |
| Full session export | Review needs the whole hand, not a memory of it |

---

## 2. File layout

**App:** `poker-trainer.html` (~1600 lines), three parts:

```
<style>    design tokens + layout (including seat tips)
<body>     static shell; the table is built by JS
<script>   labelled sections, in dependency order
```

The script sections, in order (each has a banner comment):

| Section | Purpose |
|---|---|
| `CARDS` | deck, shuffle, card→string |
| `HAND EVALUATION` | 7 cards → comparable hand rank |
| `HAND RANKING` | all 169 starting hands as percentiles |
| `EQUITY` | Monte Carlo, range inference |
| `READS` | public-action memory, labels, facing nudges |
| `BOT POLICY` | the single decision function |
| `GAME STATE` | table, positions, betting loop, pots, styles |
| `RENDER` | all DOM writing (seats, tips, strip, export) |

**Repo (flat — no `tests/` folder):**

| Path | Role |
|---|---|
| `poker-trainer.html` | the app |
| `harness.js` / `t*.js` / `audit.js` / `run-all.sh` | Node test suite |
| `vercel.json` | `/` → `poker-trainer.html` |
| `ARCHITECTURE.md` / `README.md` | handoff + how to run |

There is **no framework and no bundler.** Functions are hoisted and called directly.
Global mutable state is documented in §5. This is deliberate: the file has to stay
readable and testable by a person or agent with no setup.

---

## 3. ⚠ Invariants — do not break these

Some are **test-enforced**; others are **design intent** (breaking them is still wrong,
but the suite may not catch it). Treat both as load-bearing.

### 3.1 Bots cannot see hero's cards — **tested (`t3.js`)**

`botDecide(ctx)` takes a context object built in `step()`. Public fields only:

```js
{ myCards, board, street, toCall, pot, myStack, position, raisedBefore, openThr, tableSize,
  inPosition, streetBets, facingReads, aggressorHadInitiative, style }
```

`tableSize` is passed today but unused inside `botDecide` (kept for call-site symmetry /
future HU logic — don’t invent policy around it without need).

Hero's cards / other hole cards are **not** parameters (except the acting bot's own
`myCards`). `facingReads` is the aggressor’s **raw** `roster[].reads` counters (not
pre-shrunk, never a seat index into `S`). Shrinkage / nudge math runs inside
`facingNudge`. The function never touches `S` — it is pure with respect to its
arguments. That is what makes the guarantee structural rather than a promise.

**Return shape** (what `applyAction` consumes):

```js
{ action: 'fold'|'check'|'call'|'bet'|'raise', amount?: number, reason: string, pct?: number }
```

`amount` is required for `bet`/`raise` (total chips to put in / raise-to sizing as the
call site expects). Inventing `size`/`bet` instead of `amount` silently breaks sizing.

`t3.js` proves fairness two ways: statically (the decision code contains no reference
to `isHero`, `players[0]`, `hero`, or `S.`) and at runtime, by wrapping **every** other
seat's card array in a `Proxy` that counts reads while a bot is deciding. Result must be
**zero**, with a control confirming the trap fires on the bot's own cards.
Note: the static ban list is narrow — do not reach for `roster` or other globals either.

**If you add a parameter to `botDecide`, re-run t3.**

Effective frequencies for mixed actions are `clampFreq`'d into `[0.05, 0.95]`.
A true zero (e.g. never open this trash hand) stays zero — we do not invent a 5% open.

### 3.2 Chips are conserved exactly — **tested (`t2.js`, `t6.js`)**

Six players × 200 = **1200 chips, forever.** Nobody rebuys. `t2.js` and `t6.js`
assert the table total never drifts.

Historical bug worth knowing: split pots used `Math.floor` and silently destroyed the odd
chip. Fixed by awarding remainders to the player nearest the button's left, which is the
real cardroom rule.

### 3.3 An uncalled bet is a refund, not a win — **design intent (no dedicated test)**

If you bet 78 into someone with 73, the extra 5 forms a pot with exactly one eligible
player. `endHand` detects `pot.elig.length === 1` and returns it, labelled as a refund.
Do not let it fall through to the "wins with a full house" path — it's the player's own
money coming back.

### 3.4 Frequencies, never rules — **design intent (no `t4.js` in-repo)**

Mixed actions (opens, bets, bluff-raises, limp rolls, many preflop continues) use
`if (Math.random() < someFrequency)`. That is the property to protect.

Honest nuance: some **postflop call/fold** branches are threshold-based
(`effective` equity vs need + `edgeNeed`) rather than a fresh random roll — still not
“always fold to pressure,” but not pure frequency either. Do **not** expand deterministic
always-do-X spots (especially always-fold-to-3bet / always-fold-to-cbet); that teaches
habits that die at a real table.

⚠ **This is the most important design property in the file and the easiest to
accidentally destroy.** A bot that always folds to a re-raise teaches the player to
always re-raise — a habit that gets punished immediately by real opponents. This is the
documented failure mode of most beginner poker apps.

Historical `tests/t4`-style checks (no `t4.js` in-repo) once confirmed no naive exploit
beats them: a maniac loses ~3000 bb/100, "always re-raise when bet at" loses ~2500 bb/100.
Do not treat that as currently CI-enforced.

---

## 4. Hand evaluation

`evaluate(cards)` takes **any number of cards ≥ 5** (usually 7) and returns:

```js
{ cat: 0..8, tie: [descending tiebreakers] }
```

`cat` is 0 high card → 8 straight flush. Compare with `cmpHand(a, b)` → negative/0/positive.

Direct evaluation, not 21-combination enumeration — it's called thousands of times per
equity simulation.

Edge cases that are **handled in code** (not covered by dedicated `evaluate` unit tests —
`t1b` is equity Monte Carlo, `t2` is table integrity): the wheel (A-2-3-4-5, ace plays
low), a wheel *flush* that is not a straight flush, a full house built from two sets of
trips, exact ties splitting correctly. Call `evaluate` with ≥5 cards; shorter inputs are
undefined.

`straightHigh(ranks)` appends a phantom rank-1 when an ace is present. Ranks are `2..14`.

---

## 5. Game state

Module-level mutables:

```js
let S          // current hand; null between sessions
let roster     // 6 persistent players; stack 0 = eliminated
let buttonSeat // seat index 0..5, survives between hands
let session    // { hands, net, vpip, hero, records[], over }
```

`roster[i].seat === i` always. **Hero is always `roster[0]` and always `S.players[0]`** —
a lot of code relies on that, so preserve it if you reorder anything.

Each roster entry also carries:

```js
style: null | { open, bet, fold, limp, tag, blurb }  // bots only; fixed at newSession
reads: {
  hands,
  vpipOpps, vpip, pfrOpps, pfr,
  agg, passive,
  foldToBetOpps, foldToBet,
  threeBetOpps, threeBet,
  foldToCbetOpps, foldToCbet
}
```

Per-hand `S` also tracks public action for bots: `streetBets`, `streetAggressor`,
`preflopRaiser` (reset on street advance as appropriate).

### Per hand

`S.players` contains only *living* players, in seat order starting from hero. So
`S.players.length` (aliased `S.n`) is 2–6, and `S.btnPos` is the button's index *within
that array*.

A player's distance from the button is `(i - S.btnPos + S.n) % S.n`, which drives
everything positional.

### Betting loop

A small state machine, driven by `step()`:

```
newHand → post blinds → step()
   step: hand over?          → endHand()
         betting round done? → advanceStreet()
         hero to act?        → renderActions() and WAIT for a click
         else                → setTimeout(bot acts, 620ms) → step()
advanceStreet: deal → reset bets → step()   (river → endHand)
```

⚠ `step()` returns early when it's hero's turn. The loop is resumed by the button
`onclick`. There is no polling. If you add an action path, it must end with
`S.toAct = nextToAct(S.toAct); step();` or the hand will hang.

⚠ Bot actions are queued through `setTimeout` for readability. The test harness replaces
`setTimeout` with a queue it drains synchronously (§9).

### Betting round completion

`bettingDone()` is true when every player who can still act has acted **and** matched
`S.currentBet`. The big blind starts with `acted = false` so it gets its option.

---

## 6. ⚠ Incomplete raises

An all-in for **less than a full raise** is not a raise. It does not reset `minRaise`, and
it does **not** give players who already acted another turn. This is real poker law and
it was a bug here until recently:

```js
const inc = p.bet - S.currentBet;
const fullRaise = inc >= S.minRaise;
S.currentBet = p.bet;              // the bet to match does go up
if (fullRaise) {                   // but only a legal raise reopens action
  S.minRaise = inc;
  S.players.forEach(o => { if (o !== p && !o.folded && !o.allIn) o.acted = false; });
}
```

Covered by `audit.js`.

---

## 7. Side pots

`buildPots()` layers by each player's total `invested`:

1. Collect distinct investment levels, ascending
2. For each level, sum every player's contribution *within that band*
3. Eligible = invested ≥ that level **and** not folded

Sum of all pot amounts always equals total invested, which is why conservation holds.
Folded players still contribute chips to lower layers — that is correct.

---

## 8. Hand ranking, ranges and equity

### 8.1 Percentiles, not tiers

`HAND_PCT` maps all 169 starting hands to a **cumulative percentile**: `AA: 0.45` means
AA is the top 0.45% of hands. `QJo: 16.6` means it's the boundary of the top ~17%.

Generated offline by simulating each hand against a random hand a few thousand times,
then nudging suited and connected hands upward (raw equity undervalues playability). The
generator is not in the file — the table is baked in. To regenerate, re-derive from the
method described here; the ordering it produces matches published charts closely
(AA KK QQ JJ AKs TT AQs KQs …).

⚠ This replaced an earlier hand-typed 5-tier system that was measured to be **3–5×
tighter than real players** — the button opened 14% where it should open 45%. Don't
reintroduce coarse tiers.

### 8.2 Opening ranges derive from players-behind

```js
openThreshold(pos, behind, n)
```

The threshold is a function of **how many players still act after you**, not the seat's
name. That's what makes the table work at any size — 5-handed simply has no hijack, and
everyone's range widens automatically as players bust.

```
behind:  5    4    3    2    1    0
open %:  16   21   28   45   45*  45      (* SB × 0.85, it acts first postflop)
heads-up: button 85%, big blind 100%
```

Hands at the edge of a range open only *some* of the time (`openFreq`), tapering to zero.
That taper is what makes the range unexploitable.

### 8.3 Equity is conditioned on the betting story

`equity(mine, board, opps, iters)` where each opponent is `{ cap, aggr }`:

- `cap` — percentile ceiling inferred from their **preflop** action
- `aggr` — how many times they've bet or raised **postflop**

⚠ **`aggr` is the important half and was missing originally.** Sampling only from a
preflop range told the player that ace-high was 48% to win against someone who had bet
three streets. The true number was 2%.

The fix: `betLikelihood(hole, board)` mirrors the bots' own betting frequencies, and
sampled opponent hands are accepted with probability `(likelihood/0.80)^aggr`. Hands that
would rarely have bet that many times are rejected. Three barrels means the range is
~99% real hands, because bluffing three streets in a row is `0.13³ ≈ 1 in 500`.

⚠ Known imprecision: the in-browser version uses hand *categories* as a strength proxy
rather than a nested simulation, for speed. It gets the decision right (25% vs 32% needed
→ fold) but understates how bad the spot is (truth ≈ 2%). Improving this means a faster
strength estimator, not a different formula.

Cost is ~8ms per readout. Don't raise the iteration count without measuring.

---

## 9. Testing

```bash
bash run-all.sh                     # everything; any BUG/FAIL line is a regression
node t3.js                          # fairness only — run after touching botDecide
```

Node ≥ 18. No dependencies.

### How the harness works

`harness.js` extracts the `<script>` body from the HTML, applies surgical string
replacements, and evaluates it as a function with a fake DOM:

1. `renderActions()` → `HERO_ACT()` so a test can drive hero programmatically
2. wraps `botDecide` with `BOTFLAG` + `SETCTX` so card access can be trapped and the
   last ctx inspected
3. strips the bootstrap call so tests control when a session starts

⚠ **The transforms are string matches against the app source.** Keep the literal
`function botDecide(ctx){` declaration line unchanged — if that wrap fails, harness
**throws**. Renames of `renderActions` → `HERO_ACT` or the bootstrap strip
(`updateSession();` + `newHand`/`newSession`) still **fail silently** and tests will
behave strangely rather than failing loudly. This actually happened: renaming
`newHand()` to `newSession()` at the bootstrap made the harness run a phantom session
whose leftover callbacks bled into later ones, producing a fake chip-conservation
failure that took four diagnostics to trace. **If a test result looks impossible,
suspect the harness first.**

### Suites

| File | Covers |
|---|---|
| `t1b.js` | equity engine vs hand-verified draw maths |
| `t2.js` | 3000 hands: no hangs, no negative stacks, pot = money in; winner check is a narrow log heuristic, not a full pot-award oracle |
| `t3.js` | fairness — static scan + Proxy trap on **all other seats**, ctx leak check, control |
| `t6.js` | elimination, table shrinking 6→2, chip conservation, heads-up blind rules |
| `audit.js` | VPIP scope, session bb, incomplete raises, styles/limps, forced 3-bet & fold-to-cbet spots |
| `exp/t-exp.js` | seeded-harness gates for the humanize layer: sizing spread + zero engine-floor clamps (normalize oracle), boundary blur persona-shaped by RATE, dbg-roll drawn-and-governs, exhaustive VOICE text-ban scan, mood arithmetic vs a hand-computed table + call-site fidelity, oracle replay, cross-arm deal identity |
| `exp/run-probes.js` | exploitability LOCK: degenerate heroes must lose ≥ hardcoded bb/100 thresholds (~50% of measured), nonzero exit |
| `exp/run-labels.js` | readability LOCK: per-persona dossier labels at hand 31 within 10pp of the pre-humanize engine, measured at 90 sessions (30 was inside binomial noise), nonzero exit |

All of the above run in `run-all.sh`, which exits nonzero on any suite failure
or BUG/FAIL line (every suite sets a real exit code — added when it was
discovered none did). Every test in `exp/` runs on a **seeded** harness
(`exp/exp-harness.js`: keyed RNG streams, `htmlPath` for cross-version A/B);
the Math.random site count lives in ONE place, its `EXPECTED_RAND_SITES`
export. Frozen evidence (baselines, blind-panel verdicts, the paid LLM pilot
decisions, the panel instrument) is tracked in `exp/ref/` — it is preserved
history from the pre-humanize engine; new outputs are expected to diverge
from it, never "fix" that.

⚠ Several expectations in `t1b.js` look wrong and are not — they have comments
explaining why (e.g. a set is ~75% against a flush draw, not 66%, because it redraws to a
full house). Verify by hand before "correcting" them.

---

## 10. Known limitations

**Showdown cards are not in the reads model.** Reads update from public actions only
(fold/call/bet/raise). Revealed hole cards at showdown are ignored in v1 so the
action/card boundary stays clean for fairness tests.

**Range inference is crude.** `cap` narrows on a preflop raise and again on a postflop
bet, but it doesn't model board texture or bet sizing.

**No rake.** Real games take a cut; win rates here are optimistic by a couple of bb/100.

**No cross-session memory.** Reads and styles live in RAM for one session; refresh clears
them. There is no profiles menu — bot diversity is fixed seat styles baked at
`newSession`.

**Two VPIP numbers by design.** `session.vpip` is the hero's raw display counter (hands
where they voluntarily put money in). `roster[i].reads.vpip` is an opportunity-based count
used for modeling with prior shrinkage. They are not interchangeable.

---

## 11. Open work, roughly by value

1. **Decision-vs-baseline logging** — record, at each hero decision, what a fixed
   baseline strategy would have done and what the player chose, then measure which made
   more money. This was designed but not built. It is the only way to answer "does my
   judgement add value?" with a sample smaller than ~9000 hands
2. **Showdown-aware reads** — optionally update beliefs from revealed hands without
   leaking mid-hand information
3. **Board texture → frequencies** (and later sizing) — bots still under-react to wet vs
   dry boards; useful after recreational leaks feel solid
4. **Preflop limp guard (hero UI)** — optional mode where, first into a pot, hero only
   gets Raise/Fold (bots already limp via style)
5. **Better strength proxy** for `betLikelihood`, to close the 25%-vs-2% gap in §8.3

Explicitly **not** current priorities: LLM as primary decision maker; profiles menu;
cross-session persistence; rewriting pot/sidepot math.

---

## 12. Styles, reads, and seat dossiers

### Fixed seat styles (recreational leaks)

At `newSession`, each bot gets a permanent entry from `BOT_STYLES` aimed at
**beginner–intermediate** opponents — readable leaks, not GTO:

| tag | Role |
|---|---|
| nit | narrow opens, folds to pressure, the odd limp |
| solid | mostly raise-or-fold; limps a fair bit (`limp:0.09`) then yields to pressure |
| maniac | plays/bets too wide, limps when bored |
| selective | tight-aggressive, rare limp, disciplined boundary |
| station | limps constantly (`limp:0.48`), sticky (`fold` &lt; 1), rarely raises |

Each style: `{ open, bet, fold, limp, openSize, size, sizeJitter, callTemp,
tag, blurb }`. Hero has `style: null`. `open/bet/fold` skew ranges and
frequencies; `limp` is the probability of calling the blind after declining
to open; `openSize` is the first-in raise in big blinds; `size`/`sizeJitter`
shape all bet amounts; `callTemp` is how blurry the postflop call/fold
boundary is (station 0.055 blurry, nit 0.020 sharp). The BB defends a wider
band (`defend * 1.25`) — the blind discount is real poker, and a table where
nobody defends the blind reads dead (measured blind-panel tell).

There is no profiles menu and base styles do not change mid-session; the
per-hand *effective* style can drift with mood (below).

### Humanize layer (sizing, judgment blur, voice, mood)

Added 2026-07-31 after a blind-panel measurement scored the original bots
1–1.5/10 on "reads like a human" (evidence, verdicts, and the full design
history live in `exp/ref/`). Four mechanisms, all dial-shaped:

- **`humanSize(base)`** (inside `botDecide`): every bet/raise amount = base ×
  persona factor × jitter, integer-rounded, capped at the true all-in target
  (`myBet+myStack`). First-in opens are BB-denominated (`openSize`), 3-bets
  are pot-sized (`pot+toCall` base), re-raises build on `myBet+toCall`.
  `applyAction`'s min-raise floor is a legality backstop, never the sizer.
- **Soft call/fold boundary**: the postflop step became a logistic in the
  equity margin with per-persona `callTemp` — bad calls and tight folds now
  happen at persona-tuned rates instead of never. NOT `clampFreq`'d (it is a
  probability; the tails must stay reachable).
- **Voice** (`VOICE` bank + `say()`, inside t3's scanned slice): ~280
  slot-filled strings, 2–3 variants per slot per persona. Truthfulness is
  structural — a slot is only reachable from the branch whose facts it
  states; bluffs talk pressure, never value; a free check never speaks fold
  language. Read mentions are occasional (35%, passive decisions only) and
  tiered by evidence (`unknown/lean/solid`), never raw counters. Text bans
  (no roll talk, no counter quoting, no frequency self-narration) are
  enforced by an exhaustive static scan in `exp/t-exp.js`.
- **Mood** (`moodStep`/`moodDials`): one decaying scalar per bot driven ONLY
  by its own chip swings (public info; decay ×0.75/hand, ±25BB ≈ ±0.4,
  clamped [-1,1]). Consumed in exactly one place — per-hand effective dials
  at ctx build. Tilt loosens entries and folding and inflates sizing (caps
  1.35/1.3/1.2); rush loosens entries ONLY (a heater widens what you play,
  never how badly you call). **`open` is never scaled — what counts as a
  premium range stays a stable, teachable concept.** Mood slips into voice
  as occasional mutters when |mood| ≥ 0.3.

Decisions also carry a `dbg` field (governing roll + threshold + equity
numbers) — invisible in the UI, load-bearing for the gates: `exp/t-exp.js`
asserts every dbg roll was drawn by that decision AND that its inequality
matches the action taken.

What replacing the bots with LLM API calls would have done instead was
measured first and rejected — pre-registered experiment in `exp/PLAN.md`:
+2 points of humanness, still unanimously judged mechanical, and it
hallucinated its reasoning (fabricated narration is disqualifying when
reasons are the curriculum). Measured trajectory of this coded layer:
1.0 → 3.0 (full transcripts), 2.9 → 3.1+ (action-only), all shared-seed
pairs improved in every round; the residual gap on transcripts is the
narration format itself (finite banks repeat; no table of humans narrates
500 decisions), which the in-game player never experiences.

### Cross-hand reads

Every seat (including hero) accumulates opportunity counts from **public actions only**
inside `applyAction` — never from hole cards or showdown. Rates use prior shrinkage
(`READS_PRIOR`). Tracked patterns:

| Stat | Meaning |
|---|---|
| VPIP / PFR | voluntary money / raises preflop |
| AF | postflop bets+raises vs calls |
| foldToBet | folds when `toCall>0` (includes preflop folds facing blinds — **not** pure postflop fold-to-cbet; use `foldToCbet` for that) |
| threeBet | raises when facing exactly the open (`streetBets===1` preflop) |
| foldToCbet | folds to the preflop raiser's **flop** c-bet (`street==='flop'`, `streetBets===1`) |

When facing a bet, `step()` passes raw `facingReads` and `aggressorHadInitiative`.
Nudge strength scales with sample confidence; `threeBet` widens call frequency vs light
aggressors. Frequencies still go through `clampFreq`.

UI dossiers show confidence tiers (`unknown` / `lean` / `solid`) plus sample sizes.
`session.vpip` (hero display) and `reads.vpip` (modeling) are different on purpose —
see §10.

### UI

- **Table reads** panel — strong labels after `READS_MIN_HANDS` (30); thinner “lean”
  hints can appear earlier via `sampleTier` (`unknown` / `lean` / `solid`)
- **Seat pill + tip** — style tag on each seat; hover or tap opens a dossier
  (`playerBrief` / `readsLiveLine`: baked `blurb` + live rates with sample sizes).
  Tips shift for edge seats (`tip-left` / `tip-right` / `tip-below`) and raise
  `z-index` while open so they are not clipped or buried under neighbors
- **Export** — `buildExport` appends a `TABLE READS` snapshot (VPIP, PFR, 3-bet,
  F2cbet, F2bet, AF, sample tier)

Postflop bots also receive `inPosition` and `streetBets` in ctx (positional nudge).
Preflop unraised calls are labelled **limp** in the log/UI. BB’s preflop guide
distinguishes a limped pot from a fully unopened one.

---

## 13. Visual design

Deliberately not a green-felt casino. Aubergine table, bone cards, one restrained accent.

⚠ **Mint (`--mint`) means machine / primary action** — equity strip, pot odds, verdicts,
and also primary buttons / focus / turn chrome. Do **not** mint-decorate style pills or
dossiers; those stay muted bone/faint so measurement and seat flavor stay distinct. Don’t
“purify” the UI by stripping mint from action chrome — that chrome is intentional.

Fonts: Fraunces (display + card ranks), Inter Tight (UI), IBM Plex Mono (all numbers).
Numbers are always monospaced so columns align and digits don't shift as they update.

The **decision strip** below the table is the signature teaching element: two bars, your
equity against the equity you need. Nearly every betting decision in poker reduces to
that comparison.

⚠ No `localStorage` or `sessionStorage` anywhere — they fail in some sandboxed contexts.
Session state is in-memory only and dies on refresh, by design.
