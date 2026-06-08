#!/usr/bin/env node
// eval/driver/run-seed.mjs — Stage A of the faithful flow: drive SCOUT to seed a
// real project over ACP, then score the result: artifacts produced (seeding.mjs),
// facts captured (vs fixtures' facts.json), skill auto-loaded (seeding-a-project,
// no hint), and injection (run the project's installed hook).
//   node eval/driver/run-seed.mjs --cwd /tmp/seed-proj
import { spawn, execFileSync } from "node:child_process";
import { Writable, Readable } from "node:stream";
import { createRequire } from "node:module";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { acpTrace } from "../spine/acp-trace.mjs";
import { invokedSkills } from "../spine/skills.mjs";
import { scoreArtifacts, scoreFactRecall, assessInjection } from "../spine/seeding.mjs";
import { parseInjection } from "./run-hooks.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const a = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const agentCmd = a("--agent-cmd", "");
const backend = agentCmd || "claude-agent-acp";
const cwd = a("--cwd", "/tmp/seed-proj");
const facts = JSON.parse(readFileSync(join(HERE, "..", "fixtures", "todomvc", "facts", "facts.json"), "utf8")).facts;

// Terse onboarding ask — does NOT name the skill (tests scout's auto-load).
const PROMPT = `Onboard this project for the team. Explore it, then generate the project-context docs the team needs to start work: CLAUDE.md, AGENTS.md, and the .agents/ docs (profile, testing, workflow, team-comms) — capture the test framework (if any) and how to run tests, knowledge about the app under test, and a light way-of-work. Then write per-role memory briefings.`;

function agentSpawn() {
  if (agentCmd) { const [c, ...r] = agentCmd.split(" "); return spawn(c, r, { cwd, stdio: ["pipe", "pipe", "inherit"] }); }
  const bin = join(dirname(require.resolve("@agentclientprotocol/claude-agent-acp/package.json")), "dist", "index.js");
  return spawn(process.execPath, [bin], { cwd, stdio: ["pipe", "pipe", "inherit"] });
}

function walk(dir, base = dir) { const out = []; if (!existsSync(dir)) return out; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) out.push(...walk(p, base)); else out.push(relative(base, p)); } return out; }

async function main() {
  const child = agentSpawn();
  const updates = [];
  const client = {
    async requestPermission(p) { const o = (p.options || []).find((x) => /allow/i.test(x.optionId || x.kind || "")) || p.options?.[0]; return { outcome: o ? { outcome: "selected", optionId: o.optionId } : { outcome: "cancelled" } }; },
    async sessionUpdate(p) { updates.push(p); },
    async readTextFile({ path }) { try { return { content: readFileSync(join(cwd, path), "utf8") }; } catch { return { content: "" }; } },
    async writeTextFile({ path, content }) { const abs = join(cwd, path); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); return {}; },
  };
  const conn = new acp.ClientSideConnection(() => client, acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
  const kill = setTimeout(() => child.kill(), 480000);
  try {
    await conn.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } });
    const s = await conn.newSession({ cwd, mcpServers: [] });
    await conn.prompt({ sessionId: s.sessionId, prompt: [{ type: "text", text: PROMPT }] });
  } finally { clearTimeout(kill); child.kill(); }

  // --- score Stage A -----------------------------------------------------------
  const sig = acpTrace(updates);
  const skillInvoked = invokedSkills(sig.toolCalls);
  const present = ["CLAUDE.md", "AGENTS.md", ...walk(join(cwd, ".agents")).map((p) => ".agents/" + p)];
  const roles = present.filter((p) => /\.agents\/memory\/[^/]+\/MEMORY\.md$/.test(p)).map((p) => p.split("/")[2]);
  const doc = present.filter((p) => p.endsWith(".md")).map((p) => { try { return readFileSync(join(cwd, p), "utf8"); } catch { return ""; } }).join("\n\n");
  const artifacts = scoreArtifacts(present, { roles });
  const factScore = scoreFactRecall(facts, doc);
  // injection: run the PROJECT'S installed hook (the one the runtime would fire)
  let injection = { shared: [], memory: false };
  try {
    const hook = join(cwd, ".claude/hooks/sdlc-skills/agent-start");
    const out = execFileSync("bash", [hook, "test-automation-engineer"], { cwd, env: { ...process.env, SDLC_HOOK_RAW: "1", CLAUDE_PROJECT_DIR: cwd }, encoding: "utf8" });
    injection = parseInjection(out);
  } catch (e) { injection.error = e.message.slice(0, 80); }
  const inject = assessInjection(injection);

  const outDir = join(HERE, "..", "results"); mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `seed.${backend.replace(/\W+/g, "_")}.session.ndjson`), updates.map((u) => JSON.stringify(u)).join("\n") + (updates.length ? "\n" : ""));
  writeFileSync(join(outDir, `seed.${backend.replace(/\W+/g, "_")}.json`), JSON.stringify({ backend, skillInvoked, artifacts, facts: factScore, injection: inject, presentAgentsDocs: present.filter((p) => p.startsWith(".agents/") && p.endsWith(".md")) }, null, 1));

  console.log(`\n=== SCOUT SEED · ${backend} ===`);
  console.log(`skill auto-loaded (no hint): ${skillInvoked.length ? skillInvoked.join(", ") : "(none invoked via Skill tool)"}`);
  console.log(`artifacts: ${artifacts.presentCount}/${artifacts.requiredTotal} required${artifacts.missing.length ? " · MISSING: " + artifacts.missing.join(", ") : " ✓"}`);
  console.log(`  .agents docs produced: ${present.filter((p) => p.startsWith(".agents/") && p.endsWith(".md")).join(", ") || "(none)"}`);
  console.log(`facts captured: recall ${factScore.recall} · ${factScore.captured.join(",")}${factScore.missed.length ? " · MISSED: " + factScore.missed.join(",") : ""}${factScore.dangerousErrors.length ? " · ⚠DANGEROUS: " + factScore.dangerousErrors.join(",") : ""}`);
  console.log(`injection (installed hook): shared=[${injection.shared.join(", ")}] memory=${injection.memory} → ${inject.ok ? "OK" : "INCOMPLETE"}${injection.error ? " (err: " + injection.error + ")" : ""}`);
  console.log(`session → results/seed.${backend.replace(/\W+/g, "_")}.session.ndjson (${updates.length} updates)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
