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
| Bot decisions / frequencies | `botDecide` still dispatches to frozen `botPolicyV1`; opt-in `botPolicyV2` is the line-aware challenger awaiting A/B evaluation |
| Styles / limps / sizing / blurbs | `BOT_STYLES` (dials incl. `openSize`, `size`, `sizeJitter`, `callTemp`) |
| What bots *say* | `VOICE` bank + `say()` (BOT VOICE section, §12) |
| Tilt / heaters | `moodStep` + `moodDials` (MOOD section, §12) |
| Cross-hand memory | `freshReads` / `applyAction` reads block / `facingNudge` / `readLabel` |
| Table / pots / streets | GAME STATE (`step`, `applyAction`, `buildPots`, `endHand`) |
| Seats, strip, export | RENDER |
| Dossier text | `playerBrief` / `readsLiveLine` (GAME STATE) + seat tips (RENDER) |
| Tests | root `t*.js` / `audit.js` (via `harness.js`) **and** `exp/t-exp.js` + the locks (via `exp/exp-harness.js`) — keep `const botDecide=function(ctx){` literal |
| Re-measuring "does this feel human" | `exp/run-ab.js` + the frozen protocol in `exp/ref/feel-panel.md` |

### Load-bearing decisions (do not casually reverse)

| Decision | Rationale |
|---|---|
| **Frequencies, not fixed rules** | A bot that always folds to 3-bets teaches a habit that dies at a real table (§3.4) |
| **`botDecide` is ctx-only** | Fairness is structural: never read `S` or others’ hole cards; `t3.js` enforces it |
| **Coded policy, not LLM decisions** | **Tested, not assumed** (2026-07-30, `exp/PLAN.md`): an LLM arm played legally and felt marginally more human — and *hallucinated its own reasoning* (claimed draws that weren't there, said "checking" while betting). Since the stated reason is the curriculum, fabricated narration is disqualifying. It also costs offline play, free instant tests, and ~1.6 s per decision |
| **Bots feel human via texture, not intelligence** | The humanize layer (§12) — varied sizing, real mistakes, five voices, mood — came from a blind panel telling us exactly which four things read as robotic. Measured, not guessed; every claim has archived evidence in `exp/ref/`. It improved every comparison and still missed its own target — see §10 |
| **Recreational leaks, not GTO** | Target is beginner–intermediate opponents you can learn to read (limp, station, maniac), not solver-perfect play |
| **One shared reads model** | UI dossiers, export, and bot nudges share one public counter set. If bots used a richer private model, the UI would lie — review becomes theatre |
| **Priors + confidence tiers** | Small samples must not print fake certainty (`unknown` → `lean` → `solid`) |
| **No browser persistence** | `localStorage`/`sessionStorage` fail in some sandboxes; also keeps each session a clean slate (no silent carry-over). Export is the review path |
| **Mint = machine signal** | Prefer mint for equity/odds/verdicts and primary actions; never mint-decorate dossiers/style pills or the signal dilutes |
| **Percentile opens, not 5 tiers** | Old coarse tiers were 3–5× too tight vs real players (§8.1) |
| **Hero is always seat / `players[0]`** | Single-hero trainer; indexing, Proxy fairness traps, and UI assume this — don’t “generalize” seats without rewriting those |

### Quick verify after changes

```bash
bash run-all.sh    # full suite; writes disposable artifacts under exp/out/
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

**App:** `poker-trainer.html` (~1830 lines), three parts:

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
| `BOT POLICY` | stable `botDecide` dispatch seam + versioned policy implementations |
| `BOT VOICE` | persona phrase banks + `say()` — what bots tell the player |
| `MOOD` | `moodStep` / `moodDials` — tilt and heaters |
| `GAME STATE` | table, positions, betting loop, pots, styles |
| `RENDER` | all DOM writing (seats, tips, strip, export) |

(`BOT VOICE` and `MOOD` are `/* ---- */` sub-banners inside the BOT POLICY span,
not top-level sections.)

⚠ **The fairness ban-scan is positional.** `t3.js` slices from `const botDecide=function(ctx){`
to the `GAME STATE` banner, so BOT VOICE and MOOD are inside it — deliberately, since
they run during a decision. Everything above (READS' `facingNudge`, EQUITY, `pctOf`,
`handName`) and everything below is outside it, which is correct for those: they are
shared helpers, not decision-path code, and they legitimately read state a bot may not.
The rule for **new** code: anything that runs inside a bot's decision belongs in that
span. Put it above or below and it is silently unscanned.

**Repo:**

| Path | Role |
|---|---|
| `poker-trainer.html` | the app — the only file that ships |
| `harness.js` / `harness-transform.js` / `t*.js` / `audit.js` | Node test suite for the shipped app; shared harness transforms must match exactly once |
| `run-all.sh` | runs every suite **and** the two locks; exits nonzero on any failure; rewrites disposable `exp/out/` artifacts |
| `exp/` | measurement toolkit (see below) — never deployed (`.vercelignore`) |
| `vercel.json` | `/` → `poker-trainer.html` |
| `ARCHITECTURE.md` / `README.md` | handoff + how to run |

**`exp/` — the measurement side.** Built for the LLM-bot experiment, kept because it
is how any behavioral claim about the bots gets proven:

| Path | Role |
|---|---|
| `exp-harness.js` | seeded harness: keyed RNG streams, `htmlPath` to load *another* engine build (cross-version A/B), asserted source rewrites |
| `t-exp.js` | the behavior gate suite (sizing, boundary blur, roll governance, voice bans, mood, oracle, determinism) |
| `run-probes.js` | exploitability LOCK — degenerate heroes must keep losing badly |
| `run-labels.js` | readability LOCK — bots must stay as legible as before |
| `run-ab.js` | blind A/B packets, old engine vs current; `--action-only` for play-only blocks (the headline instrument), default for full transcripts |
| `run-baseline.js` | persona frequency bands + split-half + transcripts (produced the frozen bands) |
| `run-feel.js` | the original LLM-vs-coded packet, superseded by `run-ab.js` for engine-vs-engine |
| `ref/` | **frozen evidence** — panel verdicts, baselines, the LLM pilot's paid decisions, the judging protocol. Preserved history: never regenerate into it |
| `PLAN.md` / `README.md` | the pre-registered experiment and its concluded verdict |
| `prompt.js` `oracle.js` `legality.js` `spend.js` `run-pilot.js` `metrics.js` `prng.js` | LLM-arm machinery — the experiment concluded, kept as the record of how it was run |

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
{ myCards, board, street, toCall, pot, myStack, myBet, position, raisedBefore, openThr,
  tableSize, inPosition, streetBets, legal, opponents, facingReads,
  aggressorHadInitiative, style, mood }
```

`tableSize` is passed today but unused inside `botDecide` (kept for call-site symmetry /
future HU logic — don’t invent policy around it without need). `myBet` is this bot's own
chips already in on this street — needed so a bet-to total can reach the true all-in
target (`myBet+myStack`) instead of understating it. `style` is the **effective** style
for this hand (base dials filtered through mood, §12); `mood` is the raw scalar, passed
only so the voice layer can mutter about it. Both are derived from public information —
the bot's own chip swings — so neither weakens the guarantee below.

Hero's cards / other hole cards are **not** parameters (except the acting bot's own
`myCards`). `facingReads` is the aggressor’s **raw** `roster[].reads` counters (not
pre-shrunk, never a seat index into `S`). Shrinkage / nudge math runs inside
`facingNudge`. The function never touches `S` — it is pure with respect to its
arguments. That is what makes the guarantee structural rather than a promise.

`legal` is the exact action and call-price snapshot returned by `legalActionView`.
`opponents` contains only detached `{cap, bets}` range descriptors. Each `bets` entry
is a cloned public board as it existed when that opponent bet or raised. `t3.js`
recursively allowlists this nested schema, proves every event is a prefix of the public
board, mutates the copies to prove detachment, and directly runs Policy B while every
foreign hole-card array is trapped.

**Return shape** (what the engine action controller consumes):

```js
{ action: 'fold'|'check'|'call'|'bet'|'raise', amount?: number, reason: string,
  pct?: number, dbg?: {…rolls, thresholds, equity} }
```

`amount` is required for `bet`/`raise` (total chips to put in / raise-to sizing as the
call site expects). The controller attaches the current `actionSeq`; policy code never
invents it. `applyAction` then validates the actor, turn revision, verb, and exact amount
against `legalActionView` before touching chips, reads, logs, or action state.

`dbg` never reaches the UI — it carries the roll that decided this branch plus the
threshold it was compared against, so tests can assert the stated randomness actually
governed the action (§12). **A new stochastic branch should carry its roll and
threshold in `dbg` — and then register it in two places in `exp/t-exp.js`: the `ROLLS`
name list (§3d) and a roll/threshold clause in the governance block (§3g).** The gate
reads hardcoded names, so an unregistered branch passes invisibly; see §9.

Policy A has five aggressive sites: preflop open, premium 3-bet, bluff 3-bet,
postflop strong raise, and postflop bluff raise. Every one guards short calls and caps
at `myBet+myStack`. Policy B delegates the three preflop sites and gates both of its
postflop sites on `legal.aggressive`, so a closed raise can never be proposed. The
crafted short-stack and raise-closed tests keep both forms structural.

`t3.js` proves fairness two ways: statically (the decision code contains no reference
to `isHero`, `players[0]`, `hero`, or `S.`) and at runtime, by wrapping **every** other
seat's card array in a `Proxy` that counts reads while a bot is deciding. Result must be
**zero**, with a control confirming the trap fires on the bot's own cards.
Note: the static ban list is narrow — do not reach for `roster` or other globals either.

**If you add a parameter to `botDecide`, re-run t3.**

Effective frequencies for mixed actions are `clampFreq`'d into `[0.05, 0.95]`.
A true zero (e.g. never open this trash hand) stays zero — we do not invent a 5% open.

### 3.2 Chips are conserved exactly — **tested (`t2.js`, `t6.js`, `t-settlement.js`)**

Six players × 200 = **1200 chips, forever.** Nobody rebuys. `t2.js` and `t6.js`
assert the table total never drifts.

Historical bug worth knowing: split pots once used `Math.floor` and silently destroyed the
odd chip. Remainders now start with the tied winner nearest the button's left, with a tied
button last. `t-settlement.js` locks the exact 2-to-1 award from a three-chip tied pot.

### 3.3 An uncalled bet is a refund, not a win — **tested (`t-settlement.js`)**

If you bet 78 into someone with 73, the extra 5 forms an unmatched layer and is returned.
It was never live money. `buildPots` carries both `contributors` and showdown `elig` for
each layer: exactly one contributor means refund; multiple contributors with one eligible
player means matched folded money and is awarded as a win. Fold endings and showdowns use
that same rule. Logs, review copy, and saved hand histories preserve the distinction.

### 3.4 Frequencies, never rules — **design intent (no `t4.js` in-repo)**

Every mixed action (opens, bets, bluff-raises, limp rolls, preflop continues) is
`if (draw() < someFrequency)`. **The postflop call/fold boundary is too**, since the
humanize pass: it is a logistic on the equity margin with a per-persona `callTemp`,
rolled like everything else (§12). It used to be a hard threshold — a bot literally
could not make a bad call — and that was the single largest "reads like a robot"
finding in the blind panel. Do **not** reintroduce deterministic always-do-X spots
(especially always-fold-to-3bet / always-fold-to-cbet).

⚠ **This is the most important design property in the file and the easiest to
accidentally destroy.** A bot that always folds to a re-raise teaches the player to
always re-raise — a habit that gets punished immediately by real opponents. This is the
documented failure mode of most beginner poker apps.

**One draw per choice.** Each stochastic decision point calls `draw()` for itself.
This is not style: `botDecide` once shared a single `roll` across every branch, so one
low number made a bot open *and* limp *and* bet *and* bluff-raise in cascade —
frequencies that were individually right produced correlated, machine-looking lines.
The gate in `exp/t-exp.js` asserts a limp-band decision consumes two *distinct* draws;
a shared-roll regression collapses them to one and fails. (This is also why the file
has exactly 4 `Math.random()` sites, not more: every decision draw routes through the
one `draw()` helper.)

⚠ `EXPECTED_RAND_SITES=4` in `exp/exp-harness.js` is a deliberate tripwire, and
the obvious response to it is wrong. Engine randomness is legal in exactly four
places: deck shuffle, equity Monte Carlo, the `botDecide` `draw()` helper, and
the button seat. A `Math.random()` anywhere else throws a clear count error —
**route the draw through `draw()`; do not raise the constant.** Bumping it just
moves the failure to a `strayDraws` assertion whose message doesn't point back
at your edit.

**Exploitability is enforced, not assumed.** `exp/run-probes.js` runs degenerate hero
strategies (always-raise, call-station, always-3bet, check-fold) against the table and
**fails the build** if any stops losing badly. The thresholds (−550/−500/−390/−18
bb/100) are ~50% of the margins measured at `6cd6b29` — the numbers in the script's
own comment — which is ~55–65% of PLAN.md's older frozen baseline; **re-freeze both
sets alongside any deliberate dial change.** Either way there is enough headroom that
a real erosion trips the lock long before the bots become beatable, which is what lets
the humanize dials (looser calls, tilt, wider limps) be tuned without quietly turning
the table into a cash machine.

---

## 4. Hand evaluation

`evaluate(cards)` ranks a complete poker holding of **5 or more cards** (usually 7) and
returns:

```js
{ cat: 0..8, tie: [descending tiebreakers] }
```

`cat` is 0 high card → 8 straight flush. Compare with `cmpHand(a, b)` → negative/0/positive.

Direct evaluation, not 21-combination enumeration — it's called thousands of times per
equity simulation.

Edge cases that are **handled in code** (not covered by dedicated `evaluate` unit tests —
`t1b` is equity Monte Carlo, `t2` is table integrity): the wheel (A-2-3-4-5, ace plays
low), a wheel *flush* that is not a straight flush, a full house built from two sets of
trips, exact ties splitting correctly. `betLikelihood()` also calls the same function on
a 3- or 4-card board as a coarse partial-board category comparison. That internal use is
a heuristic, not a complete poker-hand evaluation.

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
style: null | { open, bet, fold, limp,               // bots only; FIXED at newSession
                openSize, size, sizeJitter, callTemp,
                tag, blurb }
mood: 0        // bots only; MUTATES each hand from this bot's own chip swing (§12)
reads: {
  hands,
  vpipOpps, vpip, pfrOpps, pfr,
  agg, passive,
  foldToBetOpps, foldToBet,
  threeBetOpps, threeBet,
  foldToCbetOpps, foldToCbet
}
```

`style` is the bot's permanent identity; `mood` is the only per-bot state that drifts
during a session, and `endHand` is the only place that writes it. The *effective* style
a bot decides with is `moodDials(style, mood)`, computed fresh at ctx build — the stored
dials are never mutated, so a bot's identity survives any tilt.

Per-hand `S` also tracks public action for bots: `streetBets`, `streetAggressor`,
`preflopRaiser` (reset on street advance as appropriate).

Each per-hand player owns one public range record: `p.range={cap,bets}`. `newHand`
initializes it and `applyAction` is its only action-driven writer. Preflop calls and
raises narrow `cap` for every actor, including hero. Postflop calls do not alter the
preflop cap; each postflop bet or raise appends a cloned board snapshot to `bets`.
`rangeSnapshot` is the sole projection into both `step` and `updateStrip`, so Policy B
and the teaching strip cannot drift onto different betting stories.

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

### Legal action boundary

`legalActionView(p)` is the one runtime source of truth for action legality. It returns
the effective call, canonical passive actions, and either no aggressive action or exact
minimum/maximum bet-to bounds. Hero controls render from it. Bot decisions are checked
against it. `applyAction` recomputes it and rejects malformed, stale, out-of-turn, or
out-of-range input with no mutation. A successful action increments `S.actionSeq`, so a
decision cached for an earlier turn cannot become valid again when the same player acts
after an incomplete all-in. Aggression is absent unless another opponent can contest at
least one chip above the current wager, so the engine cannot create an empty side pot.

Policy A predates the strict boundary and occasionally emits an integer just below the
minimum raise. `policyActionForView` is the trusted client adapter: it fits only a
canonical aggressive Policy A amount to the view's min/max bounds before submission.
This preserves the old engine's legal sizing behavior without weakening `applyAction`;
unknown verbs, non-integer amounts, forbidden raises, and every external caller still
fail closed.

### Betting round completion

`bettingDone()` is true when every player who can still act has acted **and** matched
`S.currentBet`. The big blind starts with `acted = false` so it gets its option.

---

## 6. Incomplete raises

An all-in for **less than a full raise** raises the price to call but does not reopen the
right to raise for players who already acted. Those players still get another action if
they owe chips, but their legal choices are call or fold. The engine correctly leaves
`minRaise` unchanged and does not clear their `acted` flags:

```js
const inc = p.bet - S.currentBet;
const fullRaise = inc >= S.minRaise;
S.currentBet = p.bet;              // the bet to match does go up
if (fullRaise) {                   // but only a legal raise reopens action
  S.minRaise = inc;
  S.players.forEach(o => { if (o !== p && !o.folded && !o.allIn) o.acted = false; });
}
```

Raise rights are derived from `actedAtBet`, the bet level a player last acted against. A
single short all-in therefore returns a prior actor to call or fold without offering a
raise. If several short all-ins cumulatively increase the wager by at least `minRaise`,
raising reopens for a player who has faced that full cumulative increase. Players who
have not acted retain their raise right. `t-legal.js` covers all three cases with literal
bounds and zero-mutation rejection checks; `audit.js` retains the original regression.

---

## 7. Side pots

`buildPots()` layers by each player's total `invested`:

1. Collect distinct investment levels, ascending
2. For each level, sum every player's contribution *within that band*
3. Contributors = invested ≥ that level
4. Eligible = contributor **and** not folded

Before any settlement mutation, `endHand` verifies that layer amounts equal `S.pot` and
every layer has an eligible player. Invalid state throws before `S.done`, stacks, logs, or
session records change. Folded players still contribute chips to matched layers — that is
correct.

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

`equity(mine, board, opps, iters)` where each opponent is `{ cap, bets }`:

- `cap` is the percentile ceiling inferred only from preflop calls and raises
- `bets` contains the public board snapshot for each postflop bet or raise, in order

`betLikelihood(hole, eventBoard)` mirrors the bots' broad betting frequencies. Each
sampled opponent hand receives the product of those event weights, evaluated on the
board that actually existed at each decision. This matters across streets: applying a
flop bet again to the river board invents information the bettor did not have. Weighted
scoring also avoids discarding almost every sample after a long aggressive line.

Capped ranges precompute their eligible two-card combinations once per equity call.
Multiway samples draw a complete tuple and reject the whole tuple when cards collide;
resampling only the later seat would bias the result through blockers and descriptor
order. Rejection is bounded, and an iteration is skipped if no compatible tuple is
found. Fully uncapped ranges keep the direct shuffled-deal path.

⚠ Known imprecision: the in-browser version uses hand *categories* as a strength proxy
rather than a nested simulation, for speed. It gets the decision right (25% vs 32% needed
→ fold) but understates how bad the spot is (truth ≈ 2%). Improving this means a faster
strength estimator, not a different formula.

Cost is ~8ms per readout. Don't raise the iteration count without measuring.

`t-equity.js` is the canonical oracle for this path. It owns deck construction,
heads-up opponent combinations, turn runouts, exact weighting, and expected shares;
production supplies only the scoring primitive after a compact literal evaluator
contract checks every hand category, the wheel, two-trip full houses, and a board-only
tie. General exact enumeration is deliberately heads-up only because multiway growth
is combinatorial. Bounded three-way river fixtures independently enumerate constrained
joint ranges; a royal-flush board still proves every legal three-way deal splits one
third, and an AA-only opponent proves the second descriptor is not dropped. Seeded
Monte Carlo bands are fixed regression bounds, not confidence intervals.

### 8.4 Short all-in prices use only contestable chips

`callPrice(player)` is the shared source for the legal call amount and the decision
strip's pot odds. It caps the player's total post-call investment, then sums every
player's `invested` chips only up to that cap. Folded chips below the cap still count;
deeper chips do not, because this player cannot win them. The break-even fraction is:

```text
effective call / (contestable existing pot + effective call)
```

`legalActionView` exposes the complete `callPrice` snapshot and puts the effective amount
on the call descriptor. `applyAction`, the teaching strip, and Policy B's non-layered
decisions all consume that same snapshot, so their price cannot drift.
When the call is a short all-in, the strip names both the contestable pot and chips above
the player's cap. It does not call the deeper chips a refund or a side pot because either
can be true depending on other contributors. `t-teaching.js` fixes the arithmetic with
literal heads-up and multiway cases, including prior-street investment where `bet` and
`invested` differ. If a shallower opponent is already all-in, different pot layers have
different eligible opponents. The strip then says `layered pot` and withholds the single
equity threshold and call/fold verdict; pretending one whole-pot percentage prices every
layer would be false. Policy B explicitly defers these spots to Policy A until a
separate per-layer EV model and oracle exist; it does not disguise scoop equity as
layer-aware strategy. The suppressed readout still
performs the existing equity draw:
equity Monte Carlo and gameplay currently share `Math.random`, so skipping those draws
would silently change later deals and bot decisions. `t-teaching.js` guards that sequence.

---

## 9. Testing

Commands: see §0. Node ≥ 18, no dependencies.

`run-all.sh` requires a POSIX shell or an installed WSL distribution. On Windows
without WSL, run the Node scripts listed in that file directly. If reproducing its
failure scan in PowerShell, use the case-sensitive operator:

```powershell
$hasFailure = @(
  $output | Where-Object { $_ -cmatch '(^|[^A-Za-z])(BUG|FAIL)' }
).Count -gt 0
```

PowerShell's default `-match` is case-insensitive and falsely treats ordinary text
such as "fails closed" as the uppercase `FAIL` sentinel. Capture `$LASTEXITCODE`
immediately after each Node process as the other failure signal.

### How the harness works

`harness.js` extracts the `<script>` body from the HTML, applies surgical string
replacements, and evaluates it as a function with a fake DOM:

1. `renderActions()` → `HERO_ACT()` so a test can drive hero programmatically
2. wraps `botDecide` with `BOTFLAG` + `SETCTX` so card access can be trapped and the
   last ctx inspected
3. instruments the `equity` entry point with `EQUITY_CTX` so integration tests can
   inspect the exact range descriptors supplied by live rendering
4. strips the bootstrap call so tests control when a session starts

⚠ **The transforms are string matches against the app source.** Keep the literal
`const botDecide=function(ctx){` declaration line unchanged. `harness-transform.js`
requires every anchor to match exactly once, so a missing or duplicated hero hook,
bot wrapper, equity hook, bootstrap strip, RNG stream hook, or experiment ctx extension throws
before the engine runs. `t-harness.js` proves the root harness fails closed and that
its injected hooks execute. This guard exists because a bootstrap rename once made
the harness run a phantom session whose leftover callbacks produced a fake
chip-conservation failure. **If a test result looks impossible, suspect the harness
first.**

### Suites

| File | Covers |
|---|---|
| `t-harness.js` | source-transform guards: current source builds, missing/duplicated anchors throw, bootstrap stays inert until explicitly started, hero, bot, and equity hooks execute |
| `t-policy.js` | Policy A source hash + exact dispatcher lock; seeded direct-vs-dispatched traces include actions, reasons, RNG draws, deals, logs, stacks, reads, mood, and session state |
| `t-policy-b.js` | Policy B preflop delegation, chronological line effect, live legal price, no draw double-count, all-live-opponent use, layered fallback, hero evidence, and opt-in seeded execution |
| `t-legal.js` | independent legal-action oracle: complete call-price snapshot, exact min/max bet-to bounds, short and cumulative all-ins, raise rights, stale revisions, malformed input, and byte-identical state on rejection |
| `t-teaching.js` | literal call-price oracle: full and short calls, total-investment caps across streets, folded dead money, deeper side-pot layers, layered-verdict suppression, rendered copy, purity, and RNG alignment |
| `t-equity.js` | literal evaluator contract + exact heads-up river/turn oracle, capped heads-up and joint multiway sampling, chronological weighting, multiway inclusion and second-line weighting, purity, wrapper defaults, and live two-street range wiring |
| `t-settlement.js` | independent literal pot-award oracle against real `endHand`: fold/showdown refunds, matched folded money, main/side recipients, odd chips, review/export wording, conservation, and mutation-free invalid-state guards |
| `t1b.js` | five hand-verified heads-up draw estimates through `evaluate`/`cmpHand`, via its own unseeded Monte Carlo. Direct equity-pipeline coverage lives in `t-equity.js`. This suite bypasses `harness.js` and slices the source itself between `const SUITS` and `function drawInfo`; don't rename or reorder those |
| `t2.js` | 3000 hands: no hangs, no negative stacks, pot = money in; winner check is a narrow log heuristic, not a full pot-award oracle |
| `t3.js` | fairness: static scan, Proxy trap on every other seat for both policies, recursive opponent-schema allowlist, descriptor detachment, and control |
| `t6.js` | elimination, table shrinking 6→2, chip conservation, heads-up blind rules |
| `audit.js` | VPIP scope, session bb, incomplete raises, styles/limps, forced 3-bet & fold-to-cbet spots |
| `exp/t-exp.js` | seeded-harness gate suite, two halves: **humanize** (sizing spread + raw coded-policy sizes observed through the independent legality normalizer, boundary blur persona-shaped by *rate*, dbg-roll drawn-and-governs, short-stack never raises, exhaustive VOICE text-ban scan, mood arithmetic vs a hand-computed table + call-site fidelity) and **experiment infrastructure** (determinism, stream isolation, cross-arm deal identity, oracle replay, legality unit + engine integration, prompt purity) |
| `exp/run-probes.js` | exploitability LOCK: degenerate heroes must lose ≥ hardcoded bb/100 thresholds (see §3.4 for the numbers and their baseline), nonzero exit |
| `exp/run-labels.js` | readability LOCK: per-persona dossier labels at hand 31 within 10pp of the pre-humanize engine, measured at 90 sessions (at 30, one label = 3.3pp against ~8pp of noise, so the lock bounced personas across its own line). Two personas sit within 1pp of their bound **by construction** — a marginal failure here is expected sensitivity, not automatically a regression; re-measure the old engine with `--html`/`--sites` before assuming |

All of the above run in `run-all.sh`, which exits nonzero on any suite failure
or BUG/FAIL line (every suite sets a real exit code — added when it was
discovered none did). It is not read-only: `exp/t-exp.js` removes and recreates test
directories, and the two locks overwrite their matching scratch files under `exp/out/`.

⚠ **Where the gates are wired — green does not always mean enforced.** Two
limitations are by design and one is a real gap; know all three before trusting a
clean run:

- **The two locks arm only at their frozen default config.** `run-probes.js`
  enforces at 30×200/`probe1`, `run-labels.js` at 90 sessions/`label1`. At any
  other `--sessions`/`--hands`/`--seed` they print `lock skipped: exploratory
  config` and exit 0 — a line containing neither BUG nor FAIL, so the grep belt
  passes too. **Never speed `run-all.sh` up by passing those flags**; you would
  silently disarm both.
- **The `dbg` governance gate reads hardcoded name lists**, not the field
  generically: `ROLLS` in t-exp §3d and six explicit (roll, threshold) pairs in
  §3g. A new stochastic branch that declares `dbg` perfectly is still invisible
  to the gate unless you add it in both places. Three low-volume branches
  (spew-call, preflop bluff-3-bet, postflop bluff-raise) predate the rule and
  carry partial or no `dbg` — the gate covers six pairs, not every branch.
- **`SB=1, BB=2, START=200` are frozen measurement units.** `START` is pinned by
  t2/t6 (1200 chips). `BB` is guarded by nothing, yet it is the denominator of
  every bb/100 in PLAN.md, both probe-lock thresholds, and the judge prompt's
  "blinds 1/2". Change it and the probe lock fails with a message that reads
  "the bots became beatable"; re-freeze all three number sets if you ever do. Every test in `exp/` runs on a **seeded** harness
(`exp/exp-harness.js`: keyed RNG streams, `htmlPath` for cross-version A/B);
the Math.random site count lives in ONE place, its `EXPECTED_RAND_SITES`
export. Frozen evidence is tracked in `exp/ref/`. Two kinds, don't conflate them:
**pre-humanize measurements** (baseline metrics/probes/labels, the feel key whose
packet is regenerated on demand, and the paid LLM pilot records) and **old-vs-new
panel results** whose `new` arm is a humanize-arc commit
(`feel-panel-ab1/ab2/bare/final.json`).
Either way it is history: new outputs are expected to diverge, never "fix" that.
⚠ Nothing enforces this — no test, no ignore rule, and every runner writes to
`exp/out/` under the *same filename* as its `ref/` counterpart, so a careless copy
overwrites archived evidence. `exp/ref/` is git-tracked, so `git checkout --
exp/ref/` recovers an uncommitted clobber. The one genuinely irreplaceable file is
`pilot-api-pilot1.jsonl` (paid, ~$0.90, cannot be re-derived); everything else is a
cheap re-run, or reproducible against an older build via `--engine`/`--html` — older
engines are always one `git show` away, which is how `run-ab.js` works. It also
holds every panel's answer key, which is why a judge gets one block file and never
repo access.

⚠ Several expectations in `t1b.js` look wrong and are not — they have comments
explaining why (e.g. a set is ~75% against a flush draw, not 66%, because it redraws to a
full house). Verify by hand before "correcting" them.

---

## 10. Known limitations

### Confirmed implementation gaps, not design decisions

- **Policy A short-stack decisions:** frozen Policy A still uses the full `toCall` and
  undifferentiated pot when a bot cannot match the wager, so its call boundary can be
  wrong. Action controls, execution, and the teaching strip now share the exact effective
  call; the strip also excludes deeper layers that hero cannot win. Opt-in Policy B uses
  that legal price in non-layered spots and explicitly defers layered spots, but Policy A
  remains the shipped default until the A/B gate.
- **Policy A equity use:** `t-equity.js` now constrains `equity()`, `betLikelihood()`,
  range weighting, and the live strip wiring. Policy A still takes
  `strengthVsRandom()` after it has simulated the future runout, then adds flush- and
  straight-draw bonuses again. Opt-in Policy B instead consumes chronological public
  range records and uses range-conditioned runout equity exactly once. The baseline is
  intentionally unchanged until paired evaluation establishes whether B should ship.
- **Browser UX:** the decision strip is refreshed only when hero controls render, so old
  guidance can remain during review or early in the next hand. Training-wheel switches
  and seat dossiers are not keyboard controls, dynamic state has no live-region
  semantics, and fixed seat/card sizing is not verified on narrow phones.

Correctness gaps above take precedence over the product backlog in §11. Fix each as a
small behavior increment with an independent oracle; do not rewrite the working state
machine or pot layering wholesale.

**Showdown cards are not in the reads model.** Reads update from public actions only
(fold/call/bet/raise). Revealed hole cards at showdown are ignored in v1 so the
action/card boundary stays clean for fairness tests.

**Range inference is crude.** `cap` narrows on a preflop raise (to the raiser's
`openThr`), on a postflop bet/raise (to 32), and on any call (55 preflop / 60
postflop). It never widens, and it ignores board texture and bet sizing.

**No rake.** Real games take a cut; win rates here are optimistic by a couple of bb/100.

**No cross-session memory.** Reads, styles and moods live in RAM for one session;
refresh clears them. There is no profiles menu — bot *identity* is fixed seat styles
baked at `newSession` (only mood drifts within a session).

**The bots still read as bots.** The final archived action-only panel scored humanize
commit `4c4f544` at 3.00/10 against a target of 5. That is historical evidence, not a
literal measurement of current HEAD after the later correctness and voice fixes. Two
known causes remain: over a long session the finite phrase
banks repeat lines verbatim, and two seats of different personas are still more
distinguishable than two different *people* would be. §12 has the full diagnosis —
including why much of the measured gap is a property of the transcript format rather
than of play. Anyone claiming to have fixed this should re-measure with
`exp/run-ab.js` rather than assert it.

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

**Humanize backlog** — considered and deliberately deferred during the §12 work, each
gated on evidence that it's worth the complexity (blind-panel score, or your own play):

6. **Misread model** — a bot mis-evaluates its own hand strength and then plays *and
   talks* consistently wrong about it. Ruled allowed-in-principle (a human misreading a
   board is real poker, unlike the LLM arm narrating actions it didn't take) but never
   built; it needs its own increment and its own measurement
7. **Per-seat trait DNA** — two bots of the same persona jittered to differ. Refused so
   far because fixed, learnable archetypes *are* the curriculum; revisit only if seat
   individuation beats seat legibility for a real player
8. **Multiway awareness** — `strengthVsRandom` evaluates against exactly **one** random
   hand no matter how many players are live, and the `multiway` factor is misnamed: it
   keys off bets this street (`streetBets >= 2`), not opponent count. ⚠ Don't "fix" the
   name without fixing the model. Deferred, but note the dissent: one of the three
   designs shipped a `liveOpps` bound specifically as the safety valve for
   mood-loosening ("without it, tilt produces absurd five-way spew"); the other two
   ruled it out of scope, and the exploitability lock has not fired since. Build it if
   looser dials ever trip the probes
9. **Deeper table texture** — the action-only panel still cites thin blind defense and
   too few contested pots; this is the largest remaining measured gap

**Settled rejections — reasons attached, so they don't get re-litigated:**

| Rejected | Why |
|---|---|
| LLM as decision maker *or* narrator | Measured and rejected: hallucinated reasoning (§0, `exp/PLAN.md`) |
| `style.misread` — bots holding false beliefs about their own hand | Violates truthful-reasons; that is why bot error comes from the soft boundary and mood, never from corrupting the strength estimate. Allowed *in principle* as item 6 above, but only with its own increment and measurement |
| Splitting `READS_PRIOR`, or doubling `facingNudge`'s coefficients | Creates a second source of truth for "how much evidence counts as evidence"; "the bot's gut is looser than the UI admits" reintroduces exactly the fake certainty the shrinkage prior exists to prevent |
| Narrating mood in the UI (`readsLiveLine`) | An explicit "steaming" label hands the learner the read the prose is meant to teach them to make |
| A no-repeat phrase ring | Humans repeat themselves; two independent designs refused it. Fix bank *depth* instead |
| Tracery-style grammars, Perlin noise, an N×N grudge matrix, mid-session style mutation, showdown-derived state, decision-latency simulation | All considered during the humanize design and cut as complexity that no measurement asked for. A single grudge/nemesis slot was unanimous across all three designs and still deliberately not built — it had no defined behavioral consumer |
| Profiles menu, cross-session persistence, `localStorage` | §0 — sandbox failures plus clean-slate sessions |
| Wholesale pot/side-pot rewrite | Rejected. The existing layered structure was retained; contributor metadata plus the independent award oracle fixed recipient, remainder, and refund semantics surgically (§3.2-3.3, §7) |

---

## 12. Styles, reads, and seat dossiers

### Policy A boundary

`botDecide(ctx)` is the stable controller entry point. It currently delegates directly
to `botPolicyV1(ctx)`, whose body is the coded policy preserved from commit `15dbbb4`.
`t-policy.js` locks that source body and the exact one-line dispatcher, then runs both
paths inside the guarded experiment harness over the same keyed decision streams and
requires their complete traces to match. Shared engine helpers remain outside the
policy version, so later correctness fixes apply equally to Policy A and any challenger.

`botPolicyV2` lives after the shared voice and mood helpers so it cannot enter the
Policy A hash span. It delegates all preflop decisions to V1 and replaces only the
postflop assessment. `exp/exp-harness.js` selects it explicitly with `policy:'v2'`;
the shipped dispatcher remains byte-identical to Policy A. `t-policy-b.js` constrains
the challenger before the paired evaluation decides whether the dispatcher should move.

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
nobody defends the blind reads dead (measured blind-panel tell). Likewise every
persona now limps: nit and selective sat at `limp:0.00`, so three of five bots
were structurally incapable of entering a pot without raising — the mechanical
origin of the judges' "27 hands of perfect raise-or-fold" tell — and `spewCall`
replaced what used to be an unconditional preflop fold. **Tightening these back
up for "better play" restores a measured defect.**

There is no profiles menu and base styles do not change mid-session; the
per-hand *effective* style can drift with mood (below).

⚠ **Tune dials as a set, not one persona at a time.** `exp/t-exp.js` asserts
cross-persona *orderings*, not absolute values: mean open size station < nit <
solid ≈ selective < maniac; postflop bet/pot maniac > solid > nit; and station's
boundary-error rate ≥ 2× nit's (a constraint on the `callTemp` **spread**,
0.055 vs 0.020, not on either number alone). Retuning one persona routinely
fails a gate about a persona you never touched — that is the gate working.

### Humanize layer (sizing, judgment blur, voice, mood)

Added 2026-07-30 after a blind-panel measurement scored the original bots
1–1.5/10 on "reads like a human" (evidence, verdicts, and the full design
history live in `exp/ref/`). Four mechanisms, all dial-shaped:

- **`humanSize(base)`** (inside `botPolicyV1`) = base × jitter, integer-rounded,
  floored at 2. The persona `size` multiplier is applied **by the caller** to
  postflop bets and 3-bets/re-raises; first-in opens skip it and are sized by
  `openSize` in **big blinds** (2.4–3.4×), because preflop the pot is just
  blinds and limps — a pot fraction there is a near-constant tiny number that
  would flatten the whole persona spread, and BB multiples are the unit real
  charts use. Once there is money in, pot-relative is the meaningful measure:
  3-bets use `pot+toCall`, re-raises build on `myBet+toCall`. Every call site
  clamps to the true all-in target `myBet+myStack` — never bare `myStack`.
  ⚠ **The engine action boundary rejects an under-minimum size; it never sizes for the
  policy.**
  Two historical collapse points prove why: a `Math.max(6, …)` open floor made
  every open "raises to 6", and letting the clamp catch under-min 3-bets snapped
  every one to exactly 10. Uniform sizing was the single most-cited judge tell.
  Policy A's trusted client fits its occasional below-floor integer to the engine-owned
  descriptor, preserving the historical legal floor without moving that behavior back
  into `applyAction`. `t-legal.js` proves the adapter lands on the literal minimum and
  that the engine itself still rejects an under-minimum submission without mutation.
  (Uniform sizing was the most-cited tell on the *action-only* panels, where play
  is all a judge can see; on full transcripts the narration dominated instead.)
- **Soft call/fold boundary**: the postflop step became a logistic in the
  equity margin with per-persona `callTemp` — bad calls and tight folds now
  happen at persona-tuned rates instead of never. NOT `clampFreq`'d (it is a
  probability; the tails must stay reachable).
- **Voice** (`VOICE` bank + `say()`, inside t3's scanned slice): ~280
  slot-filled strings, 2–3 variants per slot per persona. **Why the strings
  are policed so hard:** the rejected LLM arm was disqualified for narrating
  things that never happened, and a bot that lies about its own hand teaches
  the player a false read. So truthfulness here is structural — a slot is
  only reachable from the branch whose facts it states, and a variant may
  claim only what that branch established (an `airBet` knows its equity is
  low, NOT that it holds no pair — the strings are worded to the branch's
  actual knowledge); bluffs talk pressure, never value; a free check never
  speaks fold language (emission-tested). Read mentions are occasional (35%,
  passive decisions only) and tiered by evidence (`unknown/lean/solid`),
  never raw counters. Text bans are enforced by an exhaustive static scan in
  `exp/t-exp.js` that feeds each slot only its real call-site fields — so a
  variant referencing a field its branch never passes renders a literal
  `undefined` in the test instead of shipping. A **new slot** also needs a
  `FIELDS` entry there or the gate fails with "unmapped slot".
  ⚠ The banned patterns are `/roll/i`, `/\d+ of \d+/`, `/% of the time/i`,
  `/\bbranch\b/i`, `/\bhero\b/i`, `/Math\./`. Two are traps for poker-literate
  writers: "hero call" is normal jargon and "on a roll" is the obvious heater
  line. And because VOICE sits inside t3's scanned slice, a phrase containing
  "hero" fails **t3** with *"decision code contains no reference to you"* —
  which reads like a fairness breach but is a phrase-bank typo.
  ⚠ `say()` is declared once, deliberately: a duplicate declaration shadowed
  it for three commits (hoisting), silently killing a third of the bank.
- **Mood** (`moodStep`/`moodDials`): one decaying scalar per bot driven ONLY
  by its own chip swings (public info; decay ×0.75/hand, ±25BB ≈ ±0.4,
  clamped [-1,1]). One behavioral consumer — the per-hand effective dials at
  ctx build (the raw scalar also reaches ctx so voice can mutter about it,
  but nothing else reads it). Tilt widens entries (`limp` ×, cap 1.35),
  loosens folding (`fold` ÷, cap 1.35), raises aggression (`bet` ×, cap 1.30)
  and inflates sizing (`size` ×, cap 1.20); `limp` is additionally hard-capped
  at 0.6 absolute. Rush widens entry (`limp`) only — a heater
  makes you play more hands, it does not make you call down worse.
  The expected-value table that gates `moodStep` (`exp/t-exp.js` §3f) is
  **hand-computed from the constants** and deliberately not derived from the
  code — if you retune the decay or scale, re-derive those four numbers by
  hand; pasting them out of a run turns the repo's one independent oracle
  into an idempotency check.
  **`open` is never scaled — what counts as a premium range stays a stable,
  teachable concept, or the lesson moves whenever a bot runs bad.** Mood
  slips into voice as occasional mutters when |mood| ≥ 0.3.

Decisions also carry a `dbg` field (governing roll + threshold + equity
numbers) — invisible in the UI, load-bearing for the gates: `exp/t-exp.js`
asserts every dbg roll was drawn by that decision, and that the six
highest-volume roll/threshold pairs (open, premium 3-bet, defend, bet,
strong-raise, edge call) decide their branch — inequality vs action taken,
guard-aware.

**Outcome, stated plainly: the pre-registered bar (blind-panel mean ≥ 5.0)
was NOT met.** The layer measurably improved every comparison — the final
archived panel scores humanize commit `4c4f544` at 3.00 against the pre-humanize
engine's 2.13, and 15 of 16 shared-seed pairs across the four rounds improved
(one regressed, in the action-only Fable round) — but judges still call it
mechanical. Later commits fixed correctness and voice issues, so 3.00 is not a
measurement of current HEAD. Full numbers, judge verdicts, instrument
history and the LLM-arm rejection: `exp/ref/feel-panel.md` and
`exp/PLAN.md`. Diagnosis (not a pass): the surviving tells are properties
of the transcript format used to measure — finite phrase banks repeat, and
no real table narrates 500 decisions in a row — which the in-game player
never experiences.

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
  hints can appear earlier via `sampleTier` (`unknown` / `lean` / `solid`), but
  need ≥ 12 hands **on that seat** and a non-`unknown` tier — a second gate that
  is easy to miss when tuning `READS_MIN_HANDS`
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
