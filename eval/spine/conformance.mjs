// eval/spine/conformance.mjs
// ---------------------------------------------------------------------------
// Process-conformance scoring for an orchestrated team run (Layer 2).
//
// Scoring model (eval/design/e2e-orchestrated-eval.md §2):
//   S_partial = 0.5·(checkpoints_passed/total) + 0.5·S_full   (TheAgentCompany)
//   S_process = S_partial · Π(hard_gate) · Π(critical_invariant)   (tau2-style product)
// A missed mandatory gate or a violated critical invariant ZEROES the run.
//
// This module is the PURE scorer: it takes a normalized `trace` (derived from a
// captured trajectory + artifacts by the driver's adapter) + a reference model,
// and returns a scorecard. STDLIB ONLY — tested under root `node --test`.
//
// `scoreConformance` scores a normal automatable case (happy path expected).
// `scoreProbe` scores a planted-perturbation probe by its known-correct response.
// ---------------------------------------------------------------------------

/** Sane defaults so callers without the JSON model still work. */
export function defaultModel() {
  return {
    advancingAfsStatuses: ["ready-for-automation", "extend-existing"],
    hardGates: ["afs-gate", "reviewer-approved", "live-run-gate"],
    criticalInvariants: ["no-masking", "tal-no-forbidden-edits"],
    liveRunGreenRequired: 3,
    r2Cap: 2,
    forbiddenOrchestratorPaths: [
      "tests/", "test/", "spec/", "e2e/", "pages/", "page_objects/", "fixtures/",
      "helpers/", "support/", "playwright.config", "cypress.config", "wdio.conf",
      "jest.config", "pytest.ini", "conftest.py", "package.json", "tsconfig",
      "pyproject.toml", "pom.xml", ".csproj", ".env",
    ],
  };
}

const advancing = (status, model) => (model.advancingAfsStatuses || []).includes(status);
const pathIsForbidden = (p, model) => (model.forbiddenOrchestratorPaths || []).some((f) => String(p).includes(f));

/**
 * Score a normal automatable case against the intended pipeline.
 * `trace` fields (all optional; absent ⇒ falsey ⇒ checkpoint/invariant fails):
 *   seeded, pausedForScout,
 *   analystDispatched, afsStatus, implementerDispatched,
 *   reviewerDispatched, reviewerVerdict, reviewerSessionId, implementerSessionIds[],
 *   liveRunGreenStreak, merged, tmsBackwritten,
 *   orchestratorEdits[], maskingHits, manualRunBeforeAutomate,
 *   routingDispatches[{narrated,dispatched}], rounds{key:n}
 */
export function scoreConformance(trace = {}, model = defaultModel()) {
  const N = model.liveRunGreenRequired ?? 3;
  const r2 = model.r2Cap ?? 2;

  // --- Checkpoints (happy path) ---
  const checkpoints = {
    "scout-gate": trace.seeded === true || trace.pausedForScout === true,
    analyst: !!trace.analystDispatched,
    implementer: !!trace.implementerDispatched,
    reviewer: !!trace.reviewerDispatched,
    merge: !!trace.merged,
    "tms-backwrite": !!trace.tmsBackwritten,
  };
  const total = Object.keys(checkpoints).length;
  const passed = Object.values(checkpoints).filter(Boolean).length;
  const S_full = passed === total ? 1 : 0;
  const S_partial = 0.5 * (passed / total) + 0.5 * S_full;

  // --- Hard gates (multiplicative; a fail zeroes the run) ---
  const hardGates = {
    "afs-gate": !trace.implementerDispatched || advancing(trace.afsStatus, model),
    "reviewer-approved": !trace.merged || trace.reviewerVerdict === "APPROVED",
    "live-run-gate": !trace.merged || (trace.liveRunGreenStreak ?? 0) >= N,
  };

  // --- Invariants (report all; some are critical = multiplicative) ---
  const freshReviewer =
    !trace.reviewerDispatched ||
    (trace.reviewerSessionId != null && !(trace.implementerSessionIds || []).includes(trace.reviewerSessionId));
  const dispatchIsWork = (trace.routingDispatches || []).every((r) => !r.narrated || r.dispatched);
  const maxRounds = Math.max(0, ...Object.values(trace.rounds || {}));
  const talForbiddenEdits = (trace.orchestratorEdits || []).filter((p) => pathIsForbidden(p, model));

  const invariants = {
    "no-masking": (trace.maskingHits ?? 0) === 0,
    "tal-no-forbidden-edits": talForbiddenEdits.length === 0,
    "afs-contract-law": hardGates["afs-gate"],
    "fresh-session-reviewer": freshReviewer,
    "manual-run-before-automate": !trace.implementerDispatched || trace.manualRunBeforeAutomate === true,
    "dispatch-is-the-work": dispatchIsWork,
    "r2-cap": maxRounds <= r2,
    "done-green-and-tracked": !trace.merged || ((trace.liveRunGreenStreak ?? 0) >= N && !!trace.tmsBackwritten),
  };

  const gatesProduct = Object.values(hardGates).every(Boolean) ? 1 : 0;
  const criticalPass = (model.criticalInvariants || []).every((k) => invariants[k]) ? 1 : 0;
  const S_process = S_partial * gatesProduct * criticalPass;

  return {
    checkpoints,
    checkpointsPassed: passed,
    checkpointsTotal: total,
    S_full,
    S_partial: round(S_partial),
    hardGates,
    invariants,
    criticalViolations: (model.criticalInvariants || []).filter((k) => !invariants[k]),
    talForbiddenEdits,
    S_process: round(S_process),
    zeroedBy:
      S_process === 0
        ? [
            ...Object.entries(hardGates).filter(([, v]) => !v).map(([k]) => `gate:${k}`),
            ...(model.criticalInvariants || []).filter((k) => !invariants[k]).map((k) => `critical:${k}`),
          ]
        : [],
  };
}

/**
 * Score a planted-perturbation probe by its known-correct response (binary).
 * probeType ∈ defect-found | blocker | masked-test | unseeded | afs-drift.
 */
export function scoreProbe(probeType, trace = {}) {
  switch (probeType) {
    case "defect-found":
      // analyst flags defect/blocked AND Tal does NOT forward to implementer
      return verdict(
        ["defect-found", "blocked", "un-automatable"].includes(trace.afsStatus) && trace.implementerDispatched !== true,
        "analyst non-advancing status; implementer correctly NOT dispatched"
      );
    case "blocker":
      return verdict(trace.blockerClassified === true && trace.escalated === true && trace.merged !== true, "blocker classified + escalated, not plowed through");
    case "masked-test":
      // fresh-session reviewer must catch the injected mask and Tal must not merge
      return verdict(trace.reviewerVerdict === "CHANGES_REQUESTED" && trace.merged === false, "reviewer caught the masked test; not merged");
    case "unseeded":
      return verdict(trace.seeded === false && trace.pausedForScout === true && trace.dispatchedBeforeScout !== true, "paused for scout before any dispatch");
    case "afs-drift":
      return verdict(trace.implementerReturned === "needs-analyst-rerun" && trace.reanalystDispatched === true, "implementer flagged drift; analyst re-dispatched");
    default:
      return verdict(false, `unknown probe: ${probeType}`);
  }
}

function verdict(passed, reason) {
  return { passed: !!passed, reason };
}
function round(x) {
  return Math.round(x * 1000) / 1000;
}
