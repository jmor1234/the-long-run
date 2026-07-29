# The Long Run — architecture & handoff

A 6-max No-Limit Hold'em trainer. Single self-contained HTML file, no build step, no
npm dependencies. Game logic runs entirely in the browser (Google Fonts may load from
the network when online). Opens locally or via the Vercel static deploy.

**Read this before changing anything.** Several design choices look like mistakes and
are not. They are marked ⚠ throughout.

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
| Bots log their real reason | The stated reason **is** the cause, so it can be trusted |
| Equity vs pot odds strip | Reduces every betting decision to one comparison |
| Full session export | Review needs the whole hand, not a memory of it |

---

## 2. File layout

**App:** `poker-trainer.html` (~1500 lines), three parts:

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

These are enforced by the test suite. If a change breaks one, the change is wrong.

### 3.1 Bots cannot see hero's cards

`botDecide(ctx)` takes a context object built in `step()`. Public fields only:

```js
{ myCards, board, street, toCall, pot, myStack, position, raisedBefore, openThr, tableSize,
  inPosition, streetBets, facingReads, aggressorHadInitiative, style }
```

Hero's cards / other hole cards are **not** parameters (except the acting bot's own
`myCards`). `facingReads` is a pre-resolved stats object — never a seat index that would
tempt a lookup into `S`. The function never touches `S` — it is pure with respect to its
arguments. That is what makes the guarantee structural rather than a promise.

`t3.js` proves this two ways: statically (the decision code contains no reference
to `isHero`, `players[0]`, `hero`, or `S.`) and at runtime, by wrapping **every** other
seat's card array in a `Proxy` that counts reads while a bot is deciding. Result must be
**zero**, with a control confirming the trap fires on the bot's own cards.

**If you add a parameter to `botDecide`, re-run t3.**

Effective frequencies for mixed actions are `clampFreq`'d into `[0.05, 0.95]`.
A true zero (e.g. never open this trash hand) stays zero — we do not invent a 5% open.

### 3.2 Chips are conserved exactly

Six players × 200 = **1200 chips, forever.** Nobody rebuys. `t2.js` and `t6.js`
assert the table total never drifts.

Historical bug worth knowing: split pots used `Math.floor` and silently destroyed the odd
chip. Fixed by awarding remainders to the player nearest the button's left, which is the
real cardroom rule.

### 3.3 An uncalled bet is a refund, not a win

If you bet 78 into someone with 73, the extra 5 forms a pot with exactly one eligible
player. `endHand` detects `pot.elig.length === 1` and returns it, labelled as a refund.
Do not let it fall through to the "wins with a full house" path — it's the player's own
money coming back.

### 3.4 Frequencies, never rules

Every bot action is `if (Math.random() < someFrequency)`. There is no spot where a bot
does the same thing 100% of the time except with the very top of its range.

⚠ **This is the most important design property in the file and the easiest to
accidentally destroy.** A bot that always folds to a re-raise teaches the player to
always re-raise — a habit that gets punished immediately by real opponents. This is the
documented failure mode of most beginner poker apps.

`tests/t4`-style checks (historical; no `t4.js` in-repo) confirmed no naive exploit beats
them: a maniac loses ~3000 bb/100, "always re-raise when bet at" loses ~2500 bb/100.

---

## 4. Hand evaluation

`evaluate(cards)` takes **any number of cards ≥ 5** (usually 7) and returns:

```js
{ cat: 0..8, tie: [descending tiebreakers] }
```

`cat` is 0 high card → 8 straight flush. Compare with `cmpHand(a, b)` → negative/0/positive.

Direct evaluation, not 21-combination enumeration — it's called thousands of times per
equity simulation.

Edge cases that are handled and have tests: the wheel (A-2-3-4-5, ace plays low), a wheel
*flush* that is not a straight flush, a full house built from two sets of trips, exact
ties splitting correctly.

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
style: null | { open, bet, fold, tag, blurb }  // bots only; fixed at newSession
reads: { hands, vpipOpps, vpip, pfrOpps, pfr, agg, passive, foldToBetOpps, foldToBet }
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
`function botDecide(ctx){` declaration line unchanged. If you rename
`renderActions`, `botDecide`, or the bootstrap call, the harness silently stops
transforming and the tests will behave strangely rather than failing loudly. This
actually happened: renaming `newHand()` to `newSession()` at the bootstrap made the
harness run a phantom session whose leftover callbacks bled into later ones, producing a
fake chip-conservation failure that took four diagnostics to trace. **If a test result
looks impossible, suspect the harness first.**

