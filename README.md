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
bash run-all.sh     # everything
node t3.js          # fairness only — run this after touching botDecide
```

Node >= 18, no dependencies. Any line starting `BUG` or `FAIL` is a regression.

The harness reads `./poker-trainer.html` and rewrites three strings in it. A failed
`botDecide` wrap **throws**; a missed `renderActions` or bootstrap strip can still
silently no-op and make results nonsense. Keep `function botDecide(ctx){` literal.
See [ARCHITECTURE.md](ARCHITECTURE.md) §9.
