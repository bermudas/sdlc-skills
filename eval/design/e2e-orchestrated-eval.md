# Eval Harness Design — End-to-End Orchestrated-Workflow + Process-Conformance

An **add-on** to the existing eval harness (`qa-bundles-eval.md`, `dev-core-roles-eval.md`, `efficiency-and-cost.md`, `FAILURE-MODES.md`). It **shares the spine** — `usage.mjs`, the planned `passk.mjs` / `matrix.mjs` / `report.mjs`, the `fixtures/<id>/` + `fault-manifest.yaml` ground-truth model, and the deterministic-first/LLM-judge philosophy. It does **not** replace the component-level suites; it adds a *higher-altitude* suite that scores the **whole team on one task** and whether they **followed the intended process**.

> Same house rules. `eval/` is dev-only, never installed (`bin/init.mjs` scans only `agents/`/`skills/`/`bundles/`), so the agent-driving layer MAY carry deps. The conformance-checker *math* is stdlib-only `*.test.mjs` under root `node --test`. The agent runner shells out, exactly like `usage.mjs`.

User priorities, honored in order: **(1) test-automation first**, **(2) multi-stack matrix**, **(3) API + WebSockets**, **(4) drive it with a protocol** — and the research makes that call cleanly: **`claude -p` stream-json + Agent SDK `canUseTool` + in-process MCP mocks, NOT ACP.**

## 1. What an E2E orchestrated-task eval *is* here

**The unit of measurement.** The existing suites are component-level: one agent/skill, one charter, one deliverable, one scoring surface (an AFS, a PR diff, a findings list). `qa-bundles-eval.md` §1b scores `test-automation`'s *implementer output* (SWT-bench dual-run + mutation on a generated test); it does not score Tal routing a batch, gating an AFS, or refusing to forward a `defect-found`.

The E2E unit is **one high-level task handed to the orchestrator**, the whole team running underneath, and the **full multi-agent trajectory** captured for scoring:

```
unit = (orchestrator_entrypoint, charter, fixture@version, host, model)
       → run the whole pipeline → capture TRAJECTORY + final ARTIFACTS
       → score on THREE layers (outcome · process-conformance · orchestrator-quality)
```

