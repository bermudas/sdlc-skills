// eval/spine/extract-trace.test.mjs — stdlib-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eventLogFromText } from "./trajectory.mjs";
import { extractTrace } from "./extract-trace.mjs";
import { scoreConformance } from "./conformance.mjs";

// A full Tal run: analyst (qa), implementer (tae), reviewer (qa, "review" prompt),
// plus one allowed orchestrator edit (.agents/testing.md).
const NDJSON = [
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "d-analyst", name: "Agent", input: { subagent_type: "qa-engineer", prompt: "Analyze TC-001 and write the AFS" } }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "d-impl", name: "Agent", input: { subagent_type: "test-automation-engineer", prompt: "Automate TC-001" } }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "d-review", name: "Agent", input: { subagent_type: "qa-engineer", prompt: "Fresh-session review of the PR" } }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "e1", name: "Write", input: { file_path: ".agents/testing.md" } }] } }),
  JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.05, session_id: "s1" }),
].join("\n");

const log = eventLogFromText(NDJSON);

test("extractTrace separates analyst vs reviewer (both qa-engineer)", () => {
  const t = extractTrace(log);
  assert.equal(t.analystDispatched, true);
  assert.equal(t.implementerDispatched, true);
  assert.equal(t.reviewerDispatched, true);
  assert.equal(t.reviewerSessionId, "d-review");
  assert.deepEqual(t.implementerSessionIds, ["d-impl"]);
  assert.deepEqual(t.orchestratorEdits, [".agents/testing.md"]); // allowed path
});

test("a clean run + good externals scores S_process = 1", () => {
  const t = extractTrace(log, {
    afsStatus: "ready-for-automation", reviewerVerdict: "APPROVED",
    liveRunGreenStreak: 3, merged: true, tmsBackwritten: true, manualRunBeforeAutomate: true,
  });
  assert.equal(scoreConformance(t).S_process, 1);
});

test("an orchestrator edit to a forbidden path zeroes the run", () => {
  const bad = eventLogFromText(
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "e", name: "Write", input: { file_path: "tests/todo.spec.ts" } }] } })
  );
  const t = extractTrace(bad, { merged: true, reviewerVerdict: "APPROVED", liveRunGreenStreak: 3, tmsBackwritten: true });
  const s = scoreConformance(t);
  assert.equal(s.invariants["tal-no-forbidden-edits"], false);
  assert.equal(s.S_process, 0);
});
