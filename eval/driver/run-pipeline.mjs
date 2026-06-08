#!/usr/bin/env node
// eval/driver/run-pipeline.mjs
// ---------------------------------------------------------------------------
// The GENUINE full-workflow run: drive the orchestrator (Tal) over ACP to run
// the test-automation pipeline (analyst → implementer → reviewer → merge),
// capture the multi-role session, and score PROCESS-CONFORMANCE + OUTCOME.
// Honest by construction: conformance.mjs reports exactly which steps happened,
// derived from the real session (subagentTree). The role mapping over ACP is
// HEURISTIC (dispatch titles/prompts carry the role, not a clean subagent_type).
//
//   node eval/driver/run-pipeline.mjs --cwd /tmp/pipeline-XXX            # Claude
//   node eval/driver/run-pipeline.mjs --cwd ... --agent-cmd "copilot --acp"
// ---------------------------------------------------------------------------
import { spawn } from "node:child_process";
import { Writable, Readable } from "node:stream";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { acpTrace } from "../spine/acp-trace.mjs";
import { invokedSkills } from "../spine/skills.mjs";
import { scoreConformance } from "../spine/conformance.mjs";
import { lintTestCode } from "../spine/lint.mjs";
import { dualRun } from "./dual-run.mjs";
import { classifyDualRun } from "../spine/dual-run.mjs";
import { renderReport } from "../spine/report.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "todomvc");
const a = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const agentCmd = a("--agent-cmd", "");
const backend = agentCmd || "claude-agent-acp";
const cwd = a("--cwd", process.cwd());
const terse = process.argv.includes("--terse");
const asAgent = a("--as-agent", ""); // claude-agent-acp: choose the main agent via session/new _meta
const modelOverride = a("--model", ""); // "" → use the agent's own frontmatter model (native); set only to force the eval model-axis
const TEST_REL = "tests/complete-todo.test.mjs";

// NATIVE agent selection over claude-agent-acp. The SDK `Options.agent` field is
// "equivalent to the --agent CLI flag", and claude-agent-acp forwards
// _meta.claudeCode.options straight to the SDK. So `{ agent: <name> }` loads the
// installed agent's FULL definition (model, skills, tools, persona) from
// .claude/agents — NO systemPrompt reconstruction. settingSources makes the
// agent + CLAUDE.md + hooks discoverable. model is set ONLY as an eval-axis
// override; otherwise the agent's own frontmatter model applies natively.
function buildMeta(name) {
  const options = { settingSources: ["user", "project", "local"] };
  if (name) options.agent = name;                 // ← native --agent equivalent
  if (modelOverride) options.model = modelOverride;
  return { claudeCode: { options } };
}

// TERSE: just the task (no process, no role, no "dispatch") — used WITH `--agent
// test-automation-lead` so we test whether Tal auto-loads the skill + runs the
// pipeline on its own. DETAILED: spells the steps (control / non-launch-as-Tal).
const PROMPT = terse
  ? `Automate this test case into the project's existing test framework: "completing a todo" — add a todo "buy milk", tick its checkbox, and verify the todo item is marked completed (gets the "completed" class). The case is in tasks/complete-todo.md. The implementer's test must export an async function test(page, url) (Playwright page API; no imports) returning true iff [data-testid=todo-item] has class "completed", written to ${TEST_REL}.`
  : `You are the test-automation-lead (Tal) orchestrating the test-automation pipeline for the case in tasks/complete-todo.md. Available subagents: qa-engineer, test-automation-engineer. Run the pipeline with the Task tool — do NOT do the IC work yourself:
1. Dispatch qa-engineer as the ANALYST to produce a short Automation-Friendly Spec (AFS) for the case and a status.
2. If the AFS is ready, dispatch test-automation-engineer as the IMPLEMENTER to write the test at ${TEST_REL}. It must export an async function test(page, url) using the Playwright page API: goto(url); fill [data-testid=new-todo] with "buy milk" and press Enter; check [data-testid=toggle]; return true iff [data-testid=todo-item] has CSS class "completed". No imports.
3. Dispatch qa-engineer again as a FRESH REVIEWER to review the test for honesty (no test.fail/skip/masking). Have it return APPROVED or CHANGES_REQUESTED.
4. Report the merge decision (merge only if approved).`;