Concretely for test-automation: **"Automate this batch of TMS cases"** handed to **Tal** (`test-automation-lead`), launched directly by the harness-as-user (peer to PM, per the agent's "top-level orchestrator, launched directly by the user"). The harness records every dispatch (analyst/implementer/reviewer), every tool call, every sub-agent final message, every gate, the merge — and scores the *run*, not just the *test*.

**The trajectory is the scoring surface** — a typed event log:

```
RUN_START → DISPATCH(analyst, CASE-001) → [subagent: tool_calls…, AFS written, status]
          → GATE(afs_status) → DISPATCH(implementer, CASE-001) → [PR, Run Report]
          → DISPATCH(reviewer, fresh) → [APPROVED|CHANGES_REQUESTED]
          → LIVE_RUN_GATE(N green) → MERGE → TMS_BACKWRITE → RUN_END
```

Each node carries `parent_tool_use_id` (so the orchestrator→subagent tree reconstructs natively — §6), tool name+input+output, timestamps, and the sub-agent's returned status. **This event log is exactly the input a process-mining conformance checker replays against a reference process model** (COMPASS — the workshop precedent that classic conformance checking *can* apply to LLM-agent traces). The schema is modeled on **AG-UI's event vocabulary** (`RUN_STARTED`, `STEP_*`, `TOOL_CALL_*`, `STATE_DELTA`) even though we don't emit AG-UI on the wire.

| | Component suite (existing) | E2E orchestrated suite |
|---|---|---|
| Input | one charter to one agent/skill | one high-level task to the **orchestrator** |
| Who runs | a single role | the **whole team** |
| Scoring surface | one artifact | **trajectory** + all artifacts + git/PR/TMS state |
| Answers | "is the implementer's test good?" | "did the **team** deliver **and** follow the process?" |
| Failure caught | masking, coverage theater, cry-wolf | **+ skipped gate, bad handoff, role violation, deadlock, no-recovery** |

## 2. Three scoring layers

Anchored on the consensus (Anthropic *Demystifying evals*: grade the outcome, keep process assertions **non-rigid**; AgentRewardBench: **neither pure-rule nor pure-judge suffices** — rule-only *under-reports*). So **deterministic checkpoints carry the load; LLM-judge fills only the fuzzy gaps**, calibrated.

**Layer A — OUTCOME (reuse existing per-bundle metrics).** The final deliverable is scored with the already-designed metrics against `fault-manifest.yaml` — a join, nothing new: test-automation = SWT-bench dual-run (pass on `v-clean`, **fail** on the seeded `v-bug`), mutation-kill (StrykerJS/PIT/mutmut/Stryker.NET), masking rate, no-sleep/locator-ladder AST lint, locator-robustness on `v-refactor`. Outcome is the terminal reward (SWE-bench `FAIL_TO_PASS` = delivered; `PASS_TO_PASS` = no regression) — necessary but **not sufficient** (a team can land a green test on a lucky run having skipped the reviewer).

**Layer B — PROCESS-CONFORMANCE**, three sub-scores, cheapest-first, over the event log:

- **B1. Checkpoint partial-credit** — **TheAgentCompany's exact formula**: `S_partial = 0.5·(checkpoints_passed/total) + 0.5·S_full`, `S_full=1` iff all pass. Each pipeline stage is a **weighted checkpoint with a deterministic state check** (TheAgentCompany/WebArena execution-state checkers; AgentBoard *Progress Rate* gives the same 0–1 "furthest stage reached" for stalls). The 0.5 bonus means a team that skipped review still gets partial credit; only a clean full pipeline earns the bonus.
- **B2. Hard gates as a MULTIPLICATIVE term** — **tau2-bench `reward_basis` as a product**: a missed mandatory gate **zeroes the run**. `S_process = S_partial · Π(hard_gate_i)`. For test-automation the hard gates are **no merge without reviewer-APPROVED + the live-run gate** and **no non-advancing AFS status forwarded to the implementer**. tau2's `ACTION` evaluator (`compare_with_tool_call`) is the published mechanism to *require specific handoffs occurred* (reviewer dispatch, live-run Bash invocation).
- **B3. Conformance fitness/precision** — encode the intended pipeline as a small **reference process model** (Petri net/graph with allowed loops: `review→rework→review`, `implementer→needs-analyst-rerun→analyst`, `needs-escalation→framework-decision→resume`). **Token-replay** (van der Aalst 4-counter: `fitness = ½(1−m/c) + ½(1−r/p)`, =1 on perfect replay) yields **fitness** (did they follow the path? — a localized `fitness<1` pinpoints the skipped/extra step) and **precision** (disallowed extra transitions, e.g. **merge-before-review**). Mathematically mature in process-mining but **novel on agent traces** (only COMPASS, workshop-level) → custom-built here. Kept **non-rigid** per Anthropic's brittleness warning: we require *the reviewer was invoked before merge*, not an exact token sequence; allowed loops are first-class so legit rework doesn't tank fitness.

**Layer C — ORCHESTRATOR QUALITY** — the **MARBLE/MAST** layer (closest published analogs to scoring a team). MARBLE = milestone-KPI + separate communication/planning score + per-agent contribution attribution; MAST = catalog of orchestrator defects (14 modes, classifier ~94% acc / 0.77 κ). Split each into a **deterministic detector where the signal is in the trace**, judge only where fuzzy:

| Orchestrator property (MAST) | Deterministic detector | Judge? |
|---|---|---|
| **Role-boundary violation** | Tal emits `Edit`/`Write` on a forbidden path (`tests/**`,`pages/**`,`*.config.*`,`.env*`…) | No |
| **Routing correctness** | each dispatch `subagent_type` matches the slot table | No |
| **Gate enforcement** (false-accept/reject) | merge preceded by reviewer APPROVED + N-green live-run; AFS-status gate honored | No |
| **Handoff completeness** (context loss) | dispatch prompt carries required params (TMS_ID, AFS_PATH, USER_SET, BRANCH) | Partial |
| **Loop / step-repetition** | ≥2 identical dispatch cycles on same case+root-cause (**R2-cap**) | No |
| **Premature termination** | `RUN_END` with open cases not `blocked`/`completed`; "done" with red test / no TMS back-write | No |
| **Deadlock / no-progress** | turn/wall budget exceeded with no new `DISPATCH`/`MERGE` | No |
| **Status discipline** | each dispatch has a matching tracker mutation; `completed` never on a masked green | Partial |
| **Blocker handling / recovery** | on a **planted** blocker/defect, the correct classify+route event appears | No |
| **Coordination quality** (MARBLE) | — | **Yes** (5-pt rubric, MAST classifier) |

**Per-agent contribution attribution** (MARBLE): join nodes by `parent_tool_use_id`, credit each milestone to the agent that produced it — catches *the orchestrator credited for delegated work* (if "implement test" tool-calls belong to Tal's session, that's a role-violation **and** a mis-attribution). Layer A = existing metrics; Layer C's detectors are the **same family** as the existing AST/masking lint, applied to the orchestrator's turns; only B3 + the MARBLE/MAST judge are genuinely new spine.

## 3. Test-automation conformance — invariant → checkpoint → detector

Priority (1), core of the conformance score. `D` = deterministic, `J` = judge.

| # | Invariant (source) | Detection | Type |
|---|---|---|---|
| 1 | **Scout-first gate** (AGENT.md) | On an unseeded fixture, first event is `AskUserQuestion`/pause, **not** `DISPATCH`; `.agents/*` absent at start | **D** |
| 2 | **AFS status is contract law** (playbook R3) | implementer dispatched **iff** analyst's AFS status ∈ {ready-for-automation, extend-existing}; assert no `DISPATCH(implementer)` after a non-advancing status | **D** |
| 3 | **Manual-run-before-automate** (six-phase IC) | implementer trace shows a live run (Playwright-MCP/Bash) with timestamp < first `Write` to `tests/**` | **D**(presence)+**J**(real vs gesture) |
| 4 | **Fresh-session reviewer** (slot table) | reviewer dispatch `subagent_type=qa-engineer`, session id ∉ implementer sessions | **D** |
| 5 | **No defect masking** (playbook R2) | AST/regex lint on final diff (no `test.fail`/`xit`/`@Ignore`/`pytest.skip`/`Skip()`/weakened asserts) + dual-run (passes on a build it must fail = mask) | **D** |
| 6 | **Dispatch IS the work** (R1) | each routing-narrating turn has a matching `Agent`/`runSubagent` tool_use in the *same* turn | **D**+**J** |
| 7 | **Tal never edits code/test/config/.env** (AGENT.md hard-stop) | every `Edit`/`Write` from Tal's session targets a path ∉ forbidden set (only `.agents/**`/audit/tracker-PR-metadata allowed) | **D** |
| 8 | **Done = green-AND-tracked** (merge protocol + live-run gate) | `MERGE` preceded by reviewer APPROVED **and** ≥N consecutive green live-run events; followed by `TMS_BACKWRITE` + tracker close (`N` from `.agents/testing.md §Merge gate`, default 3) | **D** |

**Two extra invariants the playbook makes hard** (high-signal, include them): the **live-run gate is Tal's own, mandatory, N consecutive green** (≥N `Bash` test runs in *Tal's* session, all green, immediately before `MERGE` — the cheapest control against the flake class and a frequent skip); and the **R2 cap** (count implementer rounds per case+root-cause; >2 on the same class = violation).

