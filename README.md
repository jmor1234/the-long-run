# The Long Run

6-max No-Limit Hold'em trainer. Open in a browser, play against frequency-based bots, copy hand histories for review.

## Play

- **Local:** open [`poker-trainer.html`](poker-trainer.html) in a browser  
- **Deployed:** root URL serves the trainer (see Vercel below)

## Deploy (Vercel)

This is a static site. [`vercel.json`](vercel.json) maps `/` → `poker-trainer.html`.

```bash
npx vercel          # preview
npx vercel --prod   # production
```

Or import the GitHub repo in the [Vercel dashboard](https://vercel.com/new) — framework preset **Other**, no build command, output directory left empty (static root).

## Test suite

```bash
bash run-all.sh     # everything
node t3.js          # fairness only — run this after touching botDecide
```

Node >= 18, no dependencies. Any line starting `BUG` or `FAIL` is a regression.

The harness reads `./poker-trainer.html` and rewrites three strings in it. If you
rename `renderActions`, `botDecide`, or the bootstrap `newSession()` call, update
`harness.js` — otherwise the transforms silently no-op and results become nonsense
rather than failing. See [ARCHITECTURE.md](ARCHITECTURE.md) §9.
