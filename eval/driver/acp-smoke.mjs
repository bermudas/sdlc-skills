#!/usr/bin/env node
// eval/driver/acp-smoke.mjs — minimal ACP client: drive claude-agent-acp over
// stdio, send one prompt, collect session/update, print what we can observe.
//   node eval/driver/acp-smoke.mjs "Reply with exactly: READY"
import { spawn } from "node:child_process";
import { Writable, Readable } from "node:stream";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import * as acp from "@agentclientprotocol/sdk";

const require = createRequire(import.meta.url);
// args: --agent-cmd "copilot --acp" (default: local claude-agent-acp); first non-flag = prompt
let agentCmd = "", prompt = "Reply with exactly: READY";
const _a = process.argv.slice(2);
for (let i = 0; i < _a.length; i++) {
  if (_a[i] === "--agent-cmd") agentCmd = _a[++i];
  else if (!_a[i].startsWith("--")) prompt = _a[i];
}

let child;
if (agentCmd) {
  const [c, ...r] = agentCmd.split(" ");
  child = spawn(c, r, { stdio: ["pipe", "pipe", "inherit"] });
} else {
  const agentBin = join(dirname(require.resolve("@agentclientprotocol/claude-agent-acp/package.json")), "dist", "index.js");
  child = spawn(process.execPath, [agentBin], { stdio: ["pipe", "pipe", "inherit"] });
}

const updates = [];
const client = {
  async requestPermission(params) {
    // auto-approve: pick the first allow-ish option
    const opt = (params.options || []).find((o) => /allow/i.test(o.optionId || o.kind || "")) || params.options?.[0];
    return { outcome: opt ? { outcome: "selected", optionId: opt.optionId } : { outcome: "cancelled" } };
  },
  async sessionUpdate(params) { updates.push(params); },
  async readTextFile() { return { content: "" }; },
  async writeTextFile() { return {}; },
};

const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
const conn = new acp.ClientSideConnection(() => client, stream);

const kill = setTimeout(() => { console.error("timeout"); child.kill(); process.exit(3); }, 120000);

try {
  const init = await conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } });
  console.log("initialize → protocol v" + init.protocolVersion + " | agentCaps:", JSON.stringify(init.agentCapabilities || {}));
  const sess = await conn.newSession({ cwd: process.cwd(), mcpServers: [] });
  console.log("newSession →", sess.sessionId);
  const res = await conn.prompt({ sessionId: sess.sessionId, prompt: [{ type: "text", text: prompt }] });

  // summarize what we collected
  const kinds = {};
  let text = "";
  const toolCalls = [];
  let attributed = 0;
  for (const u of updates) {
    const up = u.update || {};
    const k = up.sessionUpdate;
    kinds[k] = (kinds[k] || 0) + 1;
    if (k === "agent_message_chunk" && up.content?.type === "text") text += up.content.text;
    if (k === "tool_call" || k === "tool_call_update") toolCalls.push({ id: up.toolCallId, kind: up.kind, status: up.status, title: up.title });
    // subagent attribution carried as a vendor extension on the update or notification
    if (up._meta?.claudeCode?.parentToolUseId || u._meta?.claudeCode?.parentToolUseId) attributed++;
  }
  writeFileSync("/tmp/acp-smoke.json", JSON.stringify(updates, null, 1));
  console.log("\nsession/update kinds:", JSON.stringify(kinds));
  console.log("tool_calls (" + toolCalls.length + "):", JSON.stringify(toolCalls.slice(0, 12)));
  console.log("updates carrying _meta.claudeCode.parentToolUseId (attribution):", attributed);
  console.log("agent text:", JSON.stringify(text.trim().slice(0, 240)));
  console.log("stopReason:", res.stopReason);
  console.log("raw updates → /tmp/acp-smoke.json (" + updates.length + ")");
} catch (e) {
  console.error("ACP error:", e?.message || e);
} finally {
  clearTimeout(kill);
  child.kill();
  process.exit(0);
}
