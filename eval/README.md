# `eval/` — agent & bundle evaluation harness

> **▶ Resuming work? Read [`HANDOFF.md`](HANDOFF.md) first.** It is the authoritative
> "where we are / how to resume" doc and supersedes any conflicting claim here — most
> importantly the **native `--agent` selection** finding (agents are selected over ACP
> via `_meta.claudeCode.options.agent`, *not* `systemPrompt` reconstruction; see below).

**Status: spine implemented (87 stdlib tests, zero deps) + ACP-universal driver
proven live on Claude and Copilot CLI**, selecting the agent **natively** per runner.
Measures whether the agents/bundles got **better or worse** every time we edit an
agent prompt, a skill, or a bundle briefing — across host setups and app versions.
**Driven via one ACP client so the same suite scores any backend** (see *Automation
substrate* below).

**Fully-scored universal runs (live):**
- *Single-agent outcome:* on `complete-todo`, **both Claude and Copilot CLI** (over ACP)
  wrote their *own* Playwright test, which we **dual-ran** in a real browser against
  `v-clean` + `v-bug-001` → both **real** (pass clean, catch the bug) and **honest**
  (lint) → **PASS ✓** on both.
- *Orchestrated pipeline:* `driver/run-pipeline.mjs` drives the **whole team** — Tal
  (`test-automation-lead`) dispatching implementer + reviewer + merge — over ACP on
  both backends, selecting the agent **natively** (`_meta.claudeCode.options.agent` for
  Claude, `--agent` for Copilot), then scores process-conformance + the dual-run outcome.
  Still to wire: tighter conformance attribution + baselines/regression-gating (see
  [`HANDOFF.md`](HANDOFF.md) §7).

> **`eval/` is a dev-only workspace and is never installed or shipped.** The
> installer's content discovery (`bin/init.mjs` → `listDirs()`) only scans
> `agents/`, `skills/`, and `bundles/`. `eval/` is none of those, so it is never
> copied into a consumer's tree. That means the harness MAY use dependencies
> (Playwright, Inspect AI, Stryker, …) in its own `eval/package.json` without
> violating the stdlib-only rule that governs `bin/init.mjs`.

## The core finding (why this is custom work, not a public leaderboard)

There are two completely different camps of "AI agent benchmark", and the famous
"web testing" ones are in the wrong camp for our QA bundles:

| Camp | Examples (verified mid-2026) | Scores |
|---|---|---|
| **Task-completion** (agents *doing* web work) | WebArena (812), VisualWebArena (910), WebVoyager (643 live), Mind2Web (2,350), WorkArena | "Can the agent finish the flow?" |
| **Code-generation** (dev agents) | SWE-bench Verified (500, *saturated/contaminated*), SWE-bench Pro (731 public, ~59% ceiling), LiveCodeBench, Aider polyglot (225), Multi-SWE-bench | "Can it resolve a real issue?" (fail-to-pass) |
| **Bug-finding / test-gen** ← *where our QA bundles live* | **SWT-bench** (1,983; test must go fail→pass on the golden fix), TestGenEval, Defects4J/BugsInPy, **mutation testing** (PIT/StrykerJS) | "Did it *catch* that X is broken?" |

`web-qa` and `quality-engineering`/Quinn are scored on **bug detection**
(recall/precision), and `test-automation` on **test-generation quality** — the
*opposite* axis from WebArena & friends. **No public benchmark drops in.** The
closest published blueprint (Arbon 2026, seeded-bug → precision/recall/F1) is tiny
(43 bugs, 3 static pages, no running app, no version axis). Our plan — a running
app + a version axis + seeded faults — would *extend* the state of the art.

**The reframe:** we are not benchmarking a *model* (leaderboards already do that);
we are benchmarking **our prompt + skill + briefing layer on top of a model.** The
unit of measurement is the triple `(agent_version × fixture@version × host)` — which
*is* the "better-or-worse after I edit a prompt" loop.

## Design docs

