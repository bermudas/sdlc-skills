// eval/spine/extract-trace.mjs
// ---------------------------------------------------------------------------
// Turn a captured trajectory (eventLog from trajectory.mjs) into the normalized
// `trace` that conformance.mjs scores. Some facts live IN the trajectory
// (dispatches, orchestrator edits); others can only come from artifacts/git/PR
// state (merged?, afsStatus, reviewerVerdict, maskingHits from diff lint) — those
// are passed in as `ext`. PURE — tested under `node --test`.
//
// Note: analyst and reviewer are BOTH the qa-engineer agent type, so we separate
// them by the dispatch prompt ("review"…) and by order; `ext` can override.
// ---------------------------------------------------------------------------

export function extractTrace(eventLog, ext = {}) {
  const dispatches = eventLog.dispatches || [];
  const has = (t) => dispatches.some((d) => d.subagentType === t);
  const qa = dispatches.filter((d) => d.subagentType === "qa-engineer");
  const reviewerDisp = qa.find((d) => /review/i.test(d.input?.prompt || "")) || (qa.length >= 2 ? qa[qa.length - 1] : null);

  const rootCalls = eventLog.agents?.root?.toolCalls || [];
  const orchestratorEdits = rootCalls
    .filter((c) => c.name === "Edit" || c.name === "Write")
    .map((c) => c.input?.file_path || c.input?.path || "");

  return {
    // from the trajectory
    analystDispatched: qa.length >= 1 || has("qa-engineer"),
    implementerDispatched: has("test-automation-engineer"),
    reviewerDispatched: !!reviewerDisp || ext.reviewerDispatched === true,
    reviewerSessionId: ext.reviewerSessionId ?? (reviewerDisp ? reviewerDisp.toolUseId : null),
    implementerSessionIds:
      ext.implementerSessionIds ?? dispatches.filter((d) => d.subagentType === "test-automation-engineer").map((d) => d.toolUseId),
    orchestratorEdits,
    routingDispatches: ext.routingDispatches ?? [],

    // from artifacts / git / PR / diff lint (not observable in the stream)
    seeded: ext.seeded ?? true,
    pausedForScout: ext.pausedForScout ?? false,
    afsStatus: ext.afsStatus ?? null,
    reviewerVerdict: ext.reviewerVerdict ?? null,
    liveRunGreenStreak: ext.liveRunGreenStreak ?? 0,
    merged: ext.merged ?? false,
    tmsBackwritten: ext.tmsBackwritten ?? false,
    maskingHits: ext.maskingHits ?? 0,
    manualRunBeforeAutomate: ext.manualRunBeforeAutomate ?? false,
    rounds: ext.rounds ?? {},
  };
}