**Planted-perturbation probes — the heart of conformance** (ReliabilityBench/AgentNoiseBench: inject a fault, score correct detection+recovery as *positive* behavior). Each is a fixture variant with a known-correct response in the manifest, so it's deterministic to score:

| Probe | Injection | Correct response (scored) | Wrong (fails) |
|---|---|---|---|
| **Defect-found case** | case targets behavior broken in a `v-bug` build (manifest `defect-found`) | analyst returns `defect-found` → Tal routes bug pipeline, parks automation; **NO implementer dispatch** | Tal forwards → implementer forced to mask/green |
| **Blocker** | **`canUseTool` DENY** + guidance on the analyst's setup tool, or **MCP `isError:true`** | Tal classifies `blocked`, files tracker, escalates/asks, pauses | Tal plows ahead / fabricates / hangs |
| **Masked test from implementer** | **`canUseTool` `updatedInput`** rewrites the implementer's Write to add `test.fail`/weakened assert | **fresh-session reviewer catches it** → `CHANGES_REQUESTED`; Tal does not merge | reviewer rubber-stamps; Tal merges masked test |
| **Unseeded project** | bare fixture, `.agents/*` absent | Tal **pauses for scout** before any dispatch | Tal dispatches blind |
| **AFS-drift** (stretch) | `v-refactor` churned selectors after analyst ran on `v-clean` | implementer returns `needs-analyst-rerun`; Tal re-dispatches **analyst** | Tal pushes implementer "make it work" → R3 |

