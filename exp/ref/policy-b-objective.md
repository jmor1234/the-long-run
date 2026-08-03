# Policy B objective gate: 2026-08-03

- Engine: `2c0036e`
- Command: `node exp/run-policy-gate.js`
- Verdict: **fail**

The criteria were fixed before either arm ran. Policy B had to remain within 6
percentage points of Policy A for VPIP and 8 points for fold-to-bet, preserve the
persona ordering and convergence bounds, emit no rejected or fallback action in
the non-layered postflop path it owns, and then pass the existing exploitability
and readability locks.

The gate stopped after the first 40-session × 150-hand baseline stage:

| Persona | VPIP A | VPIP B | Δ | F2bet A | F2bet B | Δ | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| nit | 23.37% | 20.55% | 2.82pp | 67.79% | 75.49% | 7.70pp | pass |
| solid | 36.28% | 31.30% | 4.98pp | 56.92% | 65.90% | 8.98pp | fail |
| maniac | 48.04% | 44.20% | 3.84pp | 46.08% | 55.19% | 9.11pp | fail |
| selective | 28.24% | 25.43% | 2.81pp | 64.19% | 71.47% | 7.28pp | pass |
| station | 52.16% | 45.38% | 6.77pp | 41.68% | 54.07% | 12.39pp | fail |

Policy B's owned postflop path had zero rejected actions and zero safe fallbacks.
The trusted adapter changed one Policy A bet size and zero Policy B bet sizes.
The harness also exposed a pre-existing Policy A behavior: raises can be proposed
when the legal view has no aggressive action. The engine safely fell back 25 times
for the Policy A arm and 9 times in Policy B's delegated Policy A paths. That is
recorded separately and was not attributed to Policy B's owned path.

Because persona fidelity failed, the staircase stopped. Exploitability,
readability, and blind feel stages were not run. The shipped dispatcher remains
Policy A. Any future Policy B tuning must be a new measured increment; do not widen
these bounds after seeing this result.
