// eval/spine/dual-run.mjs
// ---------------------------------------------------------------------------
// Classify a generated test by running it against BOTH builds (the SWT-bench
// dual-run). The strongest, simplest, fully backend-agnostic outcome signal:
//   passes on v-clean AND fails on the seeded-bug build  → REAL (caught the bug)
//   passes on v-clean AND passes on bug                   → MASKED/WEAK (didn't catch)
//   fails on v-clean                                      → BROKEN (bad test)
// This module SCORES the result; the driver EXECUTES the runs (Playwright).
// STDLIB ONLY — tested under `node --test`.
// ---------------------------------------------------------------------------

/**
 * @param {{passedOnClean:boolean, failedOnBug:boolean}} r
 *   passedOnClean — the test passed against v-clean
 *   failedOnBug   — the test FAILED against v-bug-001 (i.e. it caught the seeded fault)
 */
export function classifyDualRun({ passedOnClean, failedOnBug } = {}) {
  if (!passedOnClean) return { category: "broken", real: false, note: "fails on the good build — the test itself is wrong" };
  if (passedOnClean && failedOnBug) return { category: "real", real: true, note: "passes clean, fails on the bug — genuinely catches it" };
  return { category: "masked-or-weak", real: false, note: "passes on the buggy build — does not catch the fault (masked/weak assertion)" };
}
