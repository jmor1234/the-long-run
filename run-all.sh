#!/usr/bin/env bash
# Run every suite. Any BUG or FAIL line means a regression.
set -u
cd "$(dirname "$0")"
for t in t1b.js t2.js t3.js t6.js audit.js exp/t-exp.js; do
  echo "=============================== $t"
  node "$t" || echo "  (suite errored)"
done
