// eval/spine/report.test.mjs — stdlib-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, headlineMetrics, compareToBaseline, renderComparison } from "./report.mjs";

const RUN = {
  meta: { backend: "claude (SDK)", fixture: "todomvc", case: "use-skill", model: "claude-sonnet-4-6", stopReason: "end_turn" },
  skills: { intendedCount: 10, invoked: ["reproducing-issues"], usedIntended: ["reproducing-issues"], unexpected: [] },
  routing: { dispatched: true, selfAnswered: false, routedSlot: "qa-engineer", expectedSlot: "qa-engineer", routedToExpected: true, pass: true },
  usage: { costUsd: 0.12, output: 342, cacheRead: 55281, turns: 3 },
};

test("renderReport emits the present sections + a verdict", () => {
  const md = renderReport(RUN);
  assert.match(md, /# Eval report — use-skill · claude \(SDK\)/);
  assert.match(md, /\*\*Verdict: PASS/);
  assert.match(md, /## Routing/);
  assert.match(md, /## Skills/);
  assert.match(md, /reproducing-issues/);
  assert.match(md, /## Cost \/ usage/);
  assert.doesNotMatch(md, /## Process conformance/); // absent scorer → no section
});

test("renderReport flags a zeroed conformance run as FAIL", () => {
  const md = renderReport({ meta: { case: "x" }, conformance: { S_process: 0, checkpointsPassed: 3, checkpointsTotal: 6, zeroedBy: ["gate:reviewer-approved"] } });
  assert.match(md, /\*\*Verdict: FAIL/);
  assert.match(md, /ZEROED by/);
  assert.match(md, /gate:reviewer-approved/);
});

test("headlineMetrics + compareToBaseline compute deltas", () => {
  const base = { ...RUN, usage: { costUsd: 0.10 } };
  const d = compareToBaseline(RUN, base);
  assert.equal(d["cost_usd"].delta, 0.02);
  assert.equal(d["cost_usd"].arrow, "▲");
});

test("renderComparison builds a cross-backend table", () => {
  const copilot = { meta: { backend: "copilot (ACP)" }, routing: { pass: true }, skills: { usedIntended: ["reproducing-issues"], unexpected: [] } };
  const md = renderComparison([RUN, copilot]);
  assert.match(md, /\| metric \| claude \(SDK\) \| copilot \(ACP\) \|/);
  assert.match(md, /routing\.pass/);
});
