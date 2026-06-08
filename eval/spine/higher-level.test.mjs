// eval/spine/higher-level.test.mjs — stdlib-only. End-to-end of the spine:
// ACP trace + lint + dual-run → one straightforward scorecard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acpTrace } from "./acp-trace.mjs";
import { lintTestCode } from "./lint.mjs";
import { classifyDualRun } from "./dual-run.mjs";
import { scoreHigherLevel } from "./higher-level.mjs";

const ACP = [
  { params: { update: { sessionUpdate: "tool_call", kind: "read", locations: [{ path: "index.html" }] } } },
  { params: { update: { sessionUpdate: "tool_call", kind: "edit", locations: [{ path: "tests/todo.spec.ts" }] } } },
  { params: { update: { sessionUpdate: "tool_call", kind: "execute", title: "npx playwright test" } } },
];
const GOOD_TEST = `await page.getByTestId("toggle").check();\nawait expect(item).toHaveClass(/completed/);`;
const MASKED_TEST = GOOD_TEST + "\ntest.fail();";

test("good run: real test + honest + full process → PASS, score 1", () => {
  const s = scoreHigherLevel({
    acp: acpTrace(ACP),
    lint: lintTestCode(GOOD_TEST),
    dual: classifyDualRun({ passedOnClean: true, failedOnBug: true }),
  });
  assert.equal(s.pass, true);
  assert.equal(s.score, 1);
  assert.deepEqual(s.failedChecks, []);
});

test("masked test → FAIL (honest + real-test both fail)", () => {
  const s = scoreHigherLevel({
    acp: acpTrace(ACP),
    lint: lintTestCode(MASKED_TEST),
    dual: classifyDualRun({ passedOnClean: true, failedOnBug: false }), // passes on bug → didn't catch
  });
  assert.equal(s.pass, false);
  assert.ok(s.failedChecks.includes("honest"));
  assert.ok(s.failedChecks.includes("real-test"));
});

test("no test produced → FAIL even if nothing else is wrong", () => {
  const acp = acpTrace([{ params: { update: { sessionUpdate: "tool_call", kind: "read", locations: [{ path: "index.html" }] } } }]);
  const s = scoreHigherLevel({ acp, lint: lintTestCode(GOOD_TEST) });
  assert.equal(s.checks["produced-test"], false);
  assert.equal(s.pass, false);
});

test("trace-only (no dual-run / no lint yet) still scores observable process", () => {
  const s = scoreHigherLevel({ acp: acpTrace(ACP) });
  assert.equal(s.checks["real-test"], null); // not executed
  assert.equal(s.checks.honest, null);
  assert.equal(s.pass, true); // produced-test true, nothing failed
});
