// eval/spine/usage.test.mjs — stdlib-only, runs under root `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseClaudeResult,
  parseTranscriptUsage,
  mergeRecords,
  estimateCostUsd,
  cacheHitRate,
  outputShare,
  seriesComposites,
  dollarsPerQualityPoint,
} from "./usage.mjs";

test("parseClaudeResult: reads usage + total_cost_usd from headless JSON", () => {
  const result = {
    type: "result",
    subtype: "success",
    total_cost_usd: 0.1361,
    duration_ms: 47210,
    num_turns: 9,
    session_id: "abc-123",
    usage: {
      input_tokens: 18234,
      output_tokens: 4120,
      cache_read_input_tokens: 142880,
      cache_creation_input_tokens: 20110,
    },
  };
  const rec = parseClaudeResult(result, { model: "claude-sonnet-4-6", toolCalls: 23 });
  assert.equal(rec.model, "claude-sonnet-4-6");
  assert.equal(rec.input, 18234);
  assert.equal(rec.output, 4120);
  assert.equal(rec.cacheRead, 142880);
  assert.equal(rec.costUsd, 0.1361);
  assert.equal(rec.turns, 9);
  assert.equal(rec.toolCalls, 23);
  assert.equal(rec.sessionId, "abc-123");
});

test("parseClaudeResult: accepts a JSON string", () => {
  const rec = parseClaudeResult('{"usage":{"input_tokens":10,"output_tokens":5},"total_cost_usd":0.001}');
  assert.equal(rec.input, 10);
  assert.equal(rec.output, 5);
  assert.equal(rec.costUsd, 0.001);
});

test("parseTranscriptUsage: sums per-message usage, tolerates junk lines", () => {
  const jsonl = [
    JSON.stringify({ message: { model: "claude-opus-4-8", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 500 } } }),
    "not json — should be skipped",
    "",
    JSON.stringify({ message: { usage: { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 200 } } }),
  ].join("\n");
  const rec = parseTranscriptUsage(jsonl);
  assert.equal(rec.input, 150);
  assert.equal(rec.output, 30);
  assert.equal(rec.cacheRead, 500);
  assert.equal(rec.cacheCreation, 200);
  assert.equal(rec.model, "claude-opus-4-8");
});

test("mergeRecords: aggregates parent + subagent transcripts", () => {
  const a = parseTranscriptUsage(JSON.stringify({ message: { usage: { input_tokens: 100, output_tokens: 20 } } }));
  const b = parseTranscriptUsage(JSON.stringify({ message: { usage: { input_tokens: 40, output_tokens: 8 } } }));
  const merged = mergeRecords([a, b]);
  assert.equal(merged.input, 140);
  assert.equal(merged.output, 28);
});

test("estimateCostUsd: prices from token counts (fallback path)", () => {
  // 1M sonnet input @ $3 + 1M output @ $15 = $18.00
  const rec = { model: "claude-sonnet-4-6", input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreation: 0 };
  assert.equal(estimateCostUsd(rec), 18);
  // family-prefix resolution works for an unknown exact id
  assert.ok(estimateCostUsd({ model: "claude-sonnet-4-6-20990101", input: 1_000_000, output: 0 }) === 3);
});

test("cacheHitRate + outputShare", () => {
  const rec = { input: 100, output: 50, cacheRead: 300, cacheCreation: 100 };
  assert.equal(cacheHitRate(rec), 300 / 500); // read / (input+read+creation)
  assert.equal(outputShare(rec), 50 / (50 + 500));
});

test("seriesComposites: joins cost with quality outcomes", () => {
  const records = [
    { model: "claude-sonnet-4-6", input: 0, output: 0, cacheRead: 0, cacheCreation: 0, costUsd: 0.10 },
    { model: "claude-sonnet-4-6", input: 0, output: 0, cacheRead: 0, cacheCreation: 0, costUsd: 0.30 },
  ];
  const c = seriesComposites({ records, resolved: 2, trueDetections: 4, passK: 0.5 });
  assert.equal(c.totalCostUsd.toFixed(2), "0.40");
  assert.equal(c.costPerRun.toFixed(2), "0.20");
  assert.equal(c.costPerResolved.toFixed(2), "0.20");
  assert.equal(c.costPerTrueBug.toFixed(2), "0.10");
  assert.equal(c.reliabilityAdjustedCost.toFixed(2), "0.40"); // 0.20 / 0.5
});

test("dollarsPerQualityPoint: Δcost / Δquality, null on zero delta", () => {
  assert.equal(dollarsPerQualityPoint(0.10, 0.05), 2);
  assert.equal(dollarsPerQualityPoint(0.10, 0), null);
});
