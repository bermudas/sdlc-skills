// eval/spine/skills.test.mjs — stdlib-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntendedSkills, invokedSkills, resolveSkills, scoreSkillLoading } from "./skills.mjs";

const QA_FM = `---
name: qa-engineer
model: sonnet
skills: [playwright-testing, playwright-cli, browser-verify, reproducing-issues, test-case-analysis, memory]
---`;

test("parseIntendedSkills reads the frontmatter skills list", () => {
  const s = parseIntendedSkills(QA_FM);
  assert.ok(s.includes("playwright-testing"));
  assert.ok(s.includes("test-case-analysis"));
  assert.equal(s.length, 6);
});

test("invokedSkills detects a SDK Skill tool_use", () => {
  const tc = [{ name: "Skill", input: { skill: "reproducing-issues" } }, { name: "Bash", input: {} }];
  assert.deepEqual(invokedSkills(tc), ["reproducing-issues"]);
});

test("invokedSkills detects an ACP skill-titled tool_call (heuristic)", () => {
  const tc = [{ title: "Run the test-case-analysis skill" }];
  assert.deepEqual(invokedSkills(tc, ["test-case-analysis", "playwright-testing"]), ["test-case-analysis"]);
});

test("invokedSkills reads the ACP Skill tool_call rawInput (real shape)", () => {
  // exactly what claude-agent-acp emits: title "Skill", rawInput.skill = the id
  const tc = [{ title: "Skill", kind: "other", rawInput: { skill: "reproducing-issues", args: "..." } }];
  assert.deepEqual(invokedSkills(tc), ["reproducing-issues"]);
});

test("resolveSkills flags skills that don't resolve to installed content", () => {
  const r = resolveSkills(["playwright-testing", "ghost-skill"], (s) => s !== "ghost-skill");
  assert.deepEqual(r.missing, ["ghost-skill"]);
  assert.equal(r.allResolve, false);
});

test("scoreSkillLoading separates used-intended from unexpected", () => {
  const s = scoreSkillLoading({ intended: ["playwright-testing", "test-case-analysis"], invoked: ["test-case-analysis", "some-other-skill"] });
  assert.deepEqual(s.usedIntended, ["test-case-analysis"]);
  assert.deepEqual(s.unexpected, ["some-other-skill"]); // invoked a skill it never declared
});
