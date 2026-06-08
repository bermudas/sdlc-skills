#!/usr/bin/env node
// eval/driver/run-e2e-acp.mjs
// ---------------------------------------------------------------------------
// HIGHER-LEVEL, CROSS-BACKEND driver — the ACP portability lane (FUNCTIONAL).
//
// Drives ANY ACP agent (default: claude-agent-acp; or --agent-cmd "gemini
// --experimental-acp", a Codex/Goose adapter, …) as an ACP *client*, collects
// the normalized session/update stream, and scores the straightforward profile:
// OUTCOME (dual-run) · HONEST (lint) · PROCESS (produced-test/ran-tests/read).
//
// Wiring is the canonical ACP pattern (ndJsonStream + ClientSideConnection),
// validated against claude-agent-acp. NOTE: subagent dispatches FLATTEN over ACP
// (no native parent_tool_use_id; recover via emitRawSDKMessages on Claude) — so
// deep per-agent conformance stays on the SDK lane (driver/run-e2e.mjs).
//
//   node eval/driver/run-e2e-acp.mjs --fixture todomvc --case complete-todo
//   node eval/driver/run-e2e-acp.mjs --agent-cmd "gemini --experimental-acp" --case complete-todo
// Requires: cd eval && npm install  (+ the chosen agent reachable / authed).
// ---------------------------------------------------------------------------
import { spawn } from "node:child_process";
import { Writable, Readable } from "node:stream";
import { createRequire } from "node:module";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { acpTrace } from "../spine/acp-trace.mjs";
import { lintTestCode } from "../spine/lint.mjs";
import { classifyDualRun } from "../spine/dual-run.mjs";
import { scoreHigherLevel } from "../spine/higher-level.mjs";
import { invokedSkills } from "../spine/skills.mjs";
import { renderReport } from "../spine/report.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };

const fixture = arg("--fixture", "todomvc");
const caseId = arg("--case", "complete-todo");
const fixtureDir = join(HERE, "..", "fixtures", fixture);
const cwd = arg("--cwd", join(fixtureDir, "v-clean"));
const outDir = arg("--out", join(HERE, "..", "results"));
const agentCmd = arg("--agent-cmd", ""); // empty → default to local claude-agent-acp

function agentSpawn() {
  if (agentCmd) {
    const [cmd, ...rest] = agentCmd.split(" ");
    return spawn(cmd, rest, { cwd, stdio: ["pipe", "pipe", "inherit"] });
  }
  const bin = join(dirname(require.resolve("@agentclientprotocol/claude-agent-acp/package.json")), "dist", "index.js");
  return spawn(process.execPath, [bin], { cwd, stdio: ["pipe", "pipe", "inherit"] });
}

async function main() {
  const charter = readTask();
  const child = agentSpawn();
  const updates = [];
  const fileWrites = {};

  const client = {
    async requestPermission(params) {
      const opt = (params.options || []).find((o) => /allow/i.test(o.optionId || o.kind || "")) || params.options?.[0];
      return { outcome: opt ? { outcome: "selected", optionId: opt.optionId } : { outcome: "cancelled" } };
    },
    async sessionUpdate(params) { updates.push(params); },
    async readTextFile({ path }) { return { content: safeRead(join(cwd, path)) }; },
    async writeTextFile({ path, content }) { fileWrites[path] = content; return {}; },
  };

  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  const conn = new acp.ClientSideConnection(() => client, stream);
  const kill = setTimeout(() => { child.kill(); }, 240000);

  let res;
  try {
    await conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } });
    const sess = await conn.newSession({ cwd, mcpServers: [] });
    res = await conn.prompt({ sessionId: sess.sessionId, prompt: [{ type: "text", text: charter }] });
  } finally {
    clearTimeout(kill);
    child.kill();
  }

  // --- score with the tested spine -------------------------------------------
  const acpSig = acpTrace(updates);
  const writtenTest = Object.keys(fileWrites).find((p) => /\.(spec|test)\.[tj]sx?$/.test(p))
    || acpSig.fileWrites.find((p) => /\.(spec|test)\.[tj]sx?$/.test(p));
  const testCode = writtenTest ? (fileWrites[writtenTest] ?? safeRead(join(cwd, writtenTest))) : "";
  const lint = testCode ? lintTestCode(testCode) : null;
  let dual = null; // TODO: driver/dual-run.mjs — execute the test on v-clean + v-bug-001
  // dual = classifyDualRun(await dualRun({ testCode, cleanDir, bugDir }));

  const score = scoreHigherLevel({ acp: acpSig, lint, dual });
  const invoked = invokedSkills(acpSig.toolCalls);
  const run = {
    meta: { backend: agentCmd || "claude-agent-acp", fixture, case: caseId, stopReason: res?.stopReason },
    higherLevel: score,
    skills: { intendedCount: null, invoked, usedIntended: invoked, unexpected: [] },
  };
  mkdirSync(outDir, { recursive: true });
  const stem = join(outDir, `acp.${fixture}.${caseId}`);
  writeFileSync(`${stem}.json`, JSON.stringify({ agent: agentCmd || "claude-agent-acp", fixture, caseId, updates, acp: acpSig, lint, dual, score, run, stopReason: res?.stopReason }, null, 1));
  writeFileSync(`${stem}.report.md`, renderReport(run)); // human-readable report alongside the JSON

  console.log(`\n=== ACP higher-level scorecard · ${fixture}/${caseId} · ${agentCmd || "claude-agent-acp"} ===`);
  console.log(`updates: ${updates.length} · stopReason: ${res?.stopReason}`);
  console.log(`process:  produced-test=${score.checks["produced-test"]} ran-tests=${score.checks["ran-tests"]} read-before-write=${score.checks["read-before-write"]}`);
  console.log(`outcome:  real-test=${score.checks["real-test"]} honest=${score.checks.honest}`);
  console.log(`SCORE ${score.score} · ${score.pass ? "PASS ✓" : "FAIL ✗"}${score.failedChecks.length ? " · failed: " + score.failedChecks.join(", ") : ""}`);
}

function readTask() {
  const p = join(fixtureDir, "tasks", `${caseId}.md`);
  return existsSync(p) ? readFileSync(p, "utf8") : `Automate the "${caseId}" case into the project's test framework.`;
}
function safeRead(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }

main().catch((e) => { console.error(e); process.exit(1); });
