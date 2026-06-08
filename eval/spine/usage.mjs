// eval/spine/usage.mjs
// ---------------------------------------------------------------------------
// Per-run usage/cost attribution for the eval harness.
//
// Priority of sources (see eval/design/efficiency-and-cost.md §4):
//   1. `claude -p --output-format json` result  → authoritative; total_cost_usd
//      already includes subagent/workflow cost. Use parseClaudeResult().
//   2. transcript JSONL parse (+ subagent transcripts) → fallback when no
//      headless result. Use parseTranscriptUsage() / readTranscriptUsage().
//   3. ccusage --json → cross-check & dashboards only, never the per-task join.
//      Use ccusageCrossCheck().
//
// STDLIB ONLY — no dependencies — so this unit-tests under root `node --test`
// (see usage.test.mjs). The eval/ workspace MAY use deps elsewhere; this module
// deliberately does not, to stay in the zero-dep test path.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Normalized usage record shape (all token fields are integers, cost is USD):
//   { model, input, output, cacheRead, cacheCreation, costUsd,
//     wallMs, turns, toolCalls, sessionId }
function emptyRecord() {
  return {
    model: null,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
    costUsd: null,
    wallMs: null,
    turns: null,
    toolCalls: null,
    sessionId: null,
  };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// --- Pricing fallback (USD per 1M tokens) -----------------------------------
// ONLY used by estimateCostUsd() when no logged cost exists. `total_cost_usd`
// from `claude -p` and ccusage (LiteLLM pricing) are the authorities — keep
// this table in sync or override via the `pricing` arg. Verify before trusting.
export const PRICING = {
  "claude-opus-4-8": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

// Resolve a pricing row by exact id, then by family prefix (opus/sonnet/haiku).
function priceFor(model, pricing = PRICING) {
  if (!model) return null;
  if (pricing[model]) return pricing[model];
  for (const fam of ["opus", "sonnet", "haiku"]) {
    if (model.includes(fam)) {
      const hit = Object.entries(pricing).find(([k]) => k.includes(fam));
      if (hit) return hit[1];
    }
  }
  return null;
}

/** Estimate cost from token counts + the pricing table (fallback path only). */
export function estimateCostUsd(record, pricing = PRICING) {
  const p = priceFor(record.model, pricing);
  if (!p) return null;
  const m = 1_000_000;
  return (
    (num(record.input) * p.input +
      num(record.output) * p.output +
      num(record.cacheCreation) * p.cacheWrite +
      num(record.cacheRead) * p.cacheRead) /
    m
  );
}

// --- Source 1: `claude -p --output-format json` ----------------------------
/**
 * Normalize the headless result object (or its JSON string) from
 * `claude -p --output-format json`. `model` is passed by the caller because the
 * runner knows which `--model` it dispatched; toolCalls is optional (the result
 * JSON does not reliably carry it — derive from stream-json if needed).
 */
export function parseClaudeResult(resultOrJson, { model = null, toolCalls = null } = {}) {
  const r = typeof resultOrJson === "string" ? JSON.parse(resultOrJson) : resultOrJson;
  const u = r?.usage ?? {};
  const rec = emptyRecord();
  rec.model = model ?? r?.model ?? null;
  rec.input = num(u.input_tokens);
  rec.output = num(u.output_tokens);
  rec.cacheRead = num(u.cache_read_input_tokens);
  rec.cacheCreation = num(u.cache_creation_input_tokens);
  rec.costUsd = typeof r?.total_cost_usd === "number" ? r.total_cost_usd : null;
  rec.wallMs = typeof r?.duration_ms === "number" ? r.duration_ms : null;
  rec.turns = typeof r?.num_turns === "number" ? r.num_turns : null;
  rec.toolCalls = toolCalls;
  rec.sessionId = r?.session_id ?? null;
  return rec;
}

// --- Source 2: transcript JSONL parse --------------------------------------
/**
 * Sum the per-message `usage` objects in a Claude Code session transcript
 * (one JSON object per line). Assistant messages carry
 * `message.usage.{input_tokens,output_tokens,cache_*}` and `message.model`.
 * No logged cost in the transcript → costUsd stays null (estimate separately).
 */
export function parseTranscriptUsage(jsonlText) {
  const rec = emptyRecord();
  for (const line of jsonlText.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let obj;
    try {
      obj = JSON.parse(s);
    } catch {
      continue; // tolerate partial/non-JSON lines
    }
    const msg = obj.message ?? obj;
    const u = msg?.usage;
    if (!u) continue;
    rec.input += num(u.input_tokens);
    rec.output += num(u.output_tokens);
    rec.cacheRead += num(u.cache_read_input_tokens);
    rec.cacheCreation += num(u.cache_creation_input_tokens);
    if (!rec.model && msg?.model) rec.model = msg.model;
    if (!rec.sessionId && obj?.sessionId) rec.sessionId = obj.sessionId;
  }
  return rec;
}

/** Merge several normalized records (parent + subagent transcripts) into one. */
export function mergeRecords(records) {
  const out = emptyRecord();
  for (const r of records) {
    if (!r) continue;
    out.input += num(r.input);
    out.output += num(r.output);
    out.cacheRead += num(r.cacheRead);
    out.cacheCreation += num(r.cacheCreation);
    if (typeof r.costUsd === "number") out.costUsd = num(out.costUsd) + r.costUsd;
    if (typeof r.wallMs === "number") out.wallMs = Math.max(num(out.wallMs), r.wallMs);
    if (typeof r.turns === "number") out.turns = num(out.turns) + r.turns;
    if (typeof r.toolCalls === "number") out.toolCalls = num(out.toolCalls) + r.toolCalls;
    if (!out.model && r.model) out.model = r.model;
    if (!out.sessionId && r.sessionId) out.sessionId = r.sessionId;
  }
  return out;
}

/** Read + parse + merge one or more transcript JSONL files (parent + subagents). */
export function readTranscriptUsage(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  return mergeRecords(list.map((p) => parseTranscriptUsage(readFileSync(p, "utf8"))));
}

// --- Source 3: ccusage cross-check (best-effort) ---------------------------
/**
 * Shell out to ccusage for a filtered rollup. Returns parsed JSON or null on any
 * failure (ccusage not installed, no network for pricing, bad args). Never throws
 * — it is a cross-check, not a dependency. Point it at the eval-only config dir
 * via `configDir` (sets CLAUDE_CONFIG_DIR).
 */
export function ccusageCrossCheck({
  command = "daily",
  since,
  until,
  configDir,
  offline = true,
  bin = "npx",
} = {}) {
  const args =
    bin === "npx"
      ? ["ccusage@latest", command, "--json"]
      : [command, "--json"];
  if (since) args.push("--since", String(since));
  if (until) args.push("--until", String(until));
  if (offline) args.push("--offline");
  const env = { ...process.env };
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  try {
    const out = execFileSync(bin, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

// --- Derived / composite metrics -------------------------------------------
/** Cache-hit rate over all prompt tokens (read / (input + read + creation)). */
export function cacheHitRate(rec) {
  const denom = num(rec.input) + num(rec.cacheRead) + num(rec.cacheCreation);
  return denom > 0 ? num(rec.cacheRead) / denom : 0;
}

/** Output token share of total tokens. */
export function outputShare(rec) {
  const totalIn = num(rec.input) + num(rec.cacheRead) + num(rec.cacheCreation);
  const denom = num(rec.output) + totalIn;
  return denom > 0 ? num(rec.output) / denom : 0;
}

/**
 * Series composites joining cost with quality outcomes.
 *   records:        normalized usage records (one per run)
 *   resolved:       # of fixtures/issues resolved across the series
 *   trueDetections: # of true bug detections (precision-weighted upstream)
 *   passK:          reliability (pass^k) in [0,1] for reliability-adjusted cost
 */
export function seriesComposites({ records, resolved = 0, trueDetections = 0, passK = null }) {
  const merged = mergeRecords(records);
  const totalCost =
    typeof merged.costUsd === "number" ? merged.costUsd : estimateCostUsd(merged) ?? 0;
  const n = records.filter(Boolean).length || 1;
  const perAttempt = totalCost / n;
  return {
    totalCostUsd: totalCost,
    costPerRun: perAttempt,
    costPerResolved: resolved > 0 ? totalCost / resolved : null,
    costPerTrueBug: trueDetections > 0 ? totalCost / trueDetections : null,
    reliabilityAdjustedCost: passK && passK > 0 ? perAttempt / passK : null,
    cacheHitRate: cacheHitRate(merged),
    outputShare: outputShare(merged),
    tokens: {
      input: merged.input,
      output: merged.output,
      cacheRead: merged.cacheRead,
      cacheCreation: merged.cacheCreation,
    },
  };
}

/** Δcost / Δquality vs a baseline — the "is this edit worth it?" number. */
export function dollarsPerQualityPoint(deltaCostUsd, deltaQuality) {
  if (!deltaQuality) return null;
  return deltaCostUsd / deltaQuality;
}
