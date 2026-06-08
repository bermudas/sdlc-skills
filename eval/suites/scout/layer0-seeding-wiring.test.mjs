// eval/suites/scout/layer0-seeding-wiring.test.mjs
// ---------------------------------------------------------------------------
// LAYER 0 — verify the scout artifact → hook-injection CHAIN is intact in source.
// A real run starts with scout seeding; those artifacts only reach the agents if
// the hooks still inject them. This catches "someone refactored a hook and the
// briefings stopped being delivered" — without running anything. Zero-dep.
// Sources: hooks/session-start, hooks/agent-start, skills/seeding-a-project/SKILL.md.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel) => readFileSync(join(REPO, rel), "utf8");
const model = JSON.parse(read("eval/reference-models/scout-artifacts.json"));

test("the injection hooks exist", () => {
  assert.ok(existsSync(join(REPO, "hooks/session-start")), "missing hooks/session-start");
  assert.ok(existsSync(join(REPO, "hooks/agent-start")), "missing hooks/agent-start");
});

test("session-start injects shared .agents context + handles unseeded quietly", () => {
  const h = read("hooks/session-start");
  assert.ok(h.includes(".agents"), "session-start no longer references .agents/");
  assert.match(h, /unseeded|Nothing to inject|exit/i, "session-start lost its unseeded guard");
});

test("agent-start injects per-role memory + the lean shared docs", () => {
  const h = read("hooks/agent-start");
  for (const token of ["snapshot.md", "MEMORY.md", ".agents/memory"]) {
    assert.ok(h.includes(token), `agent-start no longer references ${token}`);
  }
  // the shared docs the per-agent hook is supposed to deliver (subagents can't @import)
  for (const doc of ["profile", "workflow", "testing", "team-comms"]) {
    assert.ok(h.includes(doc), `agent-start no longer delivers ${doc}`);
  }
});

test("seeding skill still declares the artifacts the eval expects", () => {
  const skill = read("skills/seeding-a-project/SKILL.md");
  for (const f of ["profile.md", "workflow.md", "testing.md", "team-comms.md", "project_briefing.md"]) {
    assert.ok(skill.includes(f), `seeding-a-project no longer generates ${f}`);
  }
});

test("reference model: every hook-injected artifact is actually referenced by that hook", () => {
  const agentStart = read("hooks/agent-start");
  for (const a of model.artifacts) {
    const by = Array.isArray(a.injectedBy) ? a.injectedBy : [a.injectedBy];
    // per-role memory is injected via the digest (snapshot.md / MEMORY.md), not by
    // its literal filename — checked separately above. Cross-check the shared docs.
    if (by.includes("agent-start") && !a.perRole) {
      const base = a.path.split("/").pop().replace(".md", ""); // profile / workflow / testing / team-comms
      assert.ok(agentStart.includes(base), `model says agent-start injects ${a.path}, but the hook doesn't reference "${base}"`);
    }
  }
});
