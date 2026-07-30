# exp/ — measurement toolkit (offline, never deployed)

**Two things live here.** First, the *current* job: proving behavioral claims about the
bots — the seeded harness, the gate suite, the two locks that run in `run-all.sh`, and
the blind A/B panel generator. Second, the *concluded* LLM-bots experiment this was all
built for (verdict: rejected — [PLAN.md](PLAN.md) § Status).

**How to re-measure whether the bots feel human** (the thing most likely to be needed):

```bash
node exp/run-ab.js --seed <fresh>     # 8 blocks, old engine vs current, key sequestered
```

then run the protocol frozen in [ref/feel-panel.md](ref/feel-panel.md) — judges get ONE
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
- **ctx is extended in exp builds** with the public betting-state the legality view
  needs. Today that is `currentBet` and `minRaise` only — `myBet` ships in the app
  itself since bet-to totals had to reach the true all-in target. `exp-harness.js`
  branches on which generation of the file it is loading, so it can still run
  pre-humanize builds for A/B. The extension carries no hidden information.
- **Keyed RNG streams** (`prng.js`, wired in `exp-harness.js`): deck/button per hand
  index, policy rolls + equity Monte Carlo per (hand, decision). Deals are identical
  across arms at the same seed (duplicate-poker variance reduction); draws outside the
  expected windows are counted and must be zero.
- **Legality normalizer** (`legality.js`) runs before `applyAction` for LLM arms —
  the engine accepts `check` facing a bet and would loop forever (the harness `drain`
  throws at its step cap rather than truncating silently). Every coercion is counted;
  raw illegality is a pre-registered metric, with verb-only relabels (bet↔raise)
  counted separately and excluded from it.

**Live tooling** — used by `run-all.sh` or by anyone re-measuring the bots:

| File | Role |
|---|---|
| `exp-harness.js` | seeded harness: RNG stream injection, decision hook, `htmlPath` to load any engine build (cross-version A/B); every source rewrite asserted |
| `t-exp.js` | the gate suite — humanize gates (sizing, boundary blur, roll governance, short-stack raises, voice bans, mood) plus experiment infrastructure (determinism, deal identity, oracle replay, legality, prompt purity) |
| `run-probes.js` | exploitability LOCK — degenerate heroes must keep losing badly; fails the build otherwise |
| `run-labels.js` | readability LOCK — bots must stay legible; `--html`/`--sites` re-measures another engine build (that is how the bounds were set) |
| `run-ab.js` | blind A/B packet: 8 isolated 30-hand blocks, old engine vs current, shared deal seeds, key sequestered |
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
deploys via `.vercelignore` along with all of `exp/`). Frozen reference
evidence lives in tracked `exp/ref/` — baseline metrics/probes/labels, the
blind feel packets + keys + panel verdicts, the pilot's paid decision records,
and the frozen panel instrument (`feel-panel.md`). All of it was measured on
the PRE-HUMANIZE engine (8f0bada and earlier): it is preserved history, so
fresh `exp/out/` results are EXPECTED to diverge from it as the bots change —
never "fix" that divergence, and never regenerate into `exp/ref/`.

⚠ **Nothing enforces that but you.** There is no test and no ignore rule; a runner
pointed at `ref/` would overwrite the only copy of evidence that cost real money and
cannot be reproduced (the engine it measured no longer exists in the working tree).
The same directory holds every panel's answer key, which is why judges get individual
block files and never repo access.

`exp/t-exp.js` runs as part of `run-all.sh`, so if `poker-trainer.html`
drifts — a `Math.random` site added, a rewrite anchor renamed — the harness
fails loudly in the normal suite. The expected site count lives in ONE place:
the `EXPECTED_RAND_SITES` export in `exp-harness.js`. Re-audit the stream
assignment before changing it. `run-probes.js` and `run-labels.js` carry
hardcoded exploitability/readability locks (thresholds documented in-file
next to the measured values they were set against) and fail nonzero at the
frozen configs; both run in `run-all.sh`.
