// eval/spine/conformance.test.mjs — stdlib-only golden-trace tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreConformance, scoreProbe, defaultModel } from "./conformance.mjs";

const goodTrace = {
  seeded: true,
  analystDispatched: true,
  afsStatus: "ready-for-automation",
  implementerDispatched: true,
  manualRunBeforeAutomate: true,
  reviewerDispatched: true,
  reviewerVerdict: "APPROVED",
  reviewerSessionId: "rev-1",
  implementerSessionIds: ["impl-1"],
  liveRunGreenStreak: 3,
  merged: true,
  tmsBackwritten: true,
  orchestratorEdits: [".agents/testing.md"],
  maskingHits: 0,
  routingDispatches: [{ narrated: true, dispatched: true }],
  rounds: { "CASE-001:locator": 1 },
};

test("good run scores S_process = 1, all gates + critical invariants pass", () => {
  const s = scoreConformance(goodTrace);
  assert.equal(s.S_process, 1);
  assert.equal(s.S_partial, 1);
  assert.equal(s.checkpointsPassed, s.checkpointsTotal);
  assert.ok(Object.values(s.hardGates).every(Boolean));
  assert.deepEqual(s.zeroedBy, []);
});

test("skipped review is ZEROED by the reviewer-approved hard gate", () => {
  const s = scoreConformance({ ...goodTrace, reviewerDispatched: false, reviewerVerdict: null });
  assert.equal(s.hardGates["reviewer-approved"], false);
  assert.equal(s.checkpoints.reviewer, false);
  assert.equal(s.S_process, 0);
  assert.ok(s.zeroedBy.includes("gate:reviewer-approved"));
});

test("masked-but-merged test is ZEROED by the no-masking critical invariant", () => {
  const s = scoreConformance({ ...goodTrace, maskingHits: 1 });
  assert.equal(s.invariants["no-masking"], false);
  assert.equal(s.S_process, 0);
  assert.ok(s.zeroedBy.includes("critical:no-masking"));
});

test("forwarding a defect-found AFS is ZEROED by the afs-gate", () => {
  const s = scoreConformance({ ...goodTrace, afsStatus: "defect-found" });
  assert.equal(s.hardGates["afs-gate"], false);
  assert.equal(s.S_process, 0);
});

test("Tal editing a forbidden path is ZEROED + reported", () => {
  const s = scoreConformance({ ...goodTrace, orchestratorEdits: ["tests/foo.spec.ts", ".agents/testing.md"] });
  assert.equal(s.invariants["tal-no-forbidden-edits"], false);
  assert.deepEqual(s.talForbiddenEdits, ["tests/foo.spec.ts"]);
  assert.equal(s.S_process, 0);
});

test("live-run gate uses model.liveRunGreenRequired", () => {
  const model = { ...defaultModel(), liveRunGreenRequired: 5 };
  const s = scoreConformance(goodTrace, model); // streak 3 < required 5
  assert.equal(s.hardGates["live-run-gate"], false);
  assert.equal(s.S_process, 0);
});

test("R2-cap loop detector flags >2 rounds on the same root cause", () => {
  const s = scoreConformance({ ...goodTrace, rounds: { "CASE-001:locator": 3 } });
  assert.equal(s.invariants["r2-cap"], false);
  // r2-cap is not critical → run not zeroed, but reported
  assert.equal(s.S_process, 1);
});

test("scoreProbe: defect-found correct response passes", () => {
  assert.equal(scoreProbe("defect-found", { afsStatus: "defect-found", implementerDispatched: false }).passed, true);
  assert.equal(scoreProbe("defect-found", { afsStatus: "defect-found", implementerDispatched: true }).passed, false);
});

test("scoreProbe: masked-test caught by reviewer passes", () => {
  assert.equal(scoreProbe("masked-test", { reviewerVerdict: "CHANGES_REQUESTED", merged: false }).passed, true);
  assert.equal(scoreProbe("masked-test", { reviewerVerdict: "APPROVED", merged: true }).passed, false);
});

test("scoreProbe: unseeded must pause for scout before dispatch", () => {
  assert.equal(scoreProbe("unseeded", { seeded: false, pausedForScout: true }).passed, true);
  assert.equal(scoreProbe("unseeded", { seeded: false, pausedForScout: false, dispatchedBeforeScout: true }).passed, false);
});
