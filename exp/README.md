# exp/ — measurement toolkit (offline, never deployed)

**Two things live here.** First, the *current* job: proving behavioral claims about the
bots — the seeded harness, the gate suite, the two locks that run in `run-all.sh`, and
the blind A/B panel generator. Second, the *concluded* LLM-bots experiment this was all
built for (verdict: rejected — [PLAN.md](PLAN.md) § Status).

**How to re-measure whether the bots feel human** (the thing most likely to be needed):

```bash
node exp/run-ab.js --seed <fresh> --action-only   # play only — the headline instrument
node exp/run-ab.js --seed <fresh>                 # full transcripts (play + stated reasons)
```

The old arm is genuinely the old engine, not a memory: `run-ab.js` git-shows a
commitish (default `8f0bada`, the frozen pre-humanize engine anchor) into `exp/out/` and
loads it through `exp-harness`'s `htmlPath` + `expectedRandSites`. That constant
is load-bearing — it is also the readability lock's reference and the `old` arm of
every archived panel. Later experiment-only commits preceded the first humanize engine
change, but their `poker-trainer.html` blob is identical to this anchor.

Then run the protocol frozen in [ref/feel-panel.md](ref/feel-panel.md) — judges get ONE
block file each and never repo access (`ref/` holds the answer key and every prior
verdict; a judge who has seen it is burned).

The shipped app is never modified by anything in here — every runner loads
`poker-trainer.html` (or an older build, via `htmlPath`) and rewrites it in memory.

Key design calls, with independent-assessment findings folded in:

- **No async engine.** `botDecide` stays synchronous. LLM arms use a decision oracle
  (`oracle.js`): cache hit → return; miss → record prompt, abort session, resolve the
  decision outside the engine, replay from seed. Replays reproduce identical ctx
  (verified on every cache hit — divergence throws). Cache keys are scoped by seed so
  a cache shared across runs can never serve another session's decision.
- **ctx is extended in older exp builds** with `currentBet` and `minRaise` for the
  external legality normalizer. Current builds already ship the exact `legal` view and
  detached public opponent ranges. `exp-harness.js` still branches by engine generation
  so historical A/B runs remain reproducible. The extension carries no hidden data.
- **Keyed RNG streams** (`prng.js`, wired in `exp-harness.js`): button per session,
  deck per hand index, policy rolls + equity Monte Carlo per (hand, decision). Deals are identical
  across arms at the same seed (duplicate-poker variance reduction); draws outside the
  expected windows are counted and must be zero.
- **The shipped engine has a strict legal-action boundary.** External decision sources
  still pass through `normalize()` so malformed model output becomes a measured,
  deterministic fallback before it reaches that boundary. Every `amount` is a
  bet-**to** total for the street, never an increment.
- **Legality normalizer** (`legality.js`) runs before `applyAction` for LLM arms.
  Historical engines accepted malformed actions that could stall the loop, while the
  current boundary rejects them. Every coercion is counted;
  raw illegality is a pre-registered metric, with verb-only relabels (bet↔raise)
  counted separately and excluded from it.

**Live tooling** — used by `run-all.sh` or by anyone re-measuring the bots:

⚠ `run-all.sh` is not read-only. `t-exp.js` removes and recreates test directories, and
the probe and label locks overwrite their matching files under `exp/out/`. Those outputs
are disposable and gitignored, but run the suite only when replacing scratch state is
acceptable.

| File | Role |
|---|---|
| `exp-harness.js` | seeded harness: RNG stream injection, explicit `dispatch`/`v1`/`v2` policy selection, decision hook, and `htmlPath` for cross-version A/B; every source rewrite asserted |
| `t-exp.js` | the gate suite — humanize gates (sizing, boundary blur, roll governance, short-stack raises, voice bans, mood) plus experiment infrastructure (determinism, deal identity, oracle replay, legality, prompt purity) |
| `run-probes.js` | exploitability LOCK — degenerate heroes must keep losing badly; fails the build otherwise. **Arms only at 30×200/`probe1`**; any other config prints `lock skipped` and exits 0. bb/100 here is a *floor*, not an estimate: no rebuys, so a busting strategy caps its loss at −200 per session — valid for relative comparison only |
| `run-labels.js` | readability LOCK — bots must stay legible; `--html`/`--sites` re-measures another engine build (that is how the bounds were set). **Arms only at 90 sessions/`label1`** |
| `run-ab.js` | blind A/B packet: 8 isolated 30-hand blocks, old engine vs current, shared deal seeds, key sequestered. `--action-only` emits the play log alone (the format behind the headline 3.00-vs-2.13); default emits full transcripts. Scores compare only within a format — use the matching judge prompt |
| `run-baseline.js` | persona frequency bands + pooled split-half + transcripts |
| `prng.js` / `metrics.js` | keyed deterministic streams; rate/pooling/bb100 helpers (unit-tested against hand-computed values) |