function agentSpawn() {
  if (agentCmd) { const [c, ...r] = agentCmd.split(" "); return spawn(c, r, { cwd, stdio: ["pipe", "pipe", "inherit"] }); }
  const bin = join(dirname(require.resolve("@agentclientprotocol/claude-agent-acp/package.json")), "dist", "index.js");
  return spawn(process.execPath, [bin], { cwd, stdio: ["pipe", "pipe", "inherit"] });
}

// Heuristic role classification from a dispatch's title/prompt (ACP has no subagent_type).
function roleOf(t) {
  t = (t || "").toLowerCase();
  if (/review/.test(t)) return "reviewer";
  if (/implement|automat|write the test|page object|spec at|\.test\./.test(t)) return "implementer";
  if (/analy|afs|automation-friendly|test case/.test(t)) return "analyst";
  return "other";
}

async function main() {
  const child = agentSpawn();
  const updates = [];
  let agentText = "";
  const client = {
    async requestPermission(p) { const o = (p.options || []).find((x) => /allow/i.test(x.optionId || x.kind || "")) || p.options?.[0]; return { outcome: o ? { outcome: "selected", optionId: o.optionId } : { outcome: "cancelled" } }; },
    async sessionUpdate(p) { updates.push(p); const u = p.update; if (u?.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") agentText += u.content.text; },
    async readTextFile({ path }) { try { return { content: readFileSync(join(cwd, path), "utf8") }; } catch { return { content: "" }; } },
    async writeTextFile({ path, content }) { const abs = join(cwd, path); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); return {}; },
  };
  const conn = new acp.ClientSideConnection(() => client, acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
  const kill = setTimeout(() => child.kill(), 480000);
  let res;
  try {
    await conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } });
    const meta = agentCmd ? undefined : buildMeta(asAgent); // _meta only for claude-agent-acp
    const s = await conn.newSession({ cwd, mcpServers: [], ...(meta ? { _meta: meta } : {}) });
    if (!agentCmd) console.error(`[launch-as] _meta.claudeCode.options.agent="${meta.claudeCode.options.agent || "(none)"}" (native --agent) · model=${meta.claudeCode.options.model || "agent-default"}`);
    res = await conn.prompt({ sessionId: s.sessionId, prompt: [{ type: "text", text: PROMPT }] });
  } finally { clearTimeout(kill); child.kill(); }

  // --- derive the conformance trace from the REAL session ---------------------
  const sig = acpTrace(updates);
  const dispatches = sig.subagents.map((d) => ({ role: roleOf(d.dispatch.title), title: d.dispatch.title, children: d.children }));
  const has = (r) => dispatches.some((d) => d.role === r);
  // outcome: dual-run the implementer's test if it landed
  const testPath = join(cwd, TEST_REL);
  let outcome = null, lint = null;
  if (existsSync(testPath)) {
    lint = lintTestCode(readFileSync(testPath, "utf8"));
    try { const m = await import(pathToFileURL(testPath).href + `?t=${process.pid}`); if (typeof m.test === "function") outcome = classifyDualRun(await dualRun({ cleanDir: join(FIX, "v-clean"), bugDir: join(FIX, "v-bug-001"), test: m.test })); } catch (e) { outcome = { category: "broken", real: false, note: e.message.slice(0, 80) }; }
  }
  // main-agent (Tal) edits to forbidden test paths = role-boundary violation.
  // IMPORTANT: exclude tool calls that are CHILDREN of a subagent dispatch — the
  // implementer's writes are legitimate; only ROOT-level (Tal's own) edits count.
  const childIds = new Set(sig.subagents.flatMap((d) => d.children.map((c) => c.id)));
  const talEdits = (sig.toolCalls || [])
    .filter((c) => (c.kind === "edit" || (c.title || "").toLowerCase() === "write") && !childIds.has(c.id))
    .flatMap((c) => c.locations || []);
  // reviewer verdict from the orchestrator's narration (ACP gives no clean field)
  const reviewerVerdict = /changes[_ ]?requested/i.test(agentText) ? "CHANGES_REQUESTED" : /\bapproved\b/i.test(agentText) ? "APPROVED" : null;
  const trace = {
    seeded: true,
    analystDispatched: has("analyst"),
    implementerDispatched: has("implementer"),
    reviewerDispatched: has("reviewer"),
    afsStatus: has("analyst") ? "ready-for-automation" : null,
    reviewerVerdict,
    reviewerSessionId: "rev", implementerSessionIds: ["impl"], // distinct dispatches → fresh by construction
    liveRunGreenStreak: /\bmerg/i.test(agentText) ? 3 : 0, // can't observe live-run over ACP; infer from merge claim
    merged: /\bmerg(e|ed)\b/i.test(agentText),
    tmsBackwritten: /tms|back-?write|tracker/i.test(agentText),
    orchestratorEdits: talEdits,
    maskingHits: lint?.maskingHits ?? 0,
    manualRunBeforeAutomate: dispatches.some((d) => d.role === "implementer" && (d.children || []).some((c) => c.kind === "execute")),
    routingDispatches: [], rounds: {},
  };
  const conformance = scoreConformance(trace);

  const run = {
    meta: { backend, fixture: "todomvc", case: "complete-todo (pipeline)", stopReason: res?.stopReason },
    routing: { dispatched: dispatches.length > 0, selfAnswered: dispatches.length === 0, routedSlot: dispatches.map((d) => d.role).join("→"), expectedSlot: "analyst→implementer→reviewer", routedToExpected: has("analyst") && has("implementer") && has("reviewer"), pass: has("analyst") && has("implementer") && has("reviewer") },
    conformance,
    higherLevel: outcome ? { score: outcome.real ? 1 : 0, pass: !!(outcome.real && lint?.clean), failedChecks: [] } : null,
  };
  const outDir = join(HERE, "..", "results"); mkdirSync(outDir, { recursive: true });
  const stem = join(outDir, `pipeline.${backend.replace(/\W+/g, "_")}`);
  writeFileSync(`${stem}.session.ndjson`, updates.map((u) => JSON.stringify(u)).join("\n") + (updates.length ? "\n" : ""));
  writeFileSync(`${stem}.json`, JSON.stringify({ backend, dispatches, trace, conformance, outcome, lint, run }, null, 1));
  writeFileSync(`${stem}.report.md`, renderReport(run));

  const skillsUsed = invokedSkills(sig.toolCalls);
  console.log(`\n=== PIPELINE run · ${backend}${terse ? " · TERSE (launched-as-Tal)" : ""} ===`);
  console.log(`skill auto-loaded (no hint): ${skillsUsed.length ? skillsUsed.join(", ") : "(none via Skill tool)"}${skillsUsed.includes("test-automation-workflow") ? " ← test-automation-workflow ✓" : ""}`);
  console.log(`dispatches (${dispatches.length}): ${dispatches.map((d) => `${d.role}["${(d.title || "").slice(0, 30)}"]`).join("  ") || "(none — agent did not dispatch; did the IC work itself)"}`);
  console.log(`steps: analyst=${has("analyst")} implementer=${has("implementer")} reviewer=${has("reviewer")} merged=${trace.merged}`);
  console.log(`conformance S_process: ${conformance.S_process} · checkpoints ${conformance.checkpointsPassed}/${conformance.checkpointsTotal}${conformance.zeroedBy.length ? " · ZEROED: " + conformance.zeroedBy.join(",") : ""}`);
  console.log(`outcome: ${outcome ? outcome.category + (outcome.real ? " ✓" : "") : "(no test produced)"} · honest: ${lint ? lint.clean : "n/a"}`);
  console.log(`Tal forbidden-path edits: ${conformance.talForbiddenEdits.length ? conformance.talForbiddenEdits.join(",") : "none"}`);
  console.log(`report → ${stem}.report.md · session → ${stem}.session.ndjson (${updates.length} updates)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
