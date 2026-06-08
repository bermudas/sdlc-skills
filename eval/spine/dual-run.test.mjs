// eval/spine/dual-run.test.mjs — stdlib-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDualRun } from "./dual-run.mjs";

test("passes clean + fails on bug = REAL", () => {
  const r = classifyDualRun({ passedOnClean: true, failedOnBug: true });
  assert.equal(r.category, "real");
  assert.equal(r.real, true);
});

test("passes clean + passes on bug = MASKED/WEAK (didn't catch it)", () => {
  const r = classifyDualRun({ passedOnClean: true, failedOnBug: false });
  assert.equal(r.category, "masked-or-weak");
  assert.equal(r.real, false);
});

test("fails on clean = BROKEN test", () => {
  const r = classifyDualRun({ passedOnClean: false, failedOnBug: true });
  assert.equal(r.category, "broken");
  assert.equal(r.real, false);
});
