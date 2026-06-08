// eval/spine/routing.mjs
// ---------------------------------------------------------------------------
// Routing-correctness check — did the orchestrator DISPATCH (not self-answer)
// and route to the EXPECTED slot? Two fidelity levels:
//   SDK deep lane  → routedSlot is the native `subagent_type` (exact).
//   ACP lane       → routedSlot is INFERRED from dispatch/child titles + the
//                    agent's final text (heuristic; ACP carries no clean slot id).
// `scoreRouting` is pure over already-extracted facts; `inferRoutedSlot` is the
// ACP heuristic. STDLIB ONLY — tested under `node --test`.
// ---------------------------------------------------------------------------

/** ACP heuristic: which known slot does the trace evidence mention? */
export function inferRoutedSlot({ acp = {}, agentText = "", candidates = [] }) {
  const subs = acp.subagents || [];
  const hay = [
    ...subs.map((d) => d.dispatch?.title || ""),
    ...subs.flatMap((d) => (d.children || []).map((c) => c.title || "")),
    ...(acp.toolCalls || []).map((c) => c.title || ""),
    agentText,
  ].join(" \n ").toLowerCase();
  return candidates.find((c) => hay.includes(String(c).toLowerCase())) || null;
}

/**
 * @param {{dispatched:boolean, routedSlot:string|null, expectedSlot:string}} f
 */
export function scoreRouting({ dispatched, routedSlot, expectedSlot } = {}) {
  const routedToExpected = !!routedSlot && String(routedSlot).toLowerCase() === String(expectedSlot).toLowerCase();
  return {
    dispatched: !!dispatched,
    selfAnswered: !dispatched,            // instruction-following: an orchestrator must NOT do IC work itself
    routedSlot: routedSlot || null,
    expectedSlot,
    routedToExpected,
    pass: !!dispatched && routedToExpected,
  };
}
