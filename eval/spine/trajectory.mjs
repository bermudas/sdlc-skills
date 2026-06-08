// eval/spine/trajectory.mjs
// ---------------------------------------------------------------------------
// Parse a Claude Code / Agent SDK stream-json (NDJSON) trajectory into a typed
// event log + a reconstructed multi-agent tree.
//
// The subagent tree is rebuilt from `parent_tool_use_id`: a message with no
// parent belongs to the orchestrator ("root"); a message whose parent is the id
// of an `Agent`/`Task` tool_use belongs to the subagent that dispatch spawned.
// (Tool renamed Agent in Claude Code v2.1.63; system:init still says Task — we
// match BOTH names.)
//
// STDLIB ONLY — unit-tested under root `node --test` (trajectory.test.mjs).
// ---------------------------------------------------------------------------

const DISPATCH_TOOLS = new Set(["Agent", "Task", "runSubagent"]);

/** Parse NDJSON text into raw event objects, tolerating blank/partial lines. */
export function parseStreamJson(text) {
  const events = [];
  for (const line of String(text).split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      events.push(JSON.parse(s));
    } catch {
      // ignore non-JSON lines (e.g. interleaved logs)
    }
  }
  return events;
}

function ensureAgent(agents, key, init = {}) {
  if (!agents[key]) {
    agents[key] = { id: key, type: key === "root" ? "orchestrator" : "subagent", subagentType: null, prompt: null, parentToolUseId: null, toolCalls: [], dispatches: [], toolResults: [] };
  }
  Object.assign(agents[key], Object.fromEntries(Object.entries(init).filter(([, v]) => v != null)));
  return agents[key];
}

/**
 * Build a typed event log from raw stream-json events.
 * Returns { result, sessionId, model, agents, dispatches, toolCalls, toolResults }.
 * Each tool call / dispatch / result is attributed to the agent that emitted it.
 */
export function buildEventLog(events) {
  const result = events.find((e) => e?.type === "result") ?? null;
  const init = events.find((e) => e?.type === "system" && e?.subtype === "init") ?? null;

  const agents = {};
  ensureAgent(agents, "root");
  const dispatches = [];
  const toolCalls = [];
  const toolResults = [];

  for (const ev of events) {
    if (ev?.type !== "assistant" && ev?.type !== "user") continue;
    const parent = ev.parent_tool_use_id ?? ev.parentToolUseId ?? null;
    const agentKey = parent ?? "root";
    ensureAgent(agents, agentKey, { parentToolUseId: parent });

    // message.content shape differs Python (message.content) vs TS (message.message.content)
    const msg = ev.message ?? ev;
    const content = msg?.content ?? msg?.message?.content ?? [];
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (ev.type === "assistant" && block?.type === "tool_use") {
        const tc = { agent: agentKey, id: block.id, name: block.name, input: block.input ?? {} };
        toolCalls.push(tc);
        agents[agentKey].toolCalls.push(tc);

        if (DISPATCH_TOOLS.has(block.name)) {
          const childKey = block.id;
          const subagentType = block.input?.subagent_type ?? block.input?.subagentType ?? null;
          ensureAgent(agents, childKey, { parentToolUseId: agentKey, subagentType, prompt: block.input?.prompt ?? null });
          agents[childKey].type = "subagent";
          const d = { byAgent: agentKey, toolUseId: childKey, subagentType, input: block.input ?? {} };
          dispatches.push(d);
          agents[agentKey].dispatches.push(d);
        }
      } else if (ev.type === "user" && block?.type === "tool_result") {
        const tr = { agent: agentKey, toolUseId: block.tool_use_id, isError: !!block.is_error, content: block.content };
        toolResults.push(tr);
        agents[agentKey].toolResults.push(tr);
      }
    }
  }

  return {
    result,
    sessionId: result?.session_id ?? null,
    model: init?.model ?? null,
    agents,
    dispatches,
    toolCalls,
    toolResults,
  };
}

/** Convenience: NDJSON text → event log. */
export function eventLogFromText(text) {
  return buildEventLog(parseStreamJson(text));
}

/** List subagent nodes (everything but root). */
export function subagents(eventLog) {
  return Object.values(eventLog.agents).filter((a) => a.type === "subagent");
}