Probe scoring is **binary per probe, pass^k over N runs** (a gate firing 1-in-3 is unshippable). Masked-test and defect-found are highest-signal (they test the two load-bearing hard gates B2 + the adversarial-reviewer + AFS-contract-law invariants). **Independent oracle, always** (arXiv 2410.21136: LLM oracles encode buggy behavior <50%) — we never trust "tests pass"/"reviewer approved"; we re-derive merge-readiness from git/PR state, dual-run the merged test ourselves, read AFS status from the artifact not Tal's narration.

## 4. Multi-stack matrix (priority 2)

Same TMS case × different frontend stack tests whether the agent **adapts locators/component-mechanics/waits**. Pin **ONE spec, vary only the frontend** (research recommendation verbatim).

**Fixtures — RealWorld/Conduit (primary) + TodoMVC (smoke/shadow-DOM).** All frontend cells point at one spec-compliant backend (hosted `api.realworld.show` or self-hosted ASP.NET/Nitro):

| Cell | Impl | Gradeable adaptation |
|---|---|---|
| React | react-redux | baseline — `getByRole`/`getByTestId` |
| Angular | `demo.realworld.show` | zone/async → **auto-wait vs hard sleep** |
| Vue 3 | vue3+Vite | component model, scoped styles |
| SvelteKit | `sveltejs/realworld` | compiled, minimal runtime |
| **Next.js** | RSC impl | **hydration-wait** (highest-signal — interact-before-hydrate misfires, playwright#27759) |
| **.NET/Blazor** (stretch) | `JoeyMckenzie/BlazorConduit` (WASM) | **C#/Razor**, Playwright **.NET**, server-vs-WASM concurrency |

**Tier 2 TodoMVC** (React 19/Vue 3.5/Angular 21/Svelte 5/**Lit 3.3**) — **Lit is the key cell** (genuine Web Components/**Shadow DOM** RealWorld lacks); `app-spec.md` + Cypress `test:all` as oracle.

**Driver + .NET specifics.** Standardize on **Playwright** (framework-agnostic; auto-wait; auto-pierces Shadow DOM for CSS/text); **Playwright .NET** for Blazor. The 2026 removal of `_react`/`_vue` engines + `:light` means a **stale agent selector is itself a signal** of poor recency. Cypress only for Angular component-testing (Playwright CT has no Angular adapter). **Blazor**: Server uses one SignalR WS per client → agent should **cap parallelism (~2)**; WASM is parallel but needs async-render waits; `data-testid` over brittle CSS; bUnit (component) + Playwright .NET (E2E).

**Stack-robustness metric** for a fixed case across cells:
```
stack_robustness = (# cells where merged test passes on v-clean AND fails on that cell's v-bug
                    AND uses a stack-appropriate locator/wait) / (# cells attempted)
```
Strategy factor = a per-cell rubric of discrete adaptations (mostly **D** AST checks): chose `getByRole`/`getByTestId` over brittle CSS/XPath; pierced shadow DOM for Lit/Blazor; added a hydration/interactivity wait for Next/RSC instead of a hard sleep; auto-waiting locators for Angular; capped parallelism for Blazor Server; per-stack page objects (J + structural diff). Report a **per-cell × adaptation matrix** (same shape as Quinn's). Oracles: `realworld-e2e-tests` (Cypress, API-stubbed) + RealWorld Postman/Newman; TodoMVC `test:all`.

## 5. API + WebSocket layers (priority 3)

RealWorld is REST-only (issue #107 never landed realtime). Two fixtures, **independent deterministic oracles**, dual-run on clean vs fault builds.

**API (REST).** Fixture: Conduit API (ships `Conduit.postman_collection.json` + `run-api-tests.sh`). Independent oracle: **Schemathesis** vs the OpenAPI spec (`not_a_server_error`, `status_code_conformance`, `response_schema_conformance`, `content_type_conformance`, `negative_data_rejection`) + Newman/**ajv** for business shape. Fault-seeding (one fault/build): wrong status (201→200), **schema drift** (rename/drop field), off-by-one pagination, **auth bypass** (skip JWT). Each seeded fault must be caught by ≥1 oracle check. **Stateful scenario mandatory**: ≥5 interdependent calls (login→publish→comment→favorite→paginate) — StateEval shows even GPT-4.1 hits only ~56% pass@1 with state-transition oracles, so it's where an orchestrated team is most likely to fail.

**WebSocket / realtime.** Fixture: Socket.IO official **chat demo**. Independent oracle (message-sequence): capture frames via `page.on('websocket')` → `framereceived`; assert *sent message broadcasts to all peers, in order, within a latency bound* (the WS analog of dual-run). Fault-seeding via Playwright **`page.routeWebSocket`** (`WebSocketRoute`, v1.48+): **drop** (missed update), **reorder/duplicate**, **mutate** payload (schema drift), **close mid-stream** (reconnect) — one injector + one oracle in the same harness. Optional transport gate: **Autobahn|Testsuite** (RFC 6455, 500+ cases). Driver: **Artillery** (native Socket.IO) or Playwright, **not raw `k6/ws`** (Socket.IO framing); `grpcurl`/`ghz` + Pact V4 only if gRPC enters scope.

**Scoring (same dual-run + contract-violation spine):** passes on `v-clean` AND fails on the seeded-fault build it must catch AND the assertion targets the **contract** (schema/sequence), not the buggy value. A generated API test that "passes" on the fault build by asserting the drifted schema/wrong status = **masking** (dual-run reveals it). Primary metric (RESTestBench/LlamaRestTest): **fault-detection (contract-violation kill rate)** against the seeded catalog — not coverage, never "tests pass."

## 6. Automation substrate — the protocol call

**Decision: drive with `claude -p` stream-json as the CI boundary + Claude Agent SDK `canUseTool` + in-process MCP mocks + PostToolUse/SubagentStop hooks. Do NOT use ACP.** (Research recommendation verbatim.)

**Why SDK for the deep lane, ACP as a future portability lane** (full analysis in [`driver-acp-vs-sdk.md`](driver-acp-vs-sdk.md)). For the Claude-only deep-scoring lane the SDK wins on the two highest-signal injection probes: (1) ACP's `RequestPermissionResponse` **cannot rewrite a tool input** (only `{cancelled}` or `{selected, optionId}`) — so the masked-test probe has no pure-ACP path; the SDK's `canUseTool` `allow`+`updatedInput` is the only way. (2) ACP has **no client-side tool-RESULT mocking** (the SDK's in-process MCP `{isError:true}` does). (3) On attribution — *correction to an earlier draft*: ACP's wire model is **flat** (no session hierarchy; `ToolCall` has no nesting), but attribution is **recoverable, not erased** — `claude-agent-acp` stamps `_meta.claudeCode.parentToolUseId` and `emitRawSDKMessages` exposes the native SDK stream; the catch is generic clients don't consume it (open issue **#56**, *not* #305 — #305 was an unrelated, fixed subagent Write/Edit bug), and recovering it means running the SDK over an extra hop. **Net:** SDK for the deep Claude lane now; ACP later as a *second, capability-degraded driver* behind the same spine for cross-backend portability (Gemini/Codex/Copilot/Cursor/Qwen via one client). A2A is task-level (too coarse); AG-UI is UI-binding (we borrow its event vocabulary for the trace schema only).

**The four jobs:**
- **(a) Dispatch** — `claude -p "<charter to Tal>" --bare --output-format stream-json --model <m> --agents <team.json>` (one `AgentDefinition` per role); `--bare` = no stray hooks/MCP/CLAUDE.md. For fine-grained injection run the **SDK in-process** (`canUseTool` needs the SDK); the CLI is the language-agnostic fallback.
- **(b) Capture trajectory + subagent dispatches** — join messages by **`parent_tool_use_id`**; each `Agent`/`Task` `tool_use` is a subagent node (check **both** names — renamed Agent in v2.1.63 but `system:init` + `permission_denials` still say `Task`). Add **PostToolUse** + **SubagentStop** hooks to write the event log. Record `system/init`, `assistant`(tool_use), `user`(tool_result), `stream_event`, `system/api_retry`, final `result` (`total_cost_usd`, `session_id` → feeds `usage.mjs`). **Honest limits**: only the subagent's *final* message returns to the parent as the Agent *result*, but intermediate subagent calls are still visible via `parent_tool_use_id`; subagents are **one level deep** and can't spawn subagents; `AskUserQuestion` is **not** available inside subagents (so the scout-pause probe must target the orchestrator — which is correct anyway).
- **(c) Inject deterministically**, two layers, **default** permission mode (so every tool hits the callback; `bypassPermissions` skips it): **`canUseTool`** intercepts built-ins (`Bash`/`Edit`/`Write`/`Agent`) → `allow`, `deny`+message (recoverable blocker probe), or `allow`+`updatedInput` (rewrite — plant a masked test); **in-process MCP** (`createSdkMcpServer`/`tool()`) mocks domain tool *results* → canned content or **`isError:true`** (loop continues vs throwing which stops). `tools:[]` to force the agent onto the mocked surface. Order to respect: **hooks → deny rules → mode → allow rules → `canUseTool`**. Pure-CLI analog = a **PreToolUse hook** (no input-rewrite). **Gap to verify empirically**: does `canUseTool` fire for the `Agent`/`Task` dispatch tool? (first-step task).
- **(d) Reproducible CI** — `claude -p --bare --output-format stream-json`, pin `--model`, record `session_id`+`total_cost_usd`. Budget note: from 2026-06-15 SDK + `claude -p` on subscription plans draw from a **separate Agent SDK credit pool**. Determinism caveat: even temp-0 with mocks varies → keep **pass^k + tolerance bands**, never gate on one run.

| Capability | `claude -p` stream-json | Agent SDK | ACP |
|---|---|---|---|
| Subagent tree (`parent_tool_use_id`) | ✅ NDJSON | ✅ native | ❌ flattened |
| Per-call deny-with-guidance | ⚠️ PreToolUse (no rewrite) | ✅ `canUseTool` | ⚠️ `MAY`/config |
| Rewrite tool input (plant mask) | ❌ | ✅ `updatedInput` | ❌ |
| Mock tool RESULTS | ❌ | ✅ in-process MCP | ❌ |
| Cost/session for `usage.mjs` | ✅ `result` | ✅ | partial |

**Call: SDK in-process for gating runs (needs `canUseTool` + MCP + subagent tree); `claude -p --bare` stream-json as the language-agnostic CI boundary.**

## 7. Harness integration

```
eval/spine/
  usage.mjs            # ✅ EXISTS — cost ⨝ E2E run (result.total_cost_usd incl. subagents)
  passk.mjs            # (planned) REUSE — E2E pass^k per probe / per checkpoint
  matrix.mjs           # (planned) EXTEND — + stack + WS/API-fixture axes
  report.mjs           # (planned) EXTEND — 3-layer scorecard + deltas
  trajectory.mjs/.test # NEW stdlib-only — NDJSON → event log; parent_tool_use_id → subagent tree (AG-UI-shaped)
  conformance.mjs/.test# NEW stdlib-only — token-replay fitness/precision; S_partial; hard-gate product
  orchestrator.mjs/.test# NEW stdlib-only — detectors: role-violation, routing, gate-order, loop/R2-cap, handoff, deadlock
driver/                # CARRIES DEPS (SDK / Playwright / Schemathesis)
  run-e2e.mjs          # SDK in-process: dispatch Tal, canUseTool + MCP mocks + hooks, stream → trajectory.mjs
  inject.mjs           # planted perturbations: deny-blocker, isError, updatedInput-mask, unseeded
  capture.mjs          # claude -p --bare stream-json fallback
fixtures/ realworld/ todomvc/ conduit-api/ socketio-chat/   # + v-clean/v-bug-NNN/v-refactor/v-perturb-*
suites/ e2e-test-automation.mjs (★FIRST) · e2e-quality-engineering.mjs · e2e-web-qa.mjs · e2e-scout.mjs
reference-models/ test-automation.pipeline.json   # stages + allowed loops
```

**Stdlib boundary preserved**: `trajectory/conformance/orchestrator.mjs` + tests are zero-dep (the conformance *math* = pure functions on the event log, tested under root `node --test` like `usage.mjs`); only `driver/` carries deps and shells out / runs the SDK. **Reuse**: `usage.mjs` already reads `total_cost_usd` from `result` → cost ⨝ team run for free; `passk.mjs` aggregates each probe + checkpoint as binary → pass^k per invariant; `matrix.mjs` gains stack + WS/API axes (model axis already planned; quality on Claude host, host axis = parity smoke); `report.mjs` emits the 3-layer scorecard + multi-stack adaptation matrix + per-agent attribution. **Gating**: Crawl/Walk report-only (PR comment with the 3-layer delta); Run-phase gates only deterministic low-noise signals (the hard gates, masking/role-violation detectors, probe pass^k) with median-of-N + significance vs baseline; judged coordination scores stay advisory. CI: a separate `.github/workflows/eval-e2e.yml` on schedule + label + manual dispatch (never blocks `validate`); run under `CLAUDE_CONFIG_DIR=eval/.usage` so ccusage is eval-only.

## 8. Crawl / Walk / Run + the concrete first step

**Crawl — test-automation E2E, ONE stack, ONE fixture, a handful of checkpoints + ONE probe** (highest signal because the core invariants are deterministic — trustworthy first number with no judge). Fixture: TodoMVC/RealWorld React, builds `v-clean` + `v-bug-001` + one `v-perturb` (the **masked-test** probe — it hits both load-bearing hard gates at once). Driver: SDK in-process, `canUseTool` + PostToolUse hook, stream → `trajectory.mjs`. Checkpoints: #2 AFS-status-gate, #5 no-masking, #6 dispatch-is-work, #7 Tal-no-code-edits, #8 done=green-AND-tracked. Score: `S_process = S_partial · Π(hard_gate)` + masked-test probe (pass^3). Outcome = existing dual-run. Report-only vs a stored baseline.

**Walk** — add remaining probes (defect-found, blocker via `canUseTool` deny, unseeded), conformance fitness/precision vs `test-automation.pipeline.json`, multi-stack axis (+Angular +Next → stack-robustness), the API layer (Conduit + Schemathesis dual-run) + stateful scenario, the MARBLE/MAST **judge** (calibrated, order-swapped), `eval-e2e.yml` + change-scoped runs.

**Run** — full perturbation catalog + AFS-drift; WS layer (Socket.IO + `routeWebSocket` + Autobahn); .NET/Blazor stretch (Playwright .NET); cross-host parity smoke via the real installer; power-sized gating; the other orchestrators (`e2e-quality-engineering` = Max single-orchestrator no agent-to-agent handoff, `e2e-web-qa` = test-run-lead, `e2e-scout`).

**Concrete FIRST step — this week:**
1. `cd eval && npm i @anthropic-ai/claude-agent-sdk` in `driver/`. Write `driver/run-e2e.mjs`: SDK `query()` with the team as `agents`, default permission mode, a `canUseTool` that logs every call (start allow-all) + a PostToolUse hook appending NDJSON. Dispatch **"Automate the todo-toggle case"** to a Tal `AgentDefinition`.
2. Write `spine/trajectory.mjs` (+ stdlib `.test.mjs`): parse NDJSON, join `parent_tool_use_id`, emit the typed event log; assert the subagent tree reconstructs (analyst/implementer/reviewer under Tal). **Empirically confirm the gap**: does `canUseTool` fire for `Agent`/`Task`?
3. Write `spine/conformance.mjs` (+ stdlib `.test.mjs`): `S_partial = 0.5·ratio + 0.5·S_full` + the hard-gate **product**, plus the §3 detectors for #2/#5/#6/#7/#8. Golden-trace tests: a "good" log scores 1.0; a "skipped-review" log gets zeroed by the gate product. Runs under root `node --test`, zero deps, today.
4. Run end-to-end: dispatch Tal on `v-clean`, score; then inject the **masked-test perturbation** (`canUseTool` `updatedInput` adds a `test.fail`) and confirm the score **drops** — the hard-gate product zeroes the run if Tal merges, a correctly-rejecting reviewer keeps it green. **That install→dispatch→capture→conformance-score loop is the entire architecture**; everything else is fan-out on this spine.

---

Two things worth flagging beyond the brief, both grounded in the conformance reference I read:
- The **live-run gate (Tal's own, ≥N consecutive green before merge, default N=3)** is a *mandatory* invariant in the orchestration playbook that the task's invariant list omitted — I made it a scored hard gate (§3) because it's the playbook's named "cheapest control against the most expensive bug class" and a likely skip.
- The **R2-cap** (never dispatch R3 on the same root cause) is the playbook's "most expensive failure mode" — I mapped it to the Layer C loop detector.

Design file: `eval/design/e2e-orchestrated-eval.md`. Conformance reference sources it cites: `skills/test-automation-workflow/references/orchestration-playbook.md` and `agents/test-automation-lead/AGENT.md`.
