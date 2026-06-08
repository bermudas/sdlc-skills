// eval/spine/report.mjs
// ---------------------------------------------------------------------------
// Turn a scored run into a human-readable markdown report + machine JSON, and
// diff it against a baseline. A "run" aggregates whichever scorers fired:
//   { meta:{backend,fixture,case,model,ts,stopReason},
//     routing?, skills?, conformance?, higherLevel?, usage? }
// Sections render only when present. STDLIB ONLY — tested under `node --test`.
// ---------------------------------------------------------------------------

/** Flat map of the headline numbers — used for baseline diff + comparison tables. */
export function headlineMetrics(run = {}) {
  const m = {};
  if (run.conformance) m["S_process"] = run.conformance.S_process;
  if (run.higherLevel) m["outcome.score"] = run.higherLevel.score;
  if (run.routing) m["routing.pass"] = run.routing.pass ? 1 : 0;
  if (run.skills) { m["skills.usedIntended"] = run.skills.usedIntended?.length ?? 0; m["skills.unexpected"] = run.skills.unexpected?.length ?? 0; }
  if (run.usage) m["cost_usd"] = run.usage.costUsd ?? null;
  return m;
}

function overallVerdict(run) {
  const flags = [];
  if (run.higherLevel) flags.push(run.higherLevel.pass);
  if (run.conformance) flags.push(run.conformance.S_process > 0);
  if (run.routing) flags.push(run.routing.pass);
  if (!flags.length) return { label: "—", detail: "(no pass/fail scorer present)" };
  const pass = flags.every(Boolean);
  return { label: pass ? "PASS ✓" : "FAIL ✗", detail: pass ? "" : "(one or more checks failed)" };
}

/** Render the markdown report. `baseline` (a prior run) is optional. */
export function renderReport(run = {}, baseline = null) {
  const m = run.meta || {};
  const L = [];
  L.push(`# Eval report — ${m.case || "run"} · ${m.backend || "?"}`);
  L.push("");
  L.push(`fixture: \`${m.fixture || "-"}\` · model: \`${m.model || "-"}\`${m.ts ? ` · ${m.ts}` : ""}${m.stopReason ? ` · stop: ${m.stopReason}` : ""}`);
  const v = overallVerdict(run);
  L.push("", `**Verdict: ${v.label}** ${v.detail}`);

  if (run.routing) {
    const r = run.routing;
    L.push("", "## Routing", `- dispatched: **${r.dispatched}** · self-answered: ${r.selfAnswered}`, `- routed to: \`${r.routedSlot || "?"}\` (expected \`${r.expectedSlot}\`) → ${r.routedToExpected ? "✓" : "✗"}`);
  }
  if (run.skills) {
    const s = run.skills;
    L.push("", "## Skills", `- invoked: ${s.invoked?.length ? "`" + s.invoked.join("`, `") + "`" : "(none)"}`, `- used-intended: ${s.usedIntended?.length ?? 0} / ${s.intendedCount ?? "?"}` + (s.unexpected?.length ? ` · ⚠ **unexpected**: \`${s.unexpected.join("`, `")}\`` : ""));
  }
  if (run.conformance) {
    const c = run.conformance;
    L.push("", "## Process conformance", `- S_process: **${c.S_process}** · checkpoints ${c.checkpointsPassed}/${c.checkpointsTotal}` + (c.zeroedBy?.length ? ` · **ZEROED by** ${c.zeroedBy.join(", ")}` : ""));
  }
  if (run.higherLevel) {
    const h = run.higherLevel;
    L.push("", "## Outcome (higher-level)", `- score: **${h.score}** → ${h.pass ? "PASS ✓" : "FAIL ✗"}` + (h.failedChecks?.length ? ` · failed: ${h.failedChecks.join(", ")}` : ""));
  }
  if (run.usage) {
    const u = run.usage;
    L.push("", "## Cost / usage", `- cost: **$${u.costUsd ?? "?"}** · out ${u.output ?? "?"} tok · cacheR ${u.cacheRead ?? "?"} · turns ${u.turns ?? "?"}`);
  }
  if (baseline) {
    const diff = compareToBaseline(run, baseline);
    L.push("", "## Δ vs baseline");
    for (const [k, d] of Object.entries(diff)) L.push(`- ${k}: ${fmt(d.base)} → ${fmt(d.now)}  (${d.delta >= 0 ? "+" : ""}${fmt(d.delta)}) ${d.arrow}`);
  }
  return L.join("\n") + "\n";
}

/** Numeric deltas now-vs-baseline for the headline metrics. */
export function compareToBaseline(run, baseline) {
  const a = headlineMetrics(run), b = headlineMetrics(baseline);
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const now = a[k] ?? null, base = b[k] ?? null;
    const delta = typeof now === "number" && typeof base === "number" ? round(now - base) : null;
    out[k] = { now, base, delta, arrow: delta == null ? "" : delta > 0 ? "▲" : delta < 0 ? "▼" : "=" };
  }
  return out;
}

/** Side-by-side markdown table across backends/runs (e.g. Claude vs Copilot). */
export function renderComparison(runs = []) {
  const cols = runs.map((r) => r.meta?.backend || r.meta?.case || "run");
  const keys = [...new Set(runs.flatMap((r) => Object.keys(headlineMetrics(r))))];
  const L = ["| metric | " + cols.join(" | ") + " |", "|---|" + cols.map(() => "---|").join("")];
  for (const k of keys) L.push(`| ${k} | ` + runs.map((r) => fmt(headlineMetrics(r)[k])).join(" | ") + " |");
  return L.join("\n") + "\n";
}

function fmt(x) { return x == null ? "–" : String(x); }
function round(x) { return Math.round(x * 1000) / 1000; }
