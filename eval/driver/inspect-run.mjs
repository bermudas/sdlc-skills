#!/usr/bin/env node
// eval/driver/inspect-run.mjs — show what the spine collects from a captured
// `claude -p --output-format stream-json` run.  Usage: node inspect-run.mjs <ndjson>
import { readFileSync } from "node:fs";
import { parseStreamJson, buildEventLog } from "../spine/trajectory.mjs";
import { parseClaudeResult } from "../spine/usage.mjs";

const path = process.argv[2];
if (!path) { console.error("usage: inspect-run.mjs <ndjson>"); process.exit(2); }
const events = parseStreamJson(readFileSync(path, "utf8"));
const log = buildEventLog(events);

// event-type histogram
const hist = {};
for (const e of events) hist[`${e.type}${e.subtype ? "/" + e.subtype : ""}`] = (hist[`${e.type}${e.subtype ? "/" + e.subtype : ""}`] || 0) + 1;
console.log("events:", JSON.stringify(hist));

// dispatches (routing decisions) — who Tal sent work to
console.log(`\ndispatches (${log.dispatches.length}):`);
for (const d of log.dispatches) console.log(`  → ${d.subagentType}  (tool=${d.toolUseId})  prompt="${String(d.input?.prompt || d.input?.description || "").slice(0, 80)}"`);

// per-agent tool calls (what each node did)
console.log("\nagents / tool calls:");
for (const [id, a] of Object.entries(log.agents)) {
  if (!a.toolCalls.length && id !== "root") continue;
  console.log(`  ${id === "root" ? "root(orchestrator)" : `subagent:${a.subagentType || id}`} → ${a.toolCalls.map((c) => c.name).join(", ") || "(none)"}`);
}

// final result + cost/usage
const result = events.find((e) => e.type === "result");
if (result) {
  const u = parseClaudeResult(result);
  console.log("\nresult text:", JSON.stringify((result.result || "").slice(0, 240)));
  console.log(`cost_usd: ${u.costUsd} | in:${u.input} out:${u.output} cacheR:${u.cacheRead} | turns:${result.num_turns} | session:${u.sessionId}`);
}

// any messages attributed to a subagent (attribution signal)
const attributed = events.filter((e) => (e.parent_tool_use_id || e.parentToolUseId)).length;
console.log(`\nmessages carrying parent_tool_use_id (subagent attribution): ${attributed}`);
