// eval/spine/trajectory.test.mjs — stdlib-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStreamJson, buildEventLog, eventLogFromText, subagents } from "./trajectory.mjs";

// A minimal Tal run: orchestrator dispatches an analyst subagent (Agent tool),
// the subagent emits a tool call under parent_tool_use_id, then a result event.
const NDJSON = [
  JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-4-6", tools: ["Agent", "Bash"] }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "disp-analyst", name: "Agent", input: { subagent_type: "qa-engineer", prompt: "Analyze CASE-001" } }] } }),
  JSON.stringify({ type: "assistant", parent_tool_use_id: "disp-analyst", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }),
  JSON.stringify({ type: "user", parent_tool_use_id: "disp-analyst", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }),
  "garbage non-json line — must be tolerated",
  JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.02, session_id: "sess-1", num_turns: 4 }),
].join("\n");

test("parseStreamJson tolerates junk lines", () => {
  assert.equal(parseStreamJson(NDJSON).length, 5); // 6 lines, 1 junk dropped
});

test("buildEventLog reconstructs the orchestrator→subagent tree", () => {
  const log = eventLogFromText(NDJSON);
  assert.equal(log.sessionId, "sess-1");
  assert.equal(log.model, "claude-sonnet-4-6");
  assert.equal(log.result.total_cost_usd, 0.02);

  // one dispatch, to the analyst slot
  assert.equal(log.dispatches.length, 1);
  assert.equal(log.dispatches[0].subagentType, "qa-engineer");
  assert.equal(log.dispatches[0].byAgent, "root");

  // subagent node exists, attributed under the dispatch tool_use id
  const subs = subagents(log);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].id, "disp-analyst");
  assert.equal(subs[0].subagentType, "qa-engineer");

  // the subagent's Bash call is attributed to the subagent, not root
  assert.equal(log.agents["disp-analyst"].toolCalls.length, 1);
  assert.equal(log.agents["disp-analyst"].toolCalls[0].name, "Bash");
  assert.equal(log.agents.root.toolCalls.length, 1); // only the Agent dispatch
  assert.equal(log.agents.root.toolCalls[0].name, "Agent");

  // tool result attributed to the subagent
  assert.equal(log.agents["disp-analyst"].toolResults.length, 1);
});

test("matches both Agent and Task dispatch tool names", () => {
  const log = eventLogFromText(
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "d", name: "Task", input: { subagent_type: "test-automation-engineer" } }] } })
  );
  assert.equal(log.dispatches.length, 1);
  assert.equal(log.dispatches[0].subagentType, "test-automation-engineer");
});
