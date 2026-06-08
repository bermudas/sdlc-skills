// eval/spine/judge.test.mjs — stdlib-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scaleMax, buildJudgePrompt, judgeSchema, scoreRubric } from "./judge.mjs";

const RUBRIC = {
  task: "scout-seeding", scale: "0-3", passThreshold: 0.7,
  criteria: [
    { id: "framework", weight: 3, question: "framework + run cmd?" },
    { id: "pkg", weight: 1, question: "package manager?" },
    { id: "accuracy", weight: 3, question: "no fabrication?" },
  ],
};

test("scaleMax parses the scale", () => {
  assert.equal(scaleMax("0-3"), 3);
  assert.equal(scaleMax("0-1"), 1);
});

test("buildJudgePrompt includes every criterion + the artifact + schema instruction", () => {
  const p = buildJudgePrompt(RUBRIC, "Framework: Playwright. Run: npx playwright test. pnpm.");
  assert.match(p, /\[framework\]/);
  assert.match(p, /\[accuracy\]/);
  assert.match(p, /npx playwright test/);
  assert.match(p, /Return JSON/);
});

test("scoreRubric: weighted aggregation + pass threshold", () => {
  // perfect: all 3/3 → score 1
  const perfect = scoreRubric([{ id: "framework", score: 3 }, { id: "pkg", score: 3 }, { id: "accuracy", score: 3 }], RUBRIC);
  assert.equal(perfect.score, 1);
  assert.equal(perfect.pass, true);

  // fabrication tanks accuracy (weight 3): got = 3*3 + 1*3 + 3*0 = 12 ; max = 7*3 = 21 → 0.571 → fail
  const fab = scoreRubric([{ id: "framework", score: 3 }, { id: "pkg", score: 3 }, { id: "accuracy", score: 0, evidence: "says npm but repo uses pnpm" }], RUBRIC);
  assert.equal(fab.score, round(12 / 21));
  assert.equal(fab.pass, false);
});

test("scoreRubric: unanswered criteria count as 0 and are reported", () => {
  const s = scoreRubric([{ id: "framework", score: 3 }], RUBRIC);
  assert.deepEqual(s.unanswered.sort(), ["accuracy", "pkg"]);
  assert.equal(s.detail.find((d) => d.id === "pkg").answered, false);
});

test("judgeSchema is a valid structured-output shape", () => {
  const s = judgeSchema();
  assert.equal(s.type, "object");
  assert.equal(s.properties.results.type, "array");
});

const round = (x) => Math.round(x * 1000) / 1000;
