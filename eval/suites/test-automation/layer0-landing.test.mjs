// eval/suites/test-automation/layer0-landing.test.mjs
// ---------------------------------------------------------------------------
// LAYER 0 — landing / structural tests for the test-automation BUNDLE.
// Scripted, deterministic, zero-dep, zero-cost (no model calls). Runs under root
// `node --test`. Catches "the bundle stopped hanging together" or "an orchestrator
// invariant was edited out of the source" before any expensive eval runs.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { lintTestCode } from "../../spine/lint.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel) => readFileSync(join(REPO, rel), "utf8");
const readJSON = (rel) => JSON.parse(read(rel));

const bundle = readJSON("bundles/test-automation/bundle.json");
const model = readJSON("eval/reference-models/test-automation.pipeline.json");

// The reference model names the test-automation-workflow skill as a source (see
// model.description), and the bundle SHIPS that skill (it's a localSkill). So the
// skill's load-bearing rules are part of the bundle's eval contract — guard them
// here so editing the skill can't silently drift from what the model + lint score.
const skillSrc =
  read("skills/test-automation-workflow/SKILL.md") + "\n" +
  read("skills/test-automation-workflow/references/orchestration-playbook.md");

// skills.json registry — to resolve localSkills the way the installer does
const registryRaw = existsSync(join(REPO, "skills.json")) ? readJSON("skills.json") : {};
const registry = registryRaw.skills ?? registryRaw;
// skills.json `skills` is an ARRAY of {id, monorepo|repo}; older shape was an object keyed by id.
const registryIds = new Set(Array.isArray(registry) ? registry.map((e) => e.id) : Object.keys(registry));
const skillResolves = (name) =>
  existsSync(join(REPO, "skills", name, "SKILL.md")) || registryIds.has(name);

test("bundle.json is well-formed", () => {
  assert.equal(bundle.id, "test-automation");
  assert.ok(bundle.title && bundle.description);
  assert.ok(Array.isArray(bundle.localAgents) && bundle.localAgents.length > 0);
  assert.ok(Array.isArray(bundle.localSkills) && bundle.localSkills.length > 0);
});

test("the pipeline roles are all present in the bundle", () => {
  for (const role of ["scout", "test-automation-lead", "test-automation-engineer", "qa-engineer"]) {
    assert.ok(bundle.localAgents.includes(role), `bundle missing pipeline role: ${role}`);
  }
});

test("every localAgent resolves to an AGENT.md whose frontmatter name matches", () => {
  for (const a of bundle.localAgents) {
    const p = `agents/${a}/AGENT.md`;
    assert.ok(existsSync(join(REPO, p)), `missing ${p}`);
    const fm = read(p).split(/\n/).slice(0, 20).join("\n");
    assert.match(fm, new RegExp(`name:\\s*${a}\\b`), `${p} frontmatter name != ${a}`);
  }
});

test("every localSkill resolves (local dir or skills.json registry)", () => {
  for (const s of bundle.localSkills) {
    assert.ok(skillResolves(s), `localSkill "${s}" resolves to neither skills/${s}/SKILL.md nor a skills.json entry`);
  }
});

test("the craft skills the pipeline depends on exist locally", () => {
  for (const s of ["test-automation-workflow", "test-case-analysis", "playwright-testing"]) {
    assert.ok(existsSync(join(REPO, "skills", s, "SKILL.md")), `missing skills/${s}/SKILL.md`);
  }
});

test("Tal's AGENT.md still carries the forbidden-edit hard-stop (role-boundary invariant)", () => {
  const lead = read("agents/test-automation-lead/AGENT.md");
  assert.match(lead, /No application\/test code edits/i, "missing the 'no code edits' hard-stop");
  for (const p of ["playwright.config", ".env"]) {
    assert.ok(lead.includes(p), `forbidden-path list no longer mentions ${p}`);
  }
});

test("bundle instructions still encode the load-bearing invariants", () => {
  const ins = read("bundles/test-automation/instructions.md");
  assert.match(ins, /AFS status is contract law/i, "lost: AFS status is contract law");
  assert.match(ins, /No defect masking/i, "lost: No defect masking");
  assert.ok(ins.includes("ready-for-automation"), "lost: the advancing AFS status name");
});

test("reference model is internally consistent + matches source invariants", () => {
  assert.equal(model.orchestrator, "test-automation-lead");
  assert.ok(model.advancingAfsStatuses.includes("ready-for-automation"));
  assert.ok(model.forbiddenOrchestratorPaths.includes("tests/"));
  assert.ok(model.forbiddenOrchestratorPaths.some((p) => p.includes("playwright.config")));
  assert.ok(model.maskingPatterns.every((p) => typeof p === "string" && p.length > 0));
  // the forbidden config paths the model scores against must actually appear in Tal's source rules
  const lead = read("agents/test-automation-lead/AGENT.md");
  assert.ok(lead.includes("playwright.config"), "model/source drift: playwright.config");
});

// --- model ↔ shipped-skill drift guards -----------------------------------
// The model cites skills/test-automation-workflow as a source but nothing checked
// the skill still carries those invariants. Close that gap (still a bundle test:
// the bundle ships this skill).

test("the shipped skill still carries the AFS status contract the model advances on", () => {
  for (const status of model.advancingAfsStatuses) {
    assert.ok(skillSrc.includes(status), `skill lost the advancing AFS status: ${status}`);
  }
  // the non-advancing statuses the implementer/orchestrator slots gate on
  for (const status of ["blocked", "already-covered", "un-automatable", "defect-found"]) {
    assert.ok(skillSrc.includes(status), `skill lost the AFS refusal status: ${status}`);
  }
});

test("the shipped skill still encodes the No-Defect-Masking forbidden tokens", () => {
  assert.match(skillSrc, /No [Dd]efect [Mm]asking/, "skill lost the No-Defect-Masking rule heading");
  for (const tok of ["test.fail(", "xit(", "@Ignore", "pytest.skip"]) {
    assert.ok(skillSrc.includes(tok), `skill no longer forbids the masking token: ${tok}`);
  }
});

test("the shipped skill still encodes the locator ladder (role before testid)", () => {
  const role = skillSrc.indexOf("getByRole");
  const testid = skillSrc.indexOf("getByTestId");
  assert.ok(role !== -1 && testid !== -1, "locator-ladder tiers missing from the skill");
  assert.ok(role < testid, "locator-ladder order broke: getByRole must precede getByTestId");
});

test("the shipped skill still encodes the manual-before-automate philosophy + the R2 cap", () => {
  assert.match(skillSrc, /do not automate what you have not executed/i, "skill lost the manual-before-automate core philosophy");
  assert.match(skillSrc, /R2 cap|≤\s*2 reruns|2 reruns/i, `skill lost the R2 cap (model.r2Cap=${model.r2Cap})`);
});

// --- model ↔ lint detector parity -----------------------------------------
// Every masking construct the model declares forbidden must actually fire the
// deterministic lint detector — else a forbidden pattern slips through scoring.
test("every model masking pattern is caught by the lint detector (contract ↔ detector parity)", () => {
  for (const p of model.maskingPatterns) {
    assert.ok(lintTestCode(p).maskingHits >= 1, `lint.mjs does not flag a model-declared masking pattern: ${JSON.stringify(p)}`);
  }
});
