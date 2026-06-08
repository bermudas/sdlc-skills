# Decision Memo: ACP vs Claude Agent SDK vs Hybrid for the eval harness

**Date:** 2026-06-05 · **Scope:** `eval/` harness driver strategy · **Status:** decision, supersedes the one-line "Do NOT use ACP" in `eval/design/e2e-orchestrated-eval.md` §6 with a more precise, two-tier recommendation.

> ## ⟳ Revision (2026-06-08): ACP-UNIVERSAL
> **Decision overridden in favor of universality.** The harness drives **every** backend through **one ACP client** (`run-e2e-acp.mjs`) so the same suite scores Claude / Copilot CLI / Gemini / Codex identically. The SDK lane (`run-e2e.mjs`) is now **optional** — a Claude-only bonus for native `parent_tool_use_id` depth, not the default.
>
> ### Native agent selection over ACP (confirmed — supersedes the `systemPrompt` workaround)
> A later finding strengthens the ACP-universal pivot: **you can select the installed agent natively over ACP** — no `systemPrompt` reconstruction, no hand-mapping of model/skills/tools. There is no ACP-*standard* "agent" field (`session/new` carries only `cwd` + `mcpServers`), so selection is **per-runner**:
> - **Claude** (`claude-agent-acp`): pass `_meta.claudeCode.options = { agent:"<name>", settingSources:["user","project","local"] }` on `session/new`. The adapter forwards `_meta.claudeCode.options` straight to the Agent SDK's `Options.agent`, documented as "equivalent to the `--agent` CLI flag" → the installed agent's **full** definition (model, skills, tools, persona) loads from `.claude/agents`. Proven: the agent's frontmatter `model: sonnet` applied with no override (the earlier "Haiku" anomaly was just frontmatter being dropped when we *didn't* use the agent field).
> - **Copilot** (`copilot --acp`): `--agent <name>` spawn flag. **Codex**: `session/setMode`. **Gemini**: config files.
>
> Implication: the earlier `_meta.systemPrompt` / `appendSystemPrompt` approach in this harness was a **workaround for a gap that doesn't exist** — and worse, `appendSystemPrompt` against the `claude_code` preset *diluted* the orchestrator (it shortcut instead of dispatching). It has been removed; `driver/run-pipeline.mjs` uses `options.agent`. See `HANDOFF.md` §2–§3.
>
> Two corrections to the analysis below, in ACP's favor — because **the harness *is* the ACP client** (it owns the cwd and implements `fs/*`, `terminal/*`, `requestPermission`):
> - "Can't mock tool RESULTS" was too flat — the harness fully controls **fs/terminal/permission** at the protocol boundary (so the **blocker** probe = `requestPermission` reject, and fs/terminal are stubbable). Only the agent's *internal* (non-fs/terminal) tools can't be mocked.
> - "Masked-test needs input-rewrite" — not over ACP, but the harness owns the working dir, so **masking DETECTION = read the produced test from disk + `lint`** (backend-agnostic), and masking **INJECTION** (does the reviewer catch a planted mask?) = a **pre-seeded `v-perturb-mask`** fixture. No live rewrite needed.
> - Subagent attribution is recovered by **`_meta` (Claude) or temporal bracket (any backend)** — both verified live on Claude *and* Copilot.
>
> Net loss accepted for universality: live mid-call input-rewrite + the agent's internal-tool result-mock — both replaced by fixtures. Everything else (routing, skills, subagent recovery, outcome dual-run, masking detection, blocker, seeding, cost) works over ACP. The two-tier framing below stands as the *rationale*; the chosen default is now the ACP lane.

## TL;DR

**Keep the Claude Agent SDK driver as the deep-scoring engine. Add ACP later as a second, capability-degraded driver — not a replacement.** The spine is already driver-agnostic, so this is additive. Nothing about ACP in mid-2026 changes the conclusion that Claude-team deep scoring must run on the SDK; what *has* changed is *why* — ACP doesn't *erase* attribution, it puts it behind an unstable vendor side-channel that, to consume, makes you run the SDK anyway plus an extra hop.

---

## 1. The honest case for ACP

ACP genuinely buys one thing a future cross-backend benchmark wants most: **one client implementation that drives many heterogeneous agents through an identical wire format**, yielding comparable, machine-readable traces per backend.

