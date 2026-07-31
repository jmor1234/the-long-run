#!/usr/bin/env bash
# Run every suite and lock. Fails (exit 1) on any nonzero suite exit OR any
# BUG/FAIL line in output — suites set real exit codes, the grep is the belt.
set -u
cd "$(dirname "$0")"
status=0
for t in t-harness.js t-policy.js t-legal.js t-settlement.js t1b.js t2.js t3.js t6.js audit.js exp/t-exp.js exp/run-probes.js exp/run-labels.js; do
  echo "=============================== $t"
  out="$(node "$t" 2>&1)" || status=1
  printf '%s\n' "$out"
  if printf '%s\n' "$out" | grep -qE '(^|[^A-Za-z])(BUG|FAIL)'; then status=1; fi
done
if [ "$status" -ne 0 ]; then echo; echo "RUN-ALL: FAILURES PRESENT"; fi
exit $status