**Concluded LLM experiment** — kept as the record of how the verdict was reached; not
expected to run again (`run-pilot.js` bills real money and requires `--live`):

| File | Role |
|---|---|
| `PLAN.md` | the pre-registration: frozen criteria, baselines, staircase, and the final verdict |
| `oracle.js` | cache-or-abort decision oracle + session replay (kept the engine synchronous) |
| `legality.js` | LLM action/amount normalizer + clamp accounting — also reused as the sizing gate's independent oracle |
| `prompt.js` | pure prompt builder: shared rules + 5 persona prefixes, spot renderer, default-deny card scan |
| `spend.js` / `run-pilot.js` | hard call/USD caps with cost math; the billed arm itself (opt-in, resumable, every decision persisted before it is cached) |
| `run-feel.js` | the original LLM-vs-coded blind packet (superseded by `run-ab.js` for engine-vs-engine work) |

Outputs land in `exp/out/` (gitignored scratch; also excluded from Vercel
deploys via `.vercelignore` along with all of `exp/`). Frozen evidence lives in
tracked `exp/ref/`, in two kinds — don't conflate them:

- **Pre-humanize measurements** (engine 8f0bada and earlier): `baseline-metrics`,
  `probes-baseline`, `labels-baseline`, `baseline-transcripts`, `feel-key` (the
  packet it unlocks is regenerated, not stored — see below), and the LLM pilot's
  paid decision records.
- **Old-vs-new panel results** whose `new` arm is a humanize-arc commit:
  `feel-panel-ab1` (689911c), `ab2` (f0a157d), `bare` (a495960), `final` (4c4f544).
  Only `ab1` and `final` archived enough to re-derive their pair-by-pair results.

Either way it is history: fresh `exp/out/` results are EXPECTED to diverge as the
bots change — never "fix" that divergence, and never regenerate into `exp/ref/`.

⚠ **`pilot-api-pilot1.jsonl` cannot be recreated at any price** — it is the paid LLM
pilot (1005 decisions, ~$0.90) and the only record in which you can *see* a bot claim
a draw that isn't on the board, the hallucination finding that ended the LLM approach.
It is ~80% of `exp/`'s bytes and it is the evidentiary base for the project's largest
decision. Everything derived from it, however, IS reproducible and therefore is not
archived: the original blind packet rebuilds byte-identically with

```bash
node exp/run-feel.js --engine 8f0bada     # writes feel-packet.txt + key to exp/out/
```

The `--engine` flag is mandatory there and worth understanding: the pilot's cached
decisions were recorded against the pre-humanize ctx, so replaying them on today's
bots trips the oracle's divergence check — correctly. (An earlier note in this file
claimed the packet was unrecoverable; that was wrong, and the flag above is the fix.)

⚠ **Nothing enforces that but you.** No test, no ignore rule — and every runner
writes to `exp/out/` under the *same filename* as its `ref/` counterpart
(`probes-baseline.json`, `labels-baseline.json`, `baseline-metrics.json`,
`baseline-transcripts.txt`), so one careless copy overwrites archived evidence —
and the engine those numbers describe is gone from the working
tree. `ref/` is git-tracked, so `git checkout -- exp/ref/` recovers an uncommitted
clobber. The same directory holds every panel's answer key, which is why judges get
individual block files and never repo access.

`exp/t-exp.js` runs as part of `run-all.sh`, so if `poker-trainer.html`
drifts — a `Math.random` site added, a rewrite anchor renamed — the harness
fails loudly in the normal suite. The expected site count lives in ONE place:
the `EXPECTED_RAND_SITES` export in `exp-harness.js`. Re-audit the stream
assignment before changing it. `run-probes.js` and `run-labels.js` carry
hardcoded exploitability/readability locks (thresholds documented in-file
next to the measured values they were set against) and fail nonzero at the
frozen configs; both run in `run-all.sh`.
