// eval/spine/routing.test.mjs — stdlib-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inferRoutedSlot, scoreRouting } from "./routing.mjs";

const CANDIDATES = ["qa-engineer", "test-automation-engineer", "scout"];

test("inferRoutedSlot finds the slot from the agent's report text", () => {
  // mirrors the real ACP run: "Routed to: qa-engineer ... Returned: READY"
  const slot = inferRoutedSlot({ acp: { subagents: [], toolCalls: [{ title: "Reply with READY" }] }, agentText: "Agent routed to: qa-engineer", candidates: CANDIDATES });
  assert.equal(slot, "qa-engineer");
});

test("inferRoutedSlot finds the slot from a dispatch title", () => {
  const slot = inferRoutedSlot({ acp: { subagents: [{ dispatch: { title: "Delegate to test-automation-engineer" }, children: [] }] }, candidates: CANDIDATES });
  assert.equal(slot, "test-automation-engineer");
});

test("scoreRouting: dispatched to the expected slot = PASS", () => {
  const r = scoreRouting({ dispatched: true, routedSlot: "qa-engineer", expectedSlot: "qa-engineer" });
  assert.equal(r.pass, true);
  assert.equal(r.selfAnswered, false);
});

test("scoreRouting: routed to the WRONG slot = FAIL", () => {
  const r = scoreRouting({ dispatched: true, routedSlot: "test-automation-engineer", expectedSlot: "qa-engineer" });
  assert.equal(r.routedToExpected, false);
  assert.equal(r.pass, false);
});

test("scoreRouting: self-answered (no dispatch) = FAIL", () => {
  const r = scoreRouting({ dispatched: false, routedSlot: null, expectedSlot: "qa-engineer" });
  assert.equal(r.selfAnswered, true);
  assert.equal(r.pass, false);
});
