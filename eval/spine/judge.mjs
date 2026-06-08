// eval/spine/judge.mjs
// ---------------------------------------------------------------------------
// LLM-as-judge grader. A rubric (eval/rubrics/<task>.json) is a reviewable list
// of weighted criteria/questions. judge builds a prompt + structured-output
// schema for an LLM to answer each criterion against the produced artifact/session;
// scoreRubric (pure) aggregates the weighted score. The LLM call lives in
// driver/grade.mjs; the prompt-building + scoring math here are STDLIB + tested.
//
// Keep judges honest (per the design): per-criterion 0–3 with evidence quotes,
// an "unanswered" path, and (in the driver) double-judge + read transcripts.
// ---------------------------------------------------------------------------

/** Max points per criterion from the rubric scale ("0-3" → 3, "0-1"/binary → 1). */
export function scaleMax(scale = "0-3") {
  const m = String(scale).match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 3;
}

/** Build the judge prompt: the rubric questions + the artifact, asking for per-criterion scores + evidence. */
export function buildJudgePrompt(rubric, artifact) {
  const max = scaleMax(rubric.scale);
  const lines = [
    `You are an exacting evaluator grading the output of a "${rubric.task}" task.`,
    `Score EACH criterion from 0 to ${max} (0 = absent/wrong, ${max} = fully satisfied). Quote a short piece of evidence from the artifact for each, or say "none" if absent.`,
    `Do not be generous: a fabricated or contradictory fact scores 0 on accuracy criteria.`,
    ``,
    `## Criteria`,
    ...rubric.criteria.map((c) => `- [${c.id}] (weight ${c.weight}) ${c.question}`),
    ``,
    `## Artifact under evaluation`,
    "```",
    String(artifact).slice(0, 60000),
    "```",
    ``,
    `Return JSON: { "results": [ { "id", "score" (0-${max}), "evidence" } ... ] } — one entry per criterion id above.`,
  ];
  return lines.join("\n");
}

/** JSON schema for the LLM's structured output (for claude -p --json-schema / SDK). */
export function judgeSchema() {
  return {
    type: "object", additionalProperties: false,
    properties: {
      results: {
        type: "array",
        items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, score: { type: "number" }, evidence: { type: "string" } }, required: ["id", "score"] },
      },
    },
    required: ["results"],
  };
}

/** Aggregate the LLM's per-criterion answers into a weighted score. PURE. */
export function scoreRubric(results = [], rubric) {
  const max1 = scaleMax(rubric.scale);
  const byId = Object.fromEntries((results || []).map((r) => [r.id, r]));
  let got = 0, maxTotal = 0;
  const detail = [];
  for (const c of rubric.criteria) {
    const r = byId[c.id];
    const score = r ? clamp(Number(r.score) || 0, 0, max1) : 0;
    got += c.weight * score;
    maxTotal += c.weight * max1;
    detail.push({ id: c.id, weight: c.weight, score, answered: !!r, evidence: r?.evidence || null });
  }
  const norm = maxTotal ? got / maxTotal : 0;
  return {
    score: round(norm),
    got,
    max: maxTotal,
    pass: norm >= (rubric.passThreshold ?? 0.7),
    unanswered: rubric.criteria.filter((c) => !byId[c.id]).map((c) => c.id),
    detail,
  };
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round = (x) => Math.round(x * 1000) / 1000;
