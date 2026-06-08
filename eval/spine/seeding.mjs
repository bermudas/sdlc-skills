// eval/spine/seeding.mjs
// ---------------------------------------------------------------------------
// Scout (seeding-a-project) scorer — the FOUNDATION of an E2E run. A real run
// starts here: scout seeds the project, hooks inject the artifacts, then the
// team works. We score scout on three things (eval/design/dev-core-roles-eval.md §5):
//   1. Artifact presence/structure — did it produce the expected files?
//   2. Fact recall/precision — does the content capture ground-truth facts,
//      WITHOUT fabricating wrong ones (saying npm when it's pnpm is dangerous —
//      downstream agents act on it)?
//   3. Injection — do the hooks actually deliver the artifacts to the agents?
//
// PURE functions over already-gathered inputs → STDLIB ONLY, tested under
// `node --test`. The "gather" side (run scout, run the hooks, read files) lives
// in the driver; this module scores what it gathered.
// ---------------------------------------------------------------------------

export function defaultScoutModel() {
  return {
    requiredArtifacts: [
      "CLAUDE.md", "AGENTS.md",
      ".agents/profile.md", ".agents/workflow.md", ".agents/testing.md", ".agents/team-comms.md",
    ],
    requiredPerRole: [".agents/memory/<role>/MEMORY.md", ".agents/memory/<role>/project_briefing.md"],
    requiredInjectedShared: [".agents/profile.md", ".agents/workflow.md", ".agents/testing.md", ".agents/team-comms.md"],
  };
}

/**
 * Artifact presence/structure.
 *   present : array of generated paths (per-role paths already expanded, e.g.
 *            ".agents/memory/qa-engineer/MEMORY.md")
 *   roles  : roles that should each have memory artifacts (optional)
 */
export function scoreArtifacts(present = [], { roles = [], model = defaultScoutModel() } = {}) {
  const set = new Set(present);
  const required = [...model.requiredArtifacts];
  for (const role of roles) for (const tpl of model.requiredPerRole) required.push(tpl.replace("<role>", role));

  const missing = required.filter((r) => !set.has(r));
  const presentRequired = required.filter((r) => set.has(r));
  return {
    requiredTotal: required.length,
    presentCount: presentRequired.length,
    missing,
    coverage: required.length ? round(presentRequired.length / required.length) : 1,
  };
}

/**
 * Fact recall + precision over the generated text.
 *   facts : [{ key, value, wrongValues?:[], dangerousIfWrong?:bool }]
 *   doc   : combined generated text (CLAUDE.md + .agents/*.md), or a single doc
 * recall      = facts whose `value` appears
 * fabrications = facts where a `wrongValue` appears (esp. when the right one doesn't)
 */
export function scoreFactRecall(facts = [], doc = "") {
  const hay = String(doc);
  // whole-token match so "pnpm" doesn't count as a mention of "npm"
  const mentions = (term) => {
    const esc = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, "i").test(hay);
  };
  const captured = [], missed = [], fabrications = [], dangerousErrors = [];
  for (const f of facts) {
    const has = f.value != null && mentions(f.value);
    const wrong = (f.wrongValues || []).filter((w) => mentions(w));
    if (has) captured.push(f.key); else missed.push(f.key);
    if (wrong.length) fabrications.push({ key: f.key, sawInstead: wrong });
    if (f.dangerousIfWrong && (!has || wrong.length)) dangerousErrors.push(f.key);
  }
  const n = facts.length || 1;
  return {
    recall: round(captured.length / n),
    captured,
    missed,
    fabrications,
    dangerousErrors, // these are the ones that mislead downstream agents
    clean: fabrications.length === 0 && dangerousErrors.length === 0,
  };
}

/**
 * Did the hooks actually inject the required shared docs + role memory?
 *   injection : { shared:[paths injected], memory:bool }
 * Pure assessment of what the driver captured by running the hooks against the
 * seeded fixture (verifies the artifacts→hooks chain the user called out).
 */
export function assessInjection(injection = {}, model = defaultScoutModel()) {
  const got = new Set(injection.shared || []);
  const missingShared = model.requiredInjectedShared.filter((p) => !got.has(p));
  return {
    sharedOk: missingShared.length === 0,
    memoryOk: injection.memory === true,
    missingShared,
    ok: missingShared.length === 0 && injection.memory === true,
  };
}

/** Roll the three sub-scores into one seeding scorecard. */
export function scoreSeeding({ present, roles, facts, doc, injection, model = defaultScoutModel() }) {
  const artifacts = scoreArtifacts(present, { roles, model });
  const factScore = scoreFactRecall(facts, doc);
  const inject = assessInjection(injection, model);
  // Seeding is "good enough to build on" only if artifacts present, injection works,
  // and no dangerous fabricated facts (which would actively mislead the team).
  const usable = artifacts.missing.length === 0 && inject.ok && factScore.dangerousErrors.length === 0;
  return { artifacts, facts: factScore, injection: inject, usable };
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
