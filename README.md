# The Long Run

6-max No-Limit Hold'em trainer. Play against frequency-based bots with distinct
recreational styles (nit / maniac / station, etc.). They limp, adapt from public
actions over a session, and share the same read model you see in the UI. Copy hand
histories for review.

**Repo:** [github.com/jmor1234/the-long-run](https://github.com/jmor1234/the-long-run)  
**Live:** [the-long-run-chi.vercel.app](https://the-long-run-chi.vercel.app)

## Play

- **Local:** open [`poker-trainer.html`](poker-trainer.html) in a browser
- **Deployed:** production URL above (Vercel maps `/` → `poker-trainer.html`)

Hover or tap a seat’s style pill for a dossier (baked style + live session read:
VPIP, 3-bet, fold-to-c-bet, sample confidence).

## Deploy (Vercel)

Static site. [`vercel.json`](vercel.json) rewrites `/` to the trainer.

```bash
npx vercel          # preview
npx vercel --prod   # production
```

Or import the GitHub repo in the [Vercel dashboard](https://vercel.com/new) — framework
preset **Other**, no build command, empty output directory.

## Docs

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — **start here for agents**: cold-start (§0),
  purpose, invariants, file map, styles/reads rationale, testing, open work

## Test suite

```bash
bash run-all.sh     # everything; POSIX/WSL; see ARCHITECTURE.md §9 for Windows
node t3.js          # fairness only — run this after touching botDecide
node t-policy-b.js  # opt-in Policy B public-line and pricing oracle
node exp/run-policy-gate.js # frozen Policy A/B objective gate; currently fails B
node exp/t-openai-fixture.js # offline Terra budget, journal, crash, and concurrency proof
node t-legal.js     # legal-action boundary and no-mutation rejection oracle
node t-teaching.js  # exact full-call and short-all-in teaching price
node t-equity.js    # exact heads-up equity and live range-wiring oracle
node t-settlement.js # exact pot recipients, odd chips, and refund semantics
```

Node >= 18, no dependencies. Any line starting `BUG` or `FAIL` is a regression.

The harness reads `./poker-trainer.html` and rewrites four exact source anchors.
Every rewrite must match exactly once or the harness throws; `t-harness.js` proves
missing and duplicated anchors fail closed and that the injected hooks execute.
Keep `const botDecide=function(ctx){` and
`function equity(mine, board, opps_, iters){` literal.
See [ARCHITECTURE.md](ARCHITECTURE.md) §9.
