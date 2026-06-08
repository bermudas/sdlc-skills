// eval/suites/scout/hooks-injection.integration.test.mjs
// ---------------------------------------------------------------------------
// INTEGRATION — runs the REAL hooks/agent-start against the seeded TodoMVC
// fixture and proves the artifact→injection chain works end-to-end (no model).
// This is the executable counterpart to the static wiring test: it confirms the
// hook actually emits the role's memory + the shared docs from a seeded tree.
// Skips only if `bash` is unavailable; a hook that stops injecting FAILS.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAgentStart, parseInjection } from "../../driver/run-hooks.mjs";
import { assessInjection } from "../../spine/seeding.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SEEDED = join(REPO, "eval", "fixtures", "todomvc", "seeded");
const ROLE = "test-automation-engineer";

test("agent-start injects role memory + shared docs from the seeded fixture", () => {
  let raw;
  try {
    raw = runAgentStart(REPO, SEEDED, ROLE);
  } catch (e) {
    if (e.code === "ENOENT") return; // bash not available → skip, don't fail
    throw e; // a non-zero hook exit is a real regression
  }
  const inj = parseInjection(raw);

  // the four shared docs the per-agent hook must deliver to a subagent
  for (const doc of [".agents/profile.md", ".agents/workflow.md", ".agents/testing.md", ".agents/team-comms.md"]) {
    assert.ok(inj.shared.includes(doc), `hook did not inject ${doc}. Got: ${inj.shared.join(", ")}`);
  }
  // the role's memory must be injected
  assert.equal(inj.memory, true, "hook did not inject role memory");

  // and it satisfies the seeding scorer's injection check
  assert.equal(assessInjection(inj).ok, true);
});
