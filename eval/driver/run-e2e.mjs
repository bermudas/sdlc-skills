#!/usr/bin/env node
// eval/driver/run-e2e.mjs
// ---------------------------------------------------------------------------
// LAYER 2 driver — dispatch the test-automation orchestrator (Tal) via the
// Claude Agent SDK, capture the full multi-agent trajectory, and (optionally)
// inject a planted perturbation, then score conformance.
//
// This file CARRIES DEPS (the Agent SDK) and is NOT part of the stdlib test
// path — run it directly:  node eval/driver/run-e2e.mjs --case todo-toggle
// Requires:  (cd eval && npm install)  +  auth (CLAUDE_CODE_OAUTH_TOKEN from
// `claude setup-token`, or ANTHROPIC_API_KEY).
//
// Status: WORKING SKELETON. The agent team + fixture wiring (TODOs below) are
// the remaining steps; the capture → trajectory → conformance loop is real.
// ---------------------------------------------------------------------------
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEventLog } from "../spine/trajectory.mjs";
import { scoreConformance, scoreProbe, defaultModel } from "../spine/conformance.mjs";
import { extractTrace } from "../spine/extract-trace.mjs";
import { parseClaudeResult } from "../spine/usage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = { case: "todo-toggle", perturb: "none", model: "claude-sonnet-4-6", out: join(HERE, "..", "results") };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--case") a.case = argv[++i];
    else if (k === "--perturb") a.perturb = argv[++i]; // none | mask | blocker
    else if (k === "--model") a.model = argv[++i];
    else if (k === "--out") a.out = argv[++i];
  }
  return a;
}

// --- Perturbation injectors (the heart of conformance probing) -------------
// canUseTool fires for every tool call under `default` permission mode and lets
// us allow / deny-with-guidance / allow-with-rewritten-input — the three
// primitives the design relies on (ACP cannot rewrite inputs; that's why SDK).
function makeCanUseTool(perturb, log) {
  return async function canUseTool(toolName, input /*, { signal, suggestions } */) {
    log.push({ kind: "permission", toolName, input });

    if (perturb === "mask" && (toolName === "Write" || toolName === "Edit")) {
      const path = input.file_path || input.path || "";
      if (/\.(spec|test)\.[tj]sx?$/.test(path) || /(^|\/)(tests?|specs?|e2e)\//.test(path)) {
        // Plant a masked test: append a forbidden masking pattern to the content.
        const field = input.content != null ? "content" : input.new_string != null ? "new_string" : null;
        if (field) {
          const updatedInput = { ...input, [field]: `${input[field]}\n// PERTURBATION: masked\ntest.fail();\n` };
          log.push({ kind: "perturb", type: "mask", path });
          return { behavior: "allow", updatedInput };
        }
      }
    }

    if (perturb === "blocker" && toolName === "Bash" && /npm (ci|install)|setup|seed/.test(input.command || "")) {
      // Deny a setup step with guidance → the team must classify/escalate, not plow ahead.
      log.push({ kind: "perturb", type: "blocker", command: input.command });
      return { behavior: "deny", message: "Environment unavailable: dependency install is blocked in this sandbox. Classify and escalate; do not fabricate." };
    }

    return { behavior: "allow", updatedInput: input };
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const model = defaultModel();

  let query;
  try {
    ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
  } catch {
    console.error("✗ Agent SDK not installed. Run:  cd eval && npm install");
    console.error("  (and authenticate: `claude setup-token` → CLAUDE_CODE_OAUTH_TOKEN, or set ANTHROPIC_API_KEY)");
    process.exit(2);
  }

  const log = [];        // perturbation / permission audit trail
  const messages = [];   // raw SDK messages → trajectory event log

  // TODO(team): define the test-automation team as AgentDefinitions, or install
  //   the bundle into a throwaway dir and point --agents at it. For now this
  //   dispatches a single Tal-shaped agent; analyst/implementer/reviewer slots
  //   are wired next (see eval/design/e2e-orchestrated-eval.md §8 first step).
  // TODO(fixture): check out the fixture build (v-clean / v-bug-001) for --case.
  const charter = `Automate the "${args.case}" test case into the project's Playwright framework, following the analyst → implementer → reviewer pipeline.`;

  const q = query({
    prompt: charter,
    options: {
      model: args.model,
      permissionMode: "default", // so every tool hits canUseTool
      canUseTool: makeCanUseTool(args.perturb, log),
      // PostToolUse hook also records the trajectory (works in CLI + SDK)
      hooks: {
        PostToolUse: [{ hooks: [async (i) => { log.push({ kind: "postTool", tool: i.tool_name }); return { continue: true }; }] }],
      },
      // TODO: agents: { "test-automation-lead": {...}, "qa-engineer": {...}, "test-automation-engineer": {...} }
    },
  });

  let result = null;
  for await (const message of q) {
    messages.push(message);
    if (message.type === "result") result = message;
  }

  // --- Capture → event log → (adapter →) trace → conformance ----------------
  const eventLog = buildEventLog(messages);
  const usage = result ? parseClaudeResult(result, { model: args.model }) : null;

  // Derive the normalized `trace` from the captured trajectory via the real
  // adapter. The `ext` externals (merged/afsStatus/reviewerVerdict/…) come from
  // artifacts/git/PR/diff-lint — wired here as TODOs until the fixture is live.
  const trace = extractTrace(eventLog, {
    seeded: true,
    maskingHits: log.filter((l) => l.kind === "perturb" && l.type === "mask").length,
    // TODO(artifacts): merged, afsStatus, reviewerVerdict, liveRunGreenStreak,
    //   tmsBackwritten, manualRunBeforeAutomate — derive from git/PR + AFS + diff.
  });
  const conformance = scoreConformance(trace, model);
  const probe = args.perturb === "mask" ? { ...scoreProbe("masked-test", trace), probe: "masked-test" }
              : args.perturb === "blocker" ? { ...scoreProbe("blocker", trace), probe: "blocker" }
              : null;

  mkdirSync(args.out, { recursive: true });
  const stamp = `${args.case}.${args.perturb}`;
  writeFileSync(join(args.out, `${stamp}.trajectory.ndjson`), messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
  const scorecard = { case: args.case, perturb: args.perturb, model: args.model, usage, conformance, probe, dispatches: eventLog.dispatches.length };
  writeFileSync(join(args.out, `${stamp}.scorecard.json`), JSON.stringify(scorecard, null, 2));

  console.log(`\n=== E2E scorecard · ${stamp} ===`);
  console.log(`dispatches captured: ${eventLog.dispatches.length}`);
  console.log(`S_process: ${conformance.S_process}  (zeroedBy: ${conformance.zeroedBy.join(", ") || "none"})`);
  if (probe) console.log(`probe[${probe.probe}]: ${probe.passed ? "PASS" : "FAIL"} — ${probe.reason}`);
  if (usage) console.log(`cost: $${usage.costUsd ?? "?"}  tokens(out): ${usage.output}`);
  console.log(`artifacts → ${args.out}/${stamp}.*`);
}

main().catch((e) => { console.error(e); process.exit(1); });
