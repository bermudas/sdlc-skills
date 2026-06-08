#!/usr/bin/env node
// eval/driver/run-outcome.mjs
// ---------------------------------------------------------------------------
// The first FULLY-SCORED universal run: drive any ACP agent to WRITE a test for
// the complete-todo case, then DUAL-RUN that agent-authored test against
// v-clean + v-bug-001 (real browser) → OUTCOME, plus HONEST (lint) + cost.
// ACP-universal: default agent = claude-agent-acp; --agent-cmd "copilot --acp".
//
//   node eval/driver/run-outcome.mjs                          # Claude
//   node eval/driver/run-outcome.mjs --agent-cmd "copilot --acp"
// ---------------------------------------------------------------------------
import { spawn } from "node:child_process";
import { Writable, Readable } from "node:stream";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { dualRun } from "./dual-run.mjs";
import { classifyDualRun } from "../spine/dual-run.mjs";
import { lintTestCode } from "../spine/lint.mjs";
import { acpTrace } from "../spine/acp-trace.mjs";
import { invokedSkills } from "../spine/skills.mjs";
import { renderReport } from "../spine/report.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "todomvc");
const a = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const agentCmd = a("--agent-cmd", "");
const backend = agentCmd || "claude-agent-acp";
const cwd = join("/tmp", `outcome-${backend.replace(/\W+/g, "_")}-${process.pid}`);
const TEST_REL = "tests/complete-todo.test.mjs";

const PROMPT = `Write a file at \`${TEST_REL}\`. It must \`export\` an async function named \`test(page, url)\` that uses the Playwright \`page\` API to verify a todo can be completed:
1. await page.goto(url)
2. fill [data-testid=new-todo] with "buy milk" and press Enter
3. check [data-testid=toggle]
4. return true if the [data-testid=todo-item] element has CSS class "completed", else false
Use ONLY the page and url arguments. DO NOT import anything. Write ONLY that file.`;

function agentSpawn() {
  if (agentCmd) { const [c, ...r] = agentCmd.split(" "); return spawn(c, r, { cwd, stdio: ["pipe", "pipe", "inherit"] }); }
  const bin = join(dirname(require.resolve("@agentclientprotocol/claude-agent-acp/package.json")), "dist", "index.js");
  return spawn(process.execPath, [bin], { cwd, stdio: ["pipe", "pipe", "inherit"] });
}

async function main() {
  mkdirSync(join(cwd, "tests"), { recursive: true });
  const child = agentSpawn();
  const updates = [];
  const client = {
    async requestPermission(p) { const o = (p.options || []).find((x) => /allow/i.test(x.optionId || x.kind || "")) || p.options?.[0]; return { outcome: o ? { outcome: "selected", optionId: o.optionId } : { outcome: "cancelled" } }; },
    async sessionUpdate(p) { updates.push(p); },
    async readTextFile({ path }) { try { return { content: readFileSync(join(cwd, path), "utf8") }; } catch { return { content: "" }; } },
    async writeTextFile({ path, content }) { const abs = join(cwd, path); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); return {}; },
  };
  const conn = new acp.ClientSideConnection(() => client, acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
  const kill = setTimeout(() => child.kill(), 240000);
  let res;
  try {
    await conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } });
    const s = await conn.newSession({ cwd, mcpServers: [] });
    res = await conn.prompt({ sessionId: s.sessionId, prompt: [{ type: "text", text: PROMPT }] });
  } finally { clearTimeout(kill); child.kill(); }

  // --- score: OUTCOME (dual-run the agent's test) + HONEST (lint) + process ---
  const testPath = join(cwd, TEST_REL);
  const acpSig = acpTrace(updates);
  let outcome = null, lint = null, testWritten = existsSync(testPath);
  if (testWritten) {
    const code = readFileSync(testPath, "utf8");
    lint = lintTestCode(code);
    try {
      const mod = await import(pathToFileURL(testPath).href + `?t=${process.pid}`);
      if (typeof mod.test === "function") {
        outcome = classifyDualRun(await dualRun({ cleanDir: join(FIX, "v-clean"), bugDir: join(FIX, "v-bug-001"), test: mod.test }));
      } else outcome = { category: "broken", real: false, note: "no exported test(page,url)" };
    } catch (e) { outcome = { category: "broken", real: false, note: "import/run error: " + e.message.slice(0, 100) }; }
  }

  const run = {
    meta: { backend, fixture: "todomvc", case: "complete-todo", stopReason: res?.stopReason },
    higherLevel: { score: outcome?.real ? 1 : 0, pass: !!(outcome?.real && lint?.clean), failedChecks: [...(outcome?.real ? [] : ["real-test"]), ...(lint && !lint.clean ? ["honest"] : [])] },
    skills: { intendedCount: null, invoked: invokedSkills(acpSig.toolCalls), usedIntended: invokedSkills(acpSig.toolCalls), unexpected: [] },
  };
  const outDir = join(HERE, "..", "results");
  mkdirSync(outDir, { recursive: true });
  const stem = join(outDir, `outcome.${backend.replace(/\W+/g, "_")}`);
  writeFileSync(`${stem}.json`, JSON.stringify({ backend, testWritten, outcome, lint, run, stopReason: res?.stopReason }, null, 1));
  writeFileSync(`${stem}.report.md`, renderReport(run));
  // observable session log: the full ACP session/update stream for this run
  writeFileSync(`${stem}.session.ndjson`, updates.map((u) => JSON.stringify(u)).join("\n") + (updates.length ? "\n" : ""));

  console.log(`\n=== OUTCOME run · ${backend} ===`);
  console.log(`test written: ${testWritten}${testWritten ? ` (${testPath})` : ""}`);
  console.log(`dual-run: ${outcome ? `${JSON.stringify({ clean: outcome.real || outcome.category, })} → ${outcome.category}${outcome.real ? " (REAL ✓)" : ""}` : "(no test)"}`);
  console.log(`honest (lint): ${lint ? lint.clean : "n/a"}${lint && !lint.clean ? ` masking=${lint.maskingHits} sleeps=${lint.sleepHits}` : ""}`);
  console.log(`VERDICT: ${run.higherLevel.pass ? "PASS ✓" : "FAIL ✗"}${run.higherLevel.failedChecks.length ? " · failed: " + run.higherLevel.failedChecks.join(", ") : ""}`);
  console.log(`report → ${stem}.report.md · session log → ${stem}.session.ndjson (${updates.length} ACP updates)`);
  console.log(`host transcript → ~/.claude/projects/${cwd.replace(/\//g, "-")}/  (full JSONL; ccusage reads these)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
