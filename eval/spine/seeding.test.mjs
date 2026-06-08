// eval/spine/seeding.test.mjs — stdlib-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreArtifacts, scoreFactRecall, assessInjection, scoreSeeding } from "./seeding.mjs";

const fullPresent = [
  "CLAUDE.md", "AGENTS.md",
  ".agents/profile.md", ".agents/workflow.md", ".agents/testing.md", ".agents/team-comms.md",
  ".agents/memory/qa-engineer/MEMORY.md", ".agents/memory/qa-engineer/project_briefing.md",
];

test("scoreArtifacts: full set → coverage 1, nothing missing", () => {
  const s = scoreArtifacts(fullPresent, { roles: ["qa-engineer"] });
  assert.equal(s.coverage, 1);
  assert.deepEqual(s.missing, []);
});

test("scoreArtifacts: missing testing.md is reported", () => {
  const s = scoreArtifacts(fullPresent.filter((p) => p !== ".agents/testing.md"), { roles: ["qa-engineer"] });
  assert.ok(s.missing.includes(".agents/testing.md"));
  assert.ok(s.coverage < 1);
});

test("scoreArtifacts: per-role memory required for each role", () => {
  const s = scoreArtifacts(fullPresent, { roles: ["qa-engineer", "test-automation-lead"] });
  assert.ok(s.missing.includes(".agents/memory/test-automation-lead/MEMORY.md"));
});

const facts = [
  { key: "pkgManager", value: "pnpm", wrongValues: ["npm", "yarn"], dangerousIfWrong: true },
  { key: "testCmd", value: "pnpm test:e2e", dangerousIfWrong: true },
  { key: "framework", value: "Playwright" },
];

test("scoreFactRecall: correct doc → full recall, clean", () => {
  const doc = "Package manager: pnpm. Run e2e with `pnpm test:e2e`. Framework: Playwright.";
  const s = scoreFactRecall(facts, doc);
  assert.equal(s.recall, 1);
  assert.equal(s.clean, true);
  assert.deepEqual(s.fabrications, []);
});

test("scoreFactRecall: saying npm when it's pnpm is a DANGEROUS fabrication", () => {
  const doc = "Install with `npm install`, run `npm test`. Framework: Playwright.";
  const s = scoreFactRecall(facts, doc);
  assert.ok(s.missed.includes("pkgManager"));
  assert.ok(s.fabrications.some((f) => f.key === "pkgManager" && f.sawInstead.includes("npm")));
  assert.ok(s.dangerousErrors.includes("pkgManager"));
  assert.equal(s.clean, false);
});

test("assessInjection: required shared docs + memory must be injected", () => {
  const ok = assessInjection({ shared: [".agents/profile.md", ".agents/workflow.md", ".agents/testing.md", ".agents/team-comms.md"], memory: true });
  assert.equal(ok.ok, true);
  const bad = assessInjection({ shared: [".agents/profile.md"], memory: false });
  assert.equal(bad.ok, false);
  assert.ok(bad.missingShared.includes(".agents/testing.md"));
  assert.equal(bad.memoryOk, false);
});

test("scoreSeeding: usable only when artifacts + injection + no dangerous fabrications", () => {
  const good = scoreSeeding({
    present: fullPresent, roles: ["qa-engineer"], facts,
    doc: "pnpm; `pnpm test:e2e`; Playwright",
    injection: { shared: [".agents/profile.md", ".agents/workflow.md", ".agents/testing.md", ".agents/team-comms.md"], memory: true },
  });
  assert.equal(good.usable, true);

  // a dangerous wrong fact makes it unusable even if everything else is fine
  const wrongFact = scoreSeeding({
    present: fullPresent, roles: ["qa-engineer"], facts,
    doc: "npm; `npm test`; Playwright",
    injection: { shared: [".agents/profile.md", ".agents/workflow.md", ".agents/testing.md", ".agents/team-comms.md"], memory: true },
  });
  assert.equal(wrongFact.usable, false);
});
