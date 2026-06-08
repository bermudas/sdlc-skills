// eval/spine/acp-trace.test.mjs — stdlib-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAcpUpdates, acpTrace, subagentTree } from "./acp-trace.mjs";

// A backend-agnostic ACP session/update stream: plan → read → edit(test file) →
// execute(test cmd) → usage. (As any ACP agent would emit it.)
const NDJSON = [
  J({ sessionUpdate: "plan", entries: [{ content: "read app", status: "completed" }, { content: "write test", status: "completed" }] }),
  J({ sessionUpdate: "tool_call", toolCallId: "t1", kind: "read", status: "completed", locations: [{ path: "index.html" }] }),
  J({ sessionUpdate: "tool_call", toolCallId: "t2", kind: "edit", status: "completed", locations: [{ path: "tests/todo.spec.ts" }] }),
  J({ sessionUpdate: "tool_call", toolCallId: "t3", kind: "execute", status: "completed", title: "npx playwright test" }),
  J({ sessionUpdate: "usage_update", usage: { input_tokens: 1200, output_tokens: 300 } }),
].join("\n");

function J(update) { return JSON.stringify({ method: "session/update", params: { sessionId: "s1", update } }); }

test("parseAcpUpdates unwraps params.update and tolerates junk", () => {
  const u = parseAcpUpdates(NDJSON + "\nnot-json");
  assert.equal(u.length, 5);
  assert.equal(u[0].sessionUpdate, "plan");
});

test("acpTrace extracts the universal process signals", () => {
  const t = acpTrace(NDJSON);
  assert.deepEqual(t.fileWrites, ["tests/todo.spec.ts"]);
  assert.deepEqual(t.terminalCmds, ["npx playwright test"]);
  assert.equal(t.producedTest, true);
  assert.equal(t.ranTests, true);
  assert.equal(t.readBeforeWrite, true);
  assert.equal(t.plan.length, 2);
  assert.equal(t.usage.output_tokens, 300);
});

test("readBeforeWrite is false when the agent edits before reading", () => {
  const t = acpTrace([
    { params: { update: { sessionUpdate: "tool_call", toolCallId: "e", kind: "edit", locations: [{ path: "tests/x.spec.ts" }] } } },
    { params: { update: { sessionUpdate: "tool_call", toolCallId: "r", kind: "read", locations: [{ path: "index.html" }] } } },
  ]);
  assert.equal(t.readBeforeWrite, false);
});

test("accepts an array of notifications too", () => {
  const t = acpTrace([{ params: { update: { sessionUpdate: "tool_call", toolCallId: "x", kind: "execute", title: "vitest run" } } }]);
  assert.equal(t.ranTests, true);
});

// Mirrors the REAL captured trace: a Task dispatch whose subagent ran echo + pwd,
// each child stamped with _meta.claudeCode.parentToolUseId = the Task id.
const DISPATCH_STREAM = [
  N({ sessionUpdate: "tool_call", toolCallId: "task", kind: "think", status: "pending", title: "Task" }),
  N({ sessionUpdate: "tool_call_update", toolCallId: "task", title: "Run two shell commands" }),
  N({ sessionUpdate: "tool_call", toolCallId: "c1", kind: "execute", status: "pending", title: "echo HELLO", _meta: { claudeCode: { parentToolUseId: "task" } } }),
  N({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed", _meta: { claudeCode: { parentToolUseId: "task" } } }),
  N({ sessionUpdate: "tool_call", toolCallId: "c2", kind: "execute", status: "pending", title: "pwd", _meta: { claudeCode: { parentToolUseId: "task" } } }),
  N({ sessionUpdate: "tool_call_update", toolCallId: "c2", status: "completed", _meta: { claudeCode: { parentToolUseId: "task" } } }),
  N({ sessionUpdate: "tool_call_update", toolCallId: "task", status: "completed" }),
];
function N(update) { return { method: "session/update", params: { sessionId: "s", update } }; }

test("subagentTree recovers the dispatch + its children via _meta", () => {
  const tree = subagentTree(DISPATCH_STREAM);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].dispatch.id, "task");
  assert.equal(tree[0].dispatch.status, "completed"); // result returns at the dispatch's completion
  assert.equal(tree[0].attribution, "meta");
  assert.deepEqual(tree[0].children.map((c) => c.title), ["echo HELLO", "pwd"]);
});

test("subagentTree falls back to temporal bracketing when _meta is absent", () => {
  const stripped = DISPATCH_STREAM.map((n) => ({ ...n, params: { ...n.params, update: { ...n.params.update, _meta: undefined } } }));
  const tree = subagentTree(stripped);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].attribution, "bracket"); // no _meta → bracket by the wrapper's [start, completed] window
  assert.deepEqual(tree[0].children.map((c) => c.title).sort(), ["echo HELLO", "pwd"]);
});

// Mirrors the REAL Copilot trace: wrapper kind "other" (not "think"), no _meta,
// completing AFTER its two execute children. Containment detection must catch it.
const COPILOT_STREAM = [
  N({ sessionUpdate: "tool_call", toolCallId: "w", kind: "other", status: "pending", title: "Run two shell commands" }),
  N({ sessionUpdate: "tool_call", toolCallId: "e1", kind: "execute", status: "pending", title: "Run echo command" }),
  N({ sessionUpdate: "tool_call", toolCallId: "e2", kind: "execute", status: "pending", title: "Run pwd command" }),
  N({ sessionUpdate: "tool_call_update", toolCallId: "e2", status: "completed" }),
  N({ sessionUpdate: "tool_call_update", toolCallId: "e1", status: "completed" }),
  N({ sessionUpdate: "tool_call_update", toolCallId: "w", status: "completed" }),
];

test("subagentTree recovers a Copilot-shaped dispatch via containment (no _meta, kind 'other')", () => {
  const tree = subagentTree(COPILOT_STREAM);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].dispatch.id, "w");
  assert.equal(tree[0].attribution, "bracket");
  assert.deepEqual(tree[0].children.map((c) => c.title).sort(), ["Run echo command", "Run pwd command"]);
});
