// eval/spine/skills.mjs
// ---------------------------------------------------------------------------
// Track "did the agent load the proper skills?" — across three senses:
//   INTENDED   — declared in the agent's frontmatter `skills:` (ground truth)
//   RESOLVABLE — each declared skill resolves to installed content (so the host
//                CAN preload it) — deterministic
//   INVOKED    — the agent actually USED a skill at runtime, from the trajectory:
//                  SDK lane: a tool_use named "Skill" (input.skill/command/name)
//                  ACP lane: a tool_call whose title references a known skill id
//
// NOT trackable directly: the silent frontmatter PRELOAD into context (host-
// internal — no event). Cover it with RESOLVABLE (installable) + behavior judge.
// ACP `available_commands_update` is the host command palette, NOT skills.
// STDLIB ONLY — tested under `node --test`.
// ---------------------------------------------------------------------------

/** Parse the frontmatter `skills: [a, b, c]` list from an AGENT.md. */
export function parseIntendedSkills(agentMd = "") {
  const m = String(agentMd).match(/^skills:\s*\[([^\]]*)\]/m);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

/** Skills the agent INVOKED, from trajectory tool calls (SDK + ACP heuristic). */
export function invokedSkills(toolCalls = [], known = []) {
  const out = new Set();
  for (const c of toolCalls) {
    // SDK lane: tool_use name "Skill" + input.skill ; ACP lane: tool_call title "Skill" + rawInput.skill
    if ((c.name || c.title || "").toLowerCase() === "skill") {
      const s = c.input?.skill || c.rawInput?.skill || c.input?.command || c.input?.name;
      if (s) out.add(String(s));
    }
    const title = (c.title || "").toLowerCase();
    for (const k of known) if (k && title.includes(String(k).toLowerCase())) out.add(k);
  }
  return [...out];
}

/** Do the intended skills resolve to installed content? (host can preload them) */
export function resolveSkills(intended = [], isResolvable = () => true) {
  const missing = intended.filter((s) => !isResolvable(s));
  return { intended, resolved: intended.filter((s) => isResolvable(s)), missing, allResolve: missing.length === 0 };
}

/** Combine intended vs invoked into a scorecard. */
export function scoreSkillLoading({ intended = [], invoked = [] } = {}) {
  const inSet = new Set(intended.map((s) => s.toLowerCase()));
  const usedIntended = invoked.filter((s) => inSet.has(s.toLowerCase()));
  const unexpected = invoked.filter((s) => !inSet.has(s.toLowerCase())); // used a skill NOT declared → red flag
  return {
    intendedCount: intended.length,
    invoked,
    usedIntended,
    unexpected,
    note: "Runtime invocation only. Frontmatter PRELOAD into context is host-internal (not directly observable) — verify loadability via resolveSkills + behavior.",
  };
}
