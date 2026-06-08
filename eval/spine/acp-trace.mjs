// eval/spine/acp-trace.mjs
// ---------------------------------------------------------------------------
// Map ACP `session/update` notifications → the observable signals the
// higher-level scorer needs. ACP gives a normalized, cross-backend stream:
// plan + tool_call/tool_call_update (typed kind/status/locations) + usage.
// We extract universal process signals (no Claude-specific subagent identity):
//   producedTest · ranTests · readBeforeWrite · fileWrites · terminalCmds · usage
// STDLIB ONLY — tested under `node --test`.
//
// ACP shapes (per the spec): a SessionNotification is
//   { method:"session/update", params:{ sessionId, update:{ sessionUpdate:"<kind>", ... } } }
// kinds: plan · tool_call · tool_call_update · agent_message_chunk ·
//        agent_thought_chunk · usage_update · available_commands_update · current_mode_update
// ToolCall.kind (ToolKind enum): read·edit·delete·move·search·execute·think·fetch·switch_mode·other
// ---------------------------------------------------------------------------

const DEFAULT_TEST_PATH = /\.(spec|test)\.[tj]sx?$|(^|\/)(tests?|specs?|e2e)\//;
const DEFAULT_TEST_CMD = /playwright test|npx playwright|jest|vitest|pytest|npm (?:run )?test|go test/i;
const EDIT_KINDS = new Set(["edit", "delete", "move", "create"]);

/** Normalize input (NDJSON text | array of notifications) → array of `update` objects. */
export function parseAcpUpdates(input) {
  const rows = typeof input === "string"
    ? input.split("\n").map((l) => l.trim()).filter(Boolean).map(safeParse).filter(Boolean)
    : Array.isArray(input) ? input : [];
  return rows
    .map((r) => r?.params?.update ?? r?.update ?? r)
    .filter((u) => u && typeof u.sessionUpdate === "string");
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

/** Extract observable signals from the ACP update stream. */
export function acpTrace(input, { testPathRe = DEFAULT_TEST_PATH, testCmdRe = DEFAULT_TEST_CMD } = {}) {
  const updates = parseAcpUpdates(input);
  const toolCalls = [];
  const plan = [];
  let usage = null;

  for (const u of updates) {
    switch (u.sessionUpdate) {
      case "tool_call":
      case "tool_call_update": {
        const locations = (u.locations || []).map((l) => (typeof l === "string" ? l : l?.path)).filter(Boolean);
        const cmd = u.title || textOf(u.content);
        toolCalls.push({ id: u.toolCallId, kind: u.kind || "other", status: u.status || null, title: u.title || null, command: cmd, locations, rawInput: u.rawInput || null });
        break;
      }
      case "plan":
        for (const e of u.entries || []) plan.push({ content: e.content, status: e.status });
        break;
      case "usage_update":
        usage = u.usage || u;
        break;
      default:
        break;
    }
  }

  const fileWrites = toolCalls.filter((t) => EDIT_KINDS.has(t.kind)).flatMap((t) => t.locations);
  const terminalCmds = toolCalls.filter((t) => t.kind === "execute").map((t) => t.command).filter(Boolean);

  const firstRead = toolCalls.findIndex((t) => t.kind === "read");
  const firstEdit = toolCalls.findIndex((t) => EDIT_KINDS.has(t.kind));
  const readBeforeWrite = firstEdit === -1 ? true : firstRead !== -1 && firstRead < firstEdit;

  return {
    toolCalls,
    plan,
    usage,
    fileWrites,
    terminalCmds,
    producedTest: fileWrites.some((p) => testPathRe.test(p)),
    ranTests: terminalCmds.some((c) => testCmdRe.test(c)),
    readBeforeWrite,
    subagents: subagentTree(input), // coarse subagent tree recovered from the flat stream
  };
}

// Raw notification rows (preserve _meta, which can sit on the update or the params).
function rawRows(input) {
  const rows = typeof input === "string"
    ? input.split("\n").map((l) => l.trim()).filter(Boolean).map(safeParse).filter(Boolean)
    : Array.isArray(input) ? input : [];
  return rows.map((r) => {
    const update = r?.params?.update ?? r?.update ?? r;
    const parent =
      update?._meta?.claudeCode?.parentToolUseId ??
      r?.params?._meta?.claudeCode?.parentToolUseId ??
      r?._meta?.claudeCode?.parentToolUseId ?? null;
    return { update, parent };
  }).filter((x) => x.update && typeof x.update.sessionUpdate === "string");
}

/**
 * Reconstruct a coarse subagent tree from a FLAT ACP stream.
 * A subagent dispatch's internal tool calls appear flattened in the same session;
 * we attribute them to the dispatch two ways (in priority order):
 *   1. `_meta.claudeCode.parentToolUseId` — explicit (Claude adapter; survives parallelism)
 *   2. temporal BRACKET — child tool_calls that start after the dispatch's first event
 *      and finish by its `completed` (backend-agnostic; assumes sequential dispatch)
 * Returns [{ dispatch:{id,title,status}, attribution:"meta"|"bracket", children:[...] }].
 */
export function subagentTree(input) {
  const rows = rawRows(input);
  const calls = new Map(); // id → {id,title,kind,status,parent,start,end}
  let i = 0;
  for (const { update: u, parent } of rows) {
    if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
      const id = u.toolCallId;
      if (id) {
        const c = calls.get(id) || { id, title: null, kind: null, status: null, parent: null, start: i, end: i };
        if (u.title) c.title = u.title;
        if (u.kind) c.kind = u.kind;
        if (u.status) c.status = u.status;
        if (parent) c.parent = parent;
        c.end = i;
        calls.set(id, c);
      }
    }
    i++;
  }
  const all = [...calls.values()];
  const parentIds = new Set(all.map((c) => c.parent).filter(Boolean));
  let dispatches = all.filter((c) => parentIds.has(c.id));
  let method = "meta";
  if (dispatches.length === 0) {
    // No _meta (e.g. Copilot) → STRUCTURAL: a tool_call whose [start,end] window
    // strictly contains other tool_calls is a dispatch wrapper. Children often
    // complete LIFO (the last child finishes before its sibling), so a sibling's
    // window can wrap another — take only TOP-LEVEL containers (not themselves
    // contained by another container). Backend-agnostic; validated on both
    // claude-agent-acp (kind "think") and copilot (kind "other").
    const contains = (a, b) => a.id !== b.id && b.start > a.start && b.end < a.end;
    const containers = all.filter((c) => all.some((o) => contains(c, o)));
    dispatches = containers.filter((c) => !containers.some((o) => contains(o, c)));
    method = "bracket";
  }
  const dispatchIds = new Set(dispatches.map((d) => d.id));
  return dispatches.map((d) => {
    const children = method === "meta"
      ? all.filter((c) => c.parent === d.id)
      : all.filter((c) => !dispatchIds.has(c.id) && c.start > d.start && c.end < d.end);
    return {
      dispatch: { id: d.id, title: d.title, status: d.status },
      attribution: method,
      children: children.map((c) => ({ id: c.id, title: c.title, kind: c.kind, status: c.status })),
    };
  });
}

function textOf(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => c?.text || c?.content || "").join(" ");
  return content.text || "";
}
