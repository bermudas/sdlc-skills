// eval/spine/passk.mjs
// ---------------------------------------------------------------------------
// pass@1 / pass@k / pass^k over N boolean trial results.
//
//   pass@1  = c/n                              (single-attempt success rate)
//   pass@k  = 1 - C(n-c,k)/C(n,k)              (at least one of k succeeds)
//   pass^k  = C(c,k)/C(n,k)                    (ALL k succeed — reliability)
//
// pass^k is the load-bearing reliability metric: a gate/probe that fires 1-in-3
// is unshippable. Unbiased combinatorial estimators (the SWE-bench/HumanEval
// style) over n runs with c successes. STDLIB ONLY — tested under `node --test`.
// ---------------------------------------------------------------------------

function nCk(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

function tally(results) {
  const arr = results.map(Boolean);
  return { n: arr.length, c: arr.filter(Boolean).length };
}

export function pass1(results) {
  const { n, c } = tally(results);
  return n === 0 ? null : c / n;
}

/** pass@k — probability at least one of a random k-subset passes. */
export function passAtK(results, k) {
  const { n, c } = tally(results);
  if (n === 0 || k > n) return null;
  return 1 - nCk(n - c, k) / nCk(n, k);
}

/** pass^k — probability ALL of a random k-subset pass (reliability). */
export function passHatK(results, k) {
  const { n, c } = tally(results);
  if (n === 0 || k > n) return null;
  return nCk(c, k) / nCk(n, k);
}

/** Full summary for a metric over N runs. */
export function summarize(results, k = 3) {
  const { n, c } = tally(results);
  return {
    n,
    c,
    pass1: round(pass1(results)),
    [`pass@${k}`]: round(passAtK(results, k)),
    [`pass^${k}`]: round(passHatK(results, k)),
  };
}

function round(x) {
  return x == null ? null : Math.round(x * 1000) / 1000;
}