- **It is a real, stable, multi-vendor standard.** JSON-RPC 2.0 over stdio, agent runs as a subprocess; `protocolVersion` negotiated in `initialize` (current stable wire version = **1**). Apache-2.0. Confirmed against the canonical spec and corroborated by adversarial verdicts.
- **Multi-backend reach is the headline.** Agents that speak ACP today (native or via adapter): **Gemini CLI** (Google's reference agent), **Claude** (via `@agentclientprotocol/claude-agent-acp`, v0.42.0, 2026-06-05), **OpenAI Codex CLI**, **GitHub Copilot CLI** (public preview), **Cursor**, **Qwen Code**, **Kimi CLI**, **Mistral Vibe**, **Goose**, **OpenCode**, **OpenHands**, JetBrains Junie, and more. An ACP **Registry** (launched 2026-01-28) gives programmatic discovery/launch. Client side is equally real (Zed reference, JetBrains native, Neovim, Emacs, VS Code) — so the contract is reusable, not niche.
- **Process conformance is observable out of the box.** `session/update` is a tagged union streaming the agent's `plan`, every `tool_call`/`tool_call_update` with typed `kind` (read/edit/delete/move/search/execute/think/fetch/switch_mode/other), `status` (pending/in_progress/completed/failed), affected `locations`, reasoning chunks, available commands, and `usage_update`. That's directly scorable for ordering, tool selection, and efficiency across any backend.
- **The harness is the choke point.** As the ACP *client* you implement `fs/read_text_file`, `fs/write_text_file`, `terminal/*`, and answer `session/request_permission` — you can sandbox, log, and gate every side effect at the protocol boundary.
- **Standardized turn boundaries.** `session/cancel` + `StopReason` (`end_turn`/`max_tokens`/`max_turn_requests`/`refusal`/`cancelled`) give uniform failure-mode signals across agents.

This is the entire strategic argument *for* ACP and it is legitimate — **but only for the cross-backend comparison lane, which is out of scope for iteration 1 (test-automation Claude team first).**

---

## 2. The blockers — current status (mid-2026), verified

The harness needs three things the SDK driver already does. Here is whether a *pure ACP client* can do each, as of 2026, with the flattening status corrected.

### (a) Rewrite a tool input (to plant a masked test) — ❌ **blocked, no path**
ACP's `RequestPermissionResponse` has exactly two outcome variants: `{cancelled}` or `{selected, optionId}`, plus opaque `_meta`. There is **no field to return modified tool input**. `rawInput` is visible to the client but **read-only**. Verified against the canonical schema. The SDK's `PermissionResult` with `behavior:'allow'` + `updatedInput` is the *only* way to rewrite a tool call — and it's exactly what `driver/run-e2e.mjs` line 52 already uses to append `test.fail()` for the masked-test probe. **This is the single highest-signal probe** (it trips both load-bearing hard gates at once) and ACP cannot express it. **Not resolved; not on any roadmap — it's a deliberate protocol shape, not a bug.**

### (b) Mock tool RESULTS — ❌ **blocked, no path**
There is no client-side ACP mechanism to return canned content or `isError:true` for a domain tool. The SDK's in-process MCP (`createSdkMcpServer`/`tool()` returning `{isError:true}` so the loop continues for recovery scoring) is the only way. ACP's client surface can't do it. **Not resolved.**

### (c) See the sub-agent tree / per-agent attribution — ⚠️ **recoverable, but only via an unstable vendor side-channel** (this is the corrected finding)

The prior design doc said ACP "loses `parent_tool_use_id` attribution (confirmed, issue #305)." **That citation is wrong and the framing is too strong.** The verdicts establish:

- **The ACP *wire spec* has no session hierarchy and a flat `ToolCall` schema** — `session/new` takes no parent; no `session/update` variant carries agent identity; `ToolCall` has no nesting field. A subagent's tool call looks identical to the orchestrator's on the wire. That part is true and structural.
- **But the `claude-agent-acp` adapter (v0.42.0) preserves attribution** by stamping `_meta.claudeCode.parentToolUseId` onto subagent-origin `tool_call`/`agent_message_chunk`/`tool_call_update` notifications, and exposes `emitRawSDKMessages` at `session/new` which emits the full raw SDK NDJSON stream as `_claude/sdkMessage` ext-notifications — carrying native `parent_tool_use_id`, `subagent_type`, and `result.total_cost_usd`. Both are spec-legal vendor extensions (`_meta` and `_`-prefixed notifications are first-class in the Extensibility spec).
- **Issue #305 is unrelated and closed** — it was "Task subagent cannot execute tools (Write/Edit silently fail)," opened 2026-02-11, closed 2026-02-18 via PR #316. The *correct* open issue is **#56 "Visual distinction for subagent activities" (open since 2025-09-16, maintainer-confirmed roadmap, not shipped mid-2026)** — generic ACP clients (Zed) still don't consume the attribution `_meta`.

**Net:** attribution is *recoverable* over ACP, **not erased**. But to recover it you must (i) write a custom client that opts into `emitRawSDKMessages` and parses raw SDK messages, and (ii) trust an unstable vendor field whose path can change between adapter versions. At that point **you are running the SDK over an extra process+protocol hop to get back exactly what `claude -p --output-format stream-json` gives you directly.**

**Flattening issue status, in one line:** *Flat at the wire/typed level (by design); attribution available only via `_meta.claudeCode.parentToolUseId` / `emitRawSDKMessages`; generic clients still don't surface it — open issue #56.*

**Two more blockers worth recording (independent of the above):**
- **Cost** over ACP is *in-spec* (`PromptResponse.usage` + `usage_update` RFD) — so "ACP can't do cost" is too flat — but **unreliably populated** (documented gaps in Cursor, codex-acp #165, gemini-cli #24280, goose #8132). The SDK gives `result.total_cost_usd` directly, which `spine/usage.mjs` already consumes.
- **The subagent-over-ACP path is young and fragile**: context-inheritance (#623, fixed), permission surfacing from Skill/Task subagents (#329, fixed), dropped task notifications (#336, open), long-turn `PromptResponse` hangs (#688). Extra confound surface for conformance scoring.

**Did any blocker resolve in 2026 such that the recommendation changes? No.** (a) and (b) are unchanged protocol shapes. (c) was reframed (recoverable, not erased) but the practical conclusion is *stronger*, not weaker: recovering it means running the SDK anyway.

---

## 3. Recommendation: **(c) two-tier hybrid — but staged, SDK-only this iteration**

Pick **hybrid in architecture, SDK-only in delivery for iteration 1.** Concretely:

- **Deep-scoring lane (now, Claude-only): SDK in-process driver.** This is the only lane that can rewrite tool inputs (masked-test), mock tool results (`isError` recovery), and read native `parent_tool_use_id`/`agentID`. Layer C (per-agent attribution, role-violation, handoff completeness) depends entirely on these. It already exists and is tested.
- **Portability lane (later, multi-backend): an ACP driver** that feeds the *same spine* at **lower fidelity** — outcome + dispatch + checkpoint partial-credit + deny/approve probes + best-effort usage. This is where ACP's real value (Gemini/Codex/Copilot/Cursor/Qwen apples-to-apples) lands.

**Why not pure ACP:** it fails the two highest-signal probes (rewrite-input, result-mock) with no path, and the third (attribution) only works by smuggling the SDK stream through ACP. Strictly worse for a Claude-only benchmark.

**Why not a single fused "hybrid driver" (ACP outer + Claude side-channel):** that gets the worst of both. To do input-rewrite and result-mocking you still need the SDK's `canUseTool`/in-process MCP, which live on the *SDK side of the adapter* and are **not reachable from an ACP client**. So the "side-channel" isn't a thin add-on — it's the entire injection engine. You'd run the SDK anyway *and* maintain an ACP shell on top: two protocols, double the failure surface (adapter bugs #688/#679/#336), zero capability gained. **Keep them as two parallel drivers behind one spine, never one fused driver.**

This serves both mandates: deep Claude-team scoring now, and a clean seam to add cross-backend comparison later without forking the spine.

---

## 4. Concrete shape if (when) the ACP lane is added

The spine takes a normalized event log + trace, so this is **a new driver, not a new brain.**

**New file: `eval/driver/run-e2e-acp.mjs`** — an ACP *client* (`ClientSideConnection` from `@agentclientprotocol/sdk`) that:
1. Spawns a registry agent as a subprocess; `initialize` → `session/new` (`cwd` + `mcpServers`) → `session/prompt`.
2. Implements `fs/*`, `terminal/*`, and answers `session/request_permission` (allow/deny probes via `optionId`).
3. Subscribes to `session/update`, mapping each variant to the **same event-log schema** `spine/trajectory.mjs` already consumes (the AG-UI-shaped `TOOL_CALL_*`/`STEP_*` vocabulary). `tool_call.kind`/`status`/`locations` → tool nodes; `plan` → plan-conformance; `usage_update` → `usage.mjs` (best-effort).
4. **For the Claude backend specifically:** sets `emitRawSDKMessages` and reads `_claude/sdkMessage` to recover `parent_tool_use_id` — i.e. it degenerates into the SDK path with overhead, which is precisely why the Claude *deep* lane should bypass ACP entirely.

**What is LOST on a pure-ACP path (non-Claude backends):**
- **Masked-test rewrite probe** → cannot be planted via permission response. **Fallback:** plant the perturbation in the *fixture/environment* before the run (commit a pre-masked variant, e.g. `v-perturb-mask`) and score whether the agent *detects/removes* it — a detection probe rather than an injection probe. Lower fidelity (you can't time it to a specific tool call), but it preserves the signal "does the agent ship a masked assertion."
- **Tool-RESULT mocking** → no client mechanism. **Fallback:** pre-seed deterministic fixtures (a stub server / canned files) so the "result" is fixed by the environment, not injected mid-call. Can't do `isError`-on-demand recovery scoring.
- **Native subagent attribution** → only `_meta` (vendor) or `emitRawSDKMessages`; for non-Claude backends, attribution is whatever that backend chooses to expose (often nothing). Layer C degrades to **outer-only conformance** (orchestrator-level ordering/plan/outcome), no per-role credit.
- **Reliable cost** → best-effort `usage_update`; treat as advisory, not a gate.

**What STILL works on pure ACP:** dispatch detection, full trajectory/ordering (plan + typed tool kinds + locations), **deny/approve probes** (recoverable-blocker via `reject_once`/`allow_once`), checkpoint partial-credit, outcome scoring. That's a legitimate, if coarser, conformance lane.

### Capability table

| Capability | `claude -p` stream-json | **Agent SDK (deep lane)** | **ACP client (portability lane)** | **Hybrid (two drivers, one spine)** |
|---|---|---|---|---|
| Dispatch detection (who-spawns-who) | ✅ NDJSON | ✅ native | ✅ via `tool_call` | ✅ both lanes |
| Trajectory / ordering (plan, tool kind+status+locations) | ✅ | ✅ | ✅ `session/update` | ✅ both lanes |
| Subagent attribution (`parent_tool_use_id`) | ✅ NDJSON | ✅ native | ⚠️ only `_meta.claudeCode.parentToolUseId` / `emitRawSDKMessages` (Claude-adapter only; #56 unconsumed by generic clients) | ✅ SDK lane / ⚠️ ACP lane |
| Deny-with-guidance (recoverable blocker) | ⚠️ PreToolUse (no rewrite) | ✅ `canUseTool` deny+message | ⚠️ `optionId` reject (no message channel) | ✅ SDK / ⚠️ ACP |
| **Rewrite tool input (plant masked test)** | ❌ | ✅ `updatedInput` | ❌ **no field in `RequestPermissionResponse`** | ✅ SDK lane only · ACP fallback = pre-seeded fixture (detection probe) |
| **Mock tool RESULTS (`isError` recovery)** | ❌ | ✅ in-process MCP | ❌ no client mechanism | ✅ SDK lane only · ACP fallback = pre-seeded stub fixture |
| Cost / session for `usage.mjs` | ✅ `result.total_cost_usd` | ✅ | ⚠️ in-spec (`usage_update` RFD) but unreliably populated | ✅ SDK / ⚠️ ACP |
| Multi-backend (Gemini/Codex/Copilot/Cursor/Qwen…) | ❌ Claude-only | ❌ Claude-only | ✅ 30+ agents, one client | ✅ via ACP lane |

**Also flag this SDK-side risk regardless of ACP (issue #27203):** `canUseTool` does **not** fire for **background** subagent tool calls in default mode (the SDK denies them internally and can corrupt the parent transport). The masked-test rewrite must target a **foreground-dispatched** implementer — verify empirically, and never set `background:true` on a role whose tool calls you intend to intercept. Add this to the §8 first-step checklist alongside "does `canUseTool` fire for the `Agent`/`Task` dispatch tool itself."

---

## 5. Verdict in one line + this iteration vs defer

**Verdict:** Keep the Claude Agent SDK as the deep-scoring driver; treat ACP as a future *second* driver behind the same spine for coarse cross-backend conformance — never as a replacement, never fused into one driver.

**Do THIS iteration:**
- Ship the SDK deep lane (already built/tested) for the test-automation Claude team.
- **Fix the design doc**: `eval/design/e2e-orchestrated-eval.md` §6 line 140 — replace "loses `parent_tool_use_id` attribution (confirmed, issue #305)" with: *flat `ToolCall` schema (verified) + attribution available only via `_meta.claudeCode.parentToolUseId`/`emitRawSDKMessages` vendor extensions; generic clients don't consume it — open issue #56.* Soften the capability table's ACP "cost: partial" to "in-spec via `usage_update` RFD, unreliably populated." Keep the two ❌ cells (rewrite-input, mock-results) — confirmed against canonical schema.
- Add the **#27203 background-subagent caveat** to the `canUseTool` row and the first-step checklist.

**Defer (until a multi-backend mandate is real):**
- `eval/driver/run-e2e-acp.mjs` (ACP client → same event-log/trace contract), the pre-seeded-fixture fallbacks for the masked-test and result-mock probes, and registry-based agent launch config. Build it as a *capability-degraded lane*, scored by the existing `trajectory.mjs`/`conformance.mjs` math at lower fidelity — no spine changes required.

Relevant files: `eval/design/e2e-orchestrated-eval.md` (§6, lines 138–156 — needs the correction), `eval/driver/run-e2e.mjs` (existing SDK deep lane, `canUseTool` rewrite at line 52), `eval/spine/trajectory.mjs` (the driver-agnostic contract a future ACP driver must satisfy).
