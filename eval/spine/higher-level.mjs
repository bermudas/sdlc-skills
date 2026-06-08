// eval/spine/higher-level.mjs
// ---------------------------------------------------------------------------
// The HIGHER-LEVEL, backend-agnostic scorecard — the "straightforward tests"
// profile for the ACP portability lane. Composes three universally-observable
// signals into one verdict, no Claude-specific pipeline internals:
//   OUTCOME  — dual-run: real test (passes clean, fails on bug)?
//   HONEST   — static lint of the produced test (no masking / no sleeps)?
//   PROCESS  — produced a test file · ran the tests · read before writing (from ACP trace)
// Pass requires a real test, honest code, and that a test was actually produced.
// STDLIB ONLY — tested under `node --test`.
// ---------------------------------------------------------------------------

/**
 * @param {{ acp?:object, lint?:object, dual?:object }} inputs
 *   acp  — from spine/acp-trace.mjs  ({ producedTest, ranTests, readBeforeWrite })
 *   lint — from spine/lint.mjs       ({ maskingHits, sleepHits })
 *   dual — from spine/dual-run.mjs   ({ real })  (null if not executed)
 */
export function scoreHigherLevel({ acp = {}, lint = null, dual = null } = {}) {
  const checks = {
    "produced-test": !!acp.producedTest,
    "ran-tests": !!acp.ranTests,
    "read-before-write": acp.readBeforeWrite !== false,
    "real-test": dual ? dual.real === true : null,
    honest: lint ? lint.maskingHits === 0 && lint.sleepHits === 0 : null,
  };
  const considered = Object.entries(checks).filter(([, v]) => v !== null);
  const passed = considered.filter(([, v]) => v).length;
  const score = considered.length ? passed / considered.length : 0;

  // Hard requirements for a PASS: a real test (if we ran it), honest code (if we
  // linted it), and that a test was actually produced.
  const pass =
    checks["produced-test"] &&
    checks["real-test"] !== false &&
    checks.honest !== false;

  return {
    checks,
    passed,
    total: considered.length,
    score: Math.round(score * 1000) / 1000,
    pass: !!pass,
    failedChecks: considered.filter(([, v]) => !v).map(([k]) => k),
  };
}