- [`HANDOFF.md`](HANDOFF.md) — **start here to resume.** Current state, the
  ACP-universal / native-`--agent` decision, the hard-won learnings (hooks fire over
  ACP, subagent-attribution recovery + the exclude-children gotcha, camelCase `_meta`,
  dual-run chromium, don't run the installer from repo root), what's built, how to run,
  live findings, and the prioritized open items. Supersedes conflicting claims below.
- [`design/qa-bundles-eval.md`](design/qa-bundles-eval.md) — full eval design for
  the QA bundles: **`web-qa`, `test-automation`, `quality-engineering`/Quinn.**
  Per-bundle metrics, seeded-fault version matrix + `fault-manifest.yaml` schema,
  SWT-bench dual-run + mutation scoring, deterministic-first/LLM-judge scoring,
  `pass^k` variance, cross-host/version matrix, CI shape, crawl/walk/run roadmap.
- [`design/dev-core-roles-eval.md`](design/dev-core-roles-eval.md) — extends the
  *same* harness to the **dev + core roles**: js-dev, python-dev, ios-dev,
  tech-lead, ba, project-manager, scout, personal-assistant. Benchmark spine per
  role, explicit **gaps** (Swift/iOS, React/Next, FastAPI/FastMCP, decomposition,
  story quality, merge-gate, repo-onboarding, Teams/Obsidian — no public benchmark),
  and shared-harness integration.
- [`design/efficiency-and-cost.md`](design/efficiency-and-cost.md) — the
  **efficiency axis**: per-task/series cost + token metrics, **multi-model
  comparison** (quality/cost Pareto, reliability-adjusted cost), and **ccusage**
  session/filtered accounting. Cost ⨝ quality, joined per task.
- [`design/e2e-orchestrated-eval.md`](design/e2e-orchestrated-eval.md) — the
  **end-to-end / orchestrated-workflow** layer (above the per-agent/per-skill
  suites): hand one high-level task to an **orchestrator** (Tal / PM / test-run-lead /
  scout), capture the full multi-agent **trajectory**, and score **three layers** —
  *outcome* · *process-conformance* (did they follow the intended pipeline + invariants)
  · *orchestrator quality* (routing, gate enforcement, handoffs, recovery, role-boundary).
  Heart of it = **planted-perturbation probes** (inject a defect-found case / a blocker /
  a masked test / an unseeded repo and check the team responds correctly). Includes the
  **multi-stack** matrix (React/Angular/Next/Vue/Svelte/Blazor), **API + WebSocket**
  layers, and the **automation-substrate decision**.
- [`design/driver-acp-vs-sdk.md`](design/driver-acp-vs-sdk.md) — decision memo:
  **Claude Agent SDK vs ACP vs hybrid** for driving the agents. Verdict: SDK for the
  deep Claude lane now; **ACP later as a second, capability-degraded driver** behind
  the same spine for **cross-backend portability** (one client → Gemini/Codex/Copilot/
  Cursor/Qwen/…). Capability table + the corrected attribution facts.
- [`FAILURE-MODES.md`](FAILURE-MODES.md) — rationale doc: where AI testing
  succeeds vs fails, each failure mode mapped to the **metric that catches it** and
  the **agent rule that prevents it**. The "why" behind the metrics.

> **Automation substrate (decided — ACP-UNIVERSAL):** drive **every backend through one
> ACP client** (`driver/run-e2e-acp.mjs` / `driver/run-pipeline.mjs`) so the same suite
> scores Claude, Copilot CLI, Gemini, Codex… identically. The spine is driver-agnostic
> (it scores an event log + trace). Verified live on **Claude + Copilot CLI**.
> - **Agent selection is NATIVE, per-runner** (no `systemPrompt` reconstruction). There is
>   no ACP-standard "agent" field (`session/new` = `cwd` + `mcpServers`), so each runner
>   selects it its own way: **Claude** = `_meta.claudeCode.options.agent` (forwarded to the
>   Agent SDK's `Options.agent`, the documented `--agent` equivalent → loads the installed
>   agent's full model/skills/tools/persona); **Copilot** = `--agent <name>` spawn flag;
>   **Codex** = `session/setMode`; **Gemini** = config files. See [`HANDOFF.md`](HANDOFF.md) §2.
> - **Works over ACP:** routing, skill-invocation, subagent-tree recovery (via `_meta` or
>   the backend-agnostic **temporal bracket**), cost/usage, seeding+injection, the **blocker**
>   probe (`requestPermission` reject), masking **detection** (the harness owns the cwd →
>   read the produced test from disk + `lint`), and **outcome** (dual-run on `v-clean`/`v-bug`).
> - **Not over ACP → replaced by fixtures:** live mid-call **input-rewrite** and the agent's
>   internal-tool **result-mock**. The "does the reviewer catch a planted mask?" probe uses a
>   **pre-seeded `v-perturb-mask`** build instead of live rewrite.
> - **SDK lane (`driver/run-e2e.mjs`) is now OPTIONAL** — a Claude-only bonus for native
>   `parent_tool_use_id` depth, not required.
>
> See [`design/driver-acp-vs-sdk.md`](design/driver-acp-vs-sdk.md) (⟳ Revision: ACP-universal).

Both designs converge on **one runner, many role suites**, because a single seeded
fault is reusable across every suite (a bug to *detect* for QA = a fail-to-pass
*issue* for coding = a known-bad *diff* to review for tech-lead = a *PR-to-gate* for PM).

## Five decisions that matter most (research-backed)

1. **Deterministic oracle first, LLM-judge only for free text.** Test runners, axe
   IDs, DOM asserts, mutation kill = primary. Judge matches prose findings to fault
   IDs + rubric-scores reports; calibrate against a human-labeled subset; pairwise +
   order-swap to kill the ~33% position-bias flip.
2. **`pass^k`, not `pass@k`, is the headline.** Temp 0 ≠ reproducible on hosted APIs.
   A 70% agent has pass@3 ≈ 97% but **pass^3 ≈ 34%**. Run N=5–10/cell; gate only on a
   *significant* drop past the baseline band, never a single run.
3. **Mutation score over coverage** (≈98% coverage can coexist with ≈19% mutation
   score). For `test-automation`: SWT-bench dual-run + mutation kill + a
   **defect-masking detector** (a test that passes on a build it should fail).
4. **Contamination defenses** or prompt edits get gamed: private held-out fixtures,
   time-windowing vs model cutoff, quarterly rotation, mutation-perturbed variants.
5. **Decouple the two axes:** app-version axis runs on one host (most of the value);
   host axis is a cheap *parity smoke* testing the installer's flattening, cron-gated
   on `bin/init.mjs` changes.

## The flow starts with scout (seeding)

A real run doesn't begin by handing the orchestrator a task — it begins with
**scout seeding the project**. Scout generates the artifacts (`CLAUDE.md`,
`AGENTS.md`, `.agents/profile|workflow|testing|team-comms.md`, per-role
`.agents/memory/<role>/{MEMORY,project_briefing}.md`), and the **hooks inject
them** so downstream agents actually have context:

- `hooks/session-start` → injects the shared `.agents/*.md` at session start (and
  on clear/compact/resume); on an **unseeded** project it injects nothing.
- `hooks/agent-start` → on every sub-agent dispatch, injects that role's **memory**
  + the lean shared docs (the `@import`s don't work inside subagents).

So scout is the **foundation**, and the strongest way to score it is *did seeding
actually help downstream* — run the same Layer-2 flow **with** scout's artifacts vs
a bare repo and compare. We score scout three ways (`spine/seeding.mjs`):
**artifact presence** · **fact recall/precision** (saying `npm` when it's `pnpm`
is a *dangerous* error — agents act on it) · **injection** (do the hooks actually
deliver the artifacts).

## Three layers (+ the scout foundation)

The harness is a pyramid — cheap/deterministic at the bottom, expensive/live at the top.
Build downward-up: each layer reuses the **spine** (pure, tested scorers).

| Layer | What it checks | Cost | Status (test-automation) |
|---|---|---|---|
| **scout (Stage 0)** | Seeding: artifacts generated + structured · facts captured (no dangerous wrong facts) · hooks inject them | wiring = zero; fact-recall = live | wiring ✅ running; scorer ✅ running |
| **0 — landing / structural** | Does the bundle hang together? Are the orchestrator invariants still in source? | zero (no model) | ✅ **running** |
| **1 — component** | Per-skill / per-agent behavior (AFS quality, dual-run, masking detector, …) | live agent + fixtures | scaffolded (scorers exist in spine) |
| **2 — E2E orchestrated (ACP lane, default)** | Whole team via native `--agent`: outcome (dual-run) · process-conformance · routing · cross-backend | live team, any ACP agent | ✅ **running live** (Claude + Copilot); conformance adapter heuristic (tightening — HANDOFF §7) |
| **2 — E2E deep (SDK lane, optional)** | Claude-only deep probes: native `parent_tool_use_id` attribution + planted-perturbation (`canUseTool` rewrite / result-mock) | live team | driver scaffolded; conformance spine ✅ running |
| **2 — E2E higher-level (ACP lane)** | **Cross-backend, single-agent straightforward**: outcome (dual-run) · honest (lint) · process (produced-test/ran-tests/read-before-write) | live, any ACP agent | ✅ **running live** (Claude + Copilot) |

**Two drivers, one spine — ACP is the default.** The ACP lane (native `--agent` per
runner) scores what's *universally observable* over `session/update` across any backend
(Gemini, Codex, Claude…) and now runs the orchestrated pipeline live. The SDK lane is an
**optional** Claude-only bonus for deep `parent_tool_use_id` attribution + `canUseTool`
perturbation probes. See [`design/driver-acp-vs-sdk.md`](design/driver-acp-vs-sdk.md).

## Layout (what exists now ✅ vs scaffolded)

```
eval/
  runner.mjs                 # ✅ layer-aware CLI: --layer 0|spine|scout|1|2|acp
  package.json               # deps for the live drivers only (stdlib spine needs none)
  reference-models/
    test-automation.pipeline.json   # ✅ intended pipeline + invariants (conformance scores against this)
    scout-artifacts.json            # ✅ scout's artifacts + which hook injects each
  rubrics/
    scout-seeding.json              # ✅ LLM-judge rubric (reviewable/extendable weighted criteria)
  spine/                     # PURE scorers — stdlib only, run under `node --test`
    usage.mjs · .test.mjs            # ✅ cost/usage attribution (8)
    trajectory.mjs · .test.mjs       # ✅ stream-json → event log + subagent tree (3)
    extract-trace.mjs · .test.mjs    # ✅ event log → conformance trace (3)
    conformance.mjs · .test.mjs      # ✅ S_partial·Π(gate)·Π(critical) + perturbation probes (10)
    passk.mjs · .test.mjs            # ✅ pass@1 / pass@k / pass^k (4)
    seeding.mjs · .test.mjs          # ✅ scout: artifacts · fact recall/precision · injection (7)
    acp-trace.mjs · .test.mjs        # ✅ ACP session/update → signals + subagent-tree recovery (_meta or bracket) (6)
    lint.mjs · .test.mjs             # ✅ static masking/sleep lint of generated tests (4)
    dual-run.mjs · .test.mjs         # ✅ classify real / masked / broken from clean+bug runs (3)
    higher-level.mjs · .test.mjs     # ✅ compose dual-run + lint + ACP process → straightforward scorecard (4)
    routing.mjs · .test.mjs          # ✅ routing-correctness: dispatched? · right slot? · self-answered? (5)
    skills.mjs · .test.mjs           # ✅ skill loads: intended (frontmatter) · resolvable · invoked (Skill tool, SDK+ACP) (6)
    judge.mjs · .test.mjs            # ✅ LLM-as-judge: build prompt/schema from rubric + weighted scoreRubric (5)
    report.mjs · .test.mjs           # ✅ run → markdown report + JSON · baseline diff · cross-backend table (4)
  suites/
    test-automation/layer0-landing.test.mjs        # ✅ Layer 0 structural (8)
    scout/layer0-seeding-wiring.test.mjs           # ✅ injection chain intact, static (5)
    scout/hooks-injection.integration.test.mjs     # ✅ runs the REAL hook → asserts injection (1)
  driver/                    # carries deps / shells out — not in the test path
    run-pipeline.mjs         # ✅ ★ full orchestrated pipeline over ACP (Tal → impl/reviewer/merge) + conformance + dual-run; native --agent per runner
    run-seed.mjs             # ✅ scout seeds a project over ACP → seeding score + injection check
    run-hooks.mjs · run-flow.mjs   # ✅ Stage 0 (seed→inject→score) runs FOR REAL offline
    run-e2e.mjs              # SDK deep lane (Claude, optional): dispatch Tal, canUseTool, capture → conformance
    run-e2e-acp.mjs          # ✅ ACP lane (any backend): drive agent → session/update → higher-level score
    dual-run.mjs             # ✅ serve v-clean/v-bug (stdlib) + run a test on both in a real browser (cached chromium)
    run-outcome.mjs          # ✅ FULLY-SCORED universal run: agent writes a test → dual-run it → report (Claude + Copilot)
    acp-smoke.mjs · inspect-run.mjs  # ACP smoke client · CLI-trajectory inspector
  fixtures/
    todomvc/                 # ✅ v-clean · v-bug-001 (seeded bug) · fault-manifest · facts · seeded/.agents
  baselines/  results/       # (next) scorecards over time
```
**87 stdlib tests pass today, zero deps** — including an integration test that
*executes the real hook*. The drivers carry the SDKs (`cd eval && npm install`) and
are the only pieces that need auth + a live agent.

## Backends (drive targets)

Two senses of "target": **install** (ship native agent files — the installer already
does all three) and **drive** (run + score). Verified **live** (Claude + Copilot
both routed `Tal → qa-engineer` and ran a subagent-with-tools task over ACP):

| Backend | Install | Drive (eval) | Subagent recovery over ACP | Proven |
|---|---|---|---|---|
| **Claude** | `--target claude` | SDK deep lane (native attribution) **+** ACP (`claude-agent-acp`) | `_meta.claudeCode.parentToolUseId` **and** bracket | ✅ routing + subagent-with-tools |
| **Copilot CLI** | `--target copilot` → `.github/agents/*.agent.md` | ACP (`copilot --acp`) **+** headless `copilot -p` | **bracket** (no `_meta`; internals still flatten) | ✅ routing (→qa-engineer) + subagent-with-tools (echo/pwd recovered) |
| **Copilot in VS Code** | `--target` (VS Code form) | same engine via Copilot CLI · cloud via Agent Tasks REST API · GUI = last resort | (via the CLI lane) | install/parity only |

Empirical learnings from the live runs:
- **One ACP client** (`run-e2e-acp.mjs --agent-cmd "…"`) drives Claude *and* Copilot — true multi-client.
- Subagent dispatches **flatten** over ACP on both, but internals are recoverable — via `_meta` (Claude) or the backend-agnostic **temporal bracket** (both). `spine/acp-trace.mjs › subagentTree()` does it; the dispatch's `completed` is where the subagent result returns.
- **Routing / instruction-following** ("dispatched to the right slot, didn't self-answer") is scorable over ACP via `spine/routing.mjs` (heuristic: dispatch/child titles + agent text). The SDK lane gives exact `subagent_type`.
- **VS Code Copilot's in-editor GUI isn't cleanly headless** — cover its *behavior* via the Copilot CLI lane (same `.agent.md`/skills/subagents), use **install-parity** checks for the VS-Code-specific form, and the **cloud REST API** for outcome-level.

## Running it

```bash
node eval/runner.mjs --layer 0 --bundle test-automation   # landing/structural — instant, free
node eval/runner.mjs --layer spine                        # all pure-scorer unit tests
node eval/runner.mjs --layer scout                        # Stage 0: REAL seeding scorecard (runs the hooks) — free
node --test "eval/**/*.test.mjs"                           # everything (also picked up by root `npm test`)

# Orchestrated pipeline over ACP — native --agent per runner (needs: cd eval && npm install + auth)
node eval/driver/run-pipeline.mjs --terse --as-agent test-automation-lead --cwd <claude-proj>
node eval/driver/run-pipeline.mjs --terse --agent-cmd "copilot --acp --agent test-automation-lead" --cwd <copilot-proj>

# Layer 2 — SDK deep lane, Claude (optional; needs: cd eval && npm install + CLAUDE_CODE_OAUTH_TOKEN/ANTHROPIC_API_KEY)
node eval/runner.mjs --layer 2 --case complete-todo --perturb mask

# Higher-level ACP lane — any backend (needs: npm install + an ACP agent on PATH)
node eval/runner.mjs --layer acp --agent-cmd "gemini --experimental-acp" --case complete-todo
```

`--layer scout` already prints a real scorecard today:
```
=== Stage 0 · SEED · fixture=todomvc role=test-automation-engineer ===
artifacts:   8/8 required present (coverage 1)
facts:       recall 1 · no dangerous fabrications
injection:   shared=[.agents/testing.md, .agents/profile.md, .agents/workflow.md, .agents/team-comms.md] memory=true → OK
SEEDING USABLE: YES ✓
```

## Next steps

The Stage-0 (scout seeding) and the orchestrated pipeline **run live today** over ACP on
both Claude and Copilot, with the conformance + dual-run scorers wired (the old
`extractTracePlaceholder` is gone; the TodoMVC `v-clean`/`v-bug-001` + `fault-manifest`
fixture exists). The prioritized remaining work lives in **[`HANDOFF.md`](HANDOFF.md) §7**:

1. Tighten the ACP conformance adapter (role classification + reviewer-verdict extraction,
   or prefer native `parent_tool_use_id` attribution).
2. A **non-trivial** case run (does Tal run the *full* analyst→impl→reviewer when the task warrants it?).
3. A per-runner **launch registry** encapsulating native agent selection.
4. Wire `driver/grade.mjs` (LLM-judge: `spine/judge.mjs` + `rubrics/*.json` are built/tested).
5. **baselines/** + regression gating (`report.mjs` already diffs).
6. Pin SDK versions; add multi-stack + API/WebSocket fixtures.

---

*Provenance: synthesized 2026-06-04 from two multi-agent research workflows (web-agent
+ test-gen/bug-finding benchmarks; dev/core-role + code-gen benchmarks), with the
load-bearing benchmark facts adversarially fact-checked. Benchmark task counts,
saturation/contamination notes, and the no-public-benchmark gaps reflect that
verification pass. See the design docs for the full citation set.*