### Suites

| File | Covers |
|---|---|
| `t1b.js` | equity engine vs hand-verified draw maths |
| `t2.js` | 3000 hands: no hangs, no negative stacks, pot = money in, correct winner |
| `t3.js` | fairness — static scan + Proxy trap on **all other seats**, ctx leak check, control |
| `t6.js` | elimination, table shrinking 6→2, chip conservation, heads-up blind rules |
| `audit.js` | VPIP scope, session accounting, incomplete-raise rules, all-in labelling, reads |

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
3. **Preflop limp guard** — an optional mode where, first into a pot, the only buttons
   are Raise and Fold. Removes the decision rather than asking the player to win it every
   hand
4. **Better strength proxy** for `betLikelihood`, to close the 25%-vs-2% gap in §8.3

---

## 12. Styles, reads, and seat dossiers

### Fixed seat styles (recreational leaks)

At `newSession`, each bot gets a permanent entry from `BOT_STYLES` aimed at
**beginner–intermediate** opponents — readable leaks, not GTO:

| tag | Role |
|---|---|
| nit | narrow opens, folds to pressure, never limps |
| solid | baseline raise-or-fold |
| maniac | plays/bets too wide |
| selective | tight-aggressive, no limp |
| station | limps often, sticky (`fold` &lt; 1), rarely raises |

Each style: `{ open, bet, fold, limp, tag, blurb }`. Hero has `style: null`.
Multipliers skew open width / bet frequency / fold pressure; `limp` is the
probability of calling the blind after declining to open (soft hand band).
Stickiness/chase intensity is derived from the `fold` dial (no separate fields).
`edgeNeed` is band-clamped so extreme styles stay frequency-based.

There is no profiles menu and styles do not change mid-session.

### Cross-hand reads

Every seat (including hero) accumulates opportunity counts from **public actions only**
inside `applyAction` — never from hole cards or showdown. Rates use prior shrinkage
(`READS_PRIOR`). When facing a bet, `step()` passes pre-resolved `facingReads` and
`aggressorHadInitiative`. Nudge strength scales with sample confidence; frequencies
still go through `clampFreq`.

`session.vpip` (hero display) and `reads.vpip` (modeling) are different on purpose —
see §10.

### UI

- **Table reads** panel — confident labels once `READS_MIN_HANDS` (30) is reached
- **Seat pill + tip** — small tag on each seat; hover or tap opens a dossier
  (`playerBrief`: baked `blurb` + live read line). Tips shift for edge seats
  (`tip-left` / `tip-right` / `tip-below`) and raise `z-index` while open so they are
  not clipped or buried under neighbors
- **Export** — `buildExport` appends a `TABLE READS` snapshot

Postflop bots also receive `inPosition` and `streetBets` in ctx (positional nudge).
Preflop unraised calls are labelled **limp** in the log/UI.
---

## 13. Visual design

Deliberately not a green-felt casino. Aubergine table, bone cards, one restrained accent.

⚠ **Mint (`--mint`) is reserved for the measurement layer** — equity, pot odds, verdicts.
Nothing else uses it. That's a structural encoding: mint means *this is what the machine
computed*, not decoration. Keep it that way or the readout loses its signal. Style pills
and dossiers use muted bone/faint colors, not mint.

Fonts: Fraunces (display + card ranks), Inter Tight (UI), IBM Plex Mono (all numbers).
Numbers are always monospaced so columns align and digits don't shift as they update.

The **decision strip** below the table is the signature teaching element: two bars, your
equity against the equity you need. Nearly every betting decision in poker reduces to
that comparison.

⚠ No `localStorage` or `sessionStorage` anywhere — they fail in some sandboxed contexts.
Session state is in-memory only and dies on refresh, by design.
