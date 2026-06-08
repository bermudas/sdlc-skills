# eval/ — HANDOFF (resume here)

Status as of 2026-06-08 · branch `docs/eval-harness-design` · **uncommitted** (everything is `?? eval/`).
This is the authoritative "where we are / how to resume" doc. It supersedes any
conflicting claim in the design docs (notably the older "Claude over ACP can't
select an agent" / `systemPrompt` framing — see §3, that was wrong).

---

## 1. TL;DR — what this is

A **dev-only evaluation harness** for the agents/bundles in this repo. It installs a
bundle into a throwaway project, drives the agents (Claude or Copilot) over **ACP**,
captures the session, and **scores** outcome + process-conformance + routing + skills +
cost, then writes a report. Goal: edit a prompt/skill/briefing → re-run → see better/worse,
across backends and app versions.

- **87 stdlib tests pass, zero deps** (`node --test "eval/**/*.test.mjs"`).
- Live drivers carry deps (Agent SDKs, Playwright) and need auth.
- The scoring **spine is wire-agnostic** (works on ACP and on `claude -p` stream-json).

---

## 2. The headline decision: ACP-universal, native `--agent` per runner

Drive **every backend through ACP**, selecting the agent **natively** (no `systemPrompt`
reconstruction — that was a wrong turn, now removed):

| Backend | Select the agent (native) | Where |
|---|---|---|
| **Claude** (`claude-agent-acp`) | `_meta.claudeCode.options = { agent:"<name>", settingSources:["user","project","local"] }` | `session/new` |
| **Copilot** (`copilot --acp`) | `--agent <name>` | spawn flag |
| **Codex** (`codex-acp`) | `session/setMode` (modes) | after session |
| **Gemini** (`gemini --acp`) | its own config files; no per-agent flag found | config |

There is **no ACP-standard "agent" field** (`session/new` = `cwd` + `mcpServers` only) — agent
selection is per-runner. Encapsulate it in a per-runner launcher (see §7 open item #3).

---

## 3. Key learnings (the hard-won stuff — don't re-derive)

1. **The SDK `Options.agent` field IS `--agent`.** `@anthropic-ai/claude-agent-sdk` `Options.agent?: string`
   is documented "equivalent to the `--agent` CLI flag." `claude-agent-acp` forwards
   `_meta.claudeCode.options` straight to the SDK. So `options.agent = "<name>"` loads the
   installed agent's **full** definition (model, skills, tools, persona) from `.claude/agents`
   — **natively**. Proven: the agent's frontmatter `model: sonnet` applied with **no override**
   (29 msgs on Sonnet — the earlier "Haiku bug" was just frontmatter being dropped when we
   *didn't* use the agent field).
2. **Do NOT use `_meta.systemPrompt` / hand-map model/skills/tools.** That was a workaround for a
   gap that doesn't exist. `appendSystemPrompt` also *dilutes* the agent against the `claude_code`
   preset → the agent shortcuts (doesn't orchestrate). Use `options.agent`.
3. **Hooks fire over ACP.** With `settingSources` including `project`, `claude-agent-acp` fires the
   project's `.claude/settings.json` hooks: **SessionStart AND SubagentStart both confirmed** (marker test).
   So scout's seeded `.agents/*` context reaches subagents on dispatch; `.agents/` was read 25× in a run.
4. **Subagent attribution over ACP is flattened but recoverable.** Children are tagged via
   `_meta.claudeCode.parentToolUseId` (Claude) or by **temporal bracket** (any backend — Copilot has no
   `_meta`). `spine/acp-trace.mjs › subagentTree()` does both. **Gotcha:** when computing the
   orchestrator's *own* edits (role-boundary check), EXCLUDE tool calls that are children of a dispatch —
   else the implementer's legit write is mis-blamed on Tal (this false-positive zeroed a run until fixed).
5. **`_meta` keys are camelCase** (the adapter is TypeScript, wrapping the TS Claude Agent SDK) — even from
   a Python client. snake_case (`setting_sources`) is silently ignored.
6. **Two lanes, one spine.** Claude can also run native `--agent` on the **deep lane** (`claude -p --agent`,
   stream-json) — richer native attribution, parsed by `spine/trajectory.mjs`. ACP is parsed by
   `spine/acp-trace.mjs`. Same scorers either way.
7. **Skill auto-load works but is under-measured.** With `options.agent`, the agent's frontmatter skills are
   *preloaded* (no `Skill` tool call needed). `spine/skills.invokedSkills` only catches *tool-invoked* skills,
   so "none via Skill tool" ≠ "skill not loaded." Behavior (it orchestrated) is the real signal.
8. **dual-run uses an installed chromium** headless-shell via `executablePath` from the ms-playwright cache
   (`driver/dual-run.mjs › resolveChromium()`) — no browser download.
9. **Don't run the installer from the repo root.** `node bin/init.mjs init …` writes `.claude/`, `.agents/`,
   and a `<!-- BUNDLE -->` block into `CLAUDE.md`/`AGENTS.md` of the CWD. Always `cd` to a throwaway dir first.

---

## 4. What's built

```
eval/
  README.md · HANDOFF.md(this) · FAILURE-MODES.md
  design/  qa-bundles-eval.md · dev-core-roles-eval.md · efficiency-and-cost.md
           e2e-orchestrated-eval.md · driver-acp-vs-sdk.md   (partly superseded by §2/§3 here)
  reference-models/  test-automation.pipeline.json · scout-artifacts.json
  rubrics/  scout-seeding.json                      (LLM-judge rubric; reviewable/extendable)
  spine/  (14 PURE scorers, stdlib, all tested under node --test)
    usage · trajectory · extract-trace · conformance · passk · seeding
    acp-trace(+subagentTree) · lint · dual-run · higher-level · routing · skills · judge · report
  suites/  test-automation/layer0-landing.test.mjs · scout/layer0-seeding-wiring.test.mjs
           scout/hooks-injection.integration.test.mjs (runs the REAL hook)
  driver/  (10, carry deps / live — NOT in the test path)
    run-pipeline.mjs   ★ full orchestrated pipeline over ACP (Tal → analyst/impl/reviewer) + conformance + dual-run
    run-outcome.mjs      single-agent: agent writes a test → dual-run it (outcome+honest)
    run-seed.mjs         scout seeds a project → seeding score + injection check
    run-e2e-acp.mjs      higher-level ACP lane (outcome/honest/process)
    run-e2e.mjs          SDK deep lane (canUseTool/MCP mocks) — optional
    dual-run.mjs         serve v-clean/v-bug + run a test in a real browser
    run-hooks.mjs        execute the real agent-start hook → parse injection
    run-flow.mjs         Stage-0 seed scorecard (offline)
    acp-smoke.mjs        minimal ACP client (drive any agent, dump session)
    inspect-run.mjs      digest a stream-json trajectory
  fixtures/todomvc/  v-clean · v-bug-001(seeded bug) · fault-manifest.yaml · facts/facts.json · tasks/ · seeded/.agents
  baselines/ results/  (results gitignored; baselines empty — see open item #5)
```

What's PROVEN LIVE: scout seeding (artifacts + facts recall 1.0 + skill auto-load + injection),
Claude & Copilot routing over ACP, subagent recovery on both, skill invocation, the full
pipeline (Tal → implementer → reviewer → merge) over ACP for both backends, dual-run outcome
(real test catches the seeded bug), reports.

---

## 5. How to run

```bash
# offline / free / deterministic (no model)
node eval/runner.mjs --layer 0 --bundle test-automation     # bundle structural integrity
node eval/runner.mjs --layer spine                          # all pure-scorer unit tests
node eval/runner.mjs --layer scout                          # Stage-0 seeding scorecard (runs the real hook)
node --test "eval/**/*.test.mjs"                            # everything (87)

# LIVE (needs: cd eval && npm install + auth)
#   Claude  → logged-in subscription OR ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN
#   Copilot → logged-in copilot CLI
node eval/driver/run-pipeline.mjs --terse --as-agent test-automation-lead --cwd <claude-proj>
node eval/driver/run-pipeline.mjs --terse --agent-cmd "copilot --acp --agent test-automation-lead" --cwd <copilot-proj>
node eval/driver/run-outcome.mjs  [--agent-cmd "copilot --acp"]
node eval/driver/run-seed.mjs     --cwd <project>
node eval/driver/dual-run.mjs     --fixture todomvc          # golden outcome-oracle check
```

**Setting up an isolated live project (per backend — /tmp is ephemeral, recreate on resume):**
```bash
TMP=/tmp/eval-claude; mkdir -p "$TMP/src" "$TMP/tests"
cp eval/fixtures/todomvc/v-clean/index.html "$TMP/src/"; cp eval/fixtures/todomvc/tasks/complete-todo.md "$TMP/"
# add package.json + playwright.config + README so scout has something to discover (see run-seed setup we used)
cd "$TMP" && node <repo>/bin/init.mjs init --bundle test-automation --target claude --yes   # --target copilot for the copilot dir
# then scout-seed it:  node <repo>/eval/driver/run-seed.mjs --cwd "$TMP"
```

---

## 6. Live findings so far (honest)

- **Native launch → real orchestration.** With `options.agent` (Claude) / `--agent` (Copilot), Tal dispatched
  implementer (+ reviewer + merge), wrote no test code itself (role respected), produced a **real** test
  (passes v-clean, fails v-bug-001), **honest** (lint clean), on **Sonnet** natively.
- **Partial pipeline on trivial tasks.** Tal **skips the analyst/AFS step** on the tiny complete-todo case →
  conformance correctly zeroes via `afs-gate`. Open question: does it run the *full* analyst→impl→reviewer on a
  **non-trivial** case? (open item #2) — settles "trivial-task pragmatism vs real adherence gap."
- **Copilot vs Claude:** both routed correctly and produced real+honest tests. Copilot didn't load the workflow
  skill the same way (Copilot Agent Skills differ); Claude preloads via the agent def.
- **ACP conformance adapter is heuristic:** role classification by dispatch title, reviewer verdict by regex on
  narration. These cause a couple of false zeros (e.g., `reviewer-approved`). Native attribution (deep lane) is
  cleaner. (open item #1)

---

## 7. Open items / next steps (prioritized)

1. **Tighten the ACP conformance adapter** in `run-pipeline.mjs` — role classification + reviewer-verdict
   extraction (or prefer native `parent_tool_use_id` / deep-lane attribution) so scores reflect reality.
2. **Non-trivial case run** — give Tal a case that genuinely warrants analyst+reviewer; see if it runs the full
   pipeline. Settles the partial-pipeline finding.
3. **Per-runner launch registry** — `launch(runner, agent, cwd, model)` encapsulating: Claude `_meta.options.agent`,
   Copilot `--agent` flag, Codex `session/setMode`, Gemini config. Replaces the `--agent-cmd` string + `buildMeta` special-case.
4. **Wire the LLM-judge grader** — `spine/judge.mjs` (buildJudgePrompt/scoreRubric, tested) + `rubrics/scout-seeding.json`
   exist; build `driver/grade.mjs` (read artifact + rubric → `claude -p --output-format json` structured → scoreRubric → report).
   Per-task rubric files = reviewable/updatable eval lists.
5. **baselines/ + regression gating** — commit reference scorecards; `report.mjs` already diffs; gate PRs on deltas.
6. **Pin SDK versions** in `eval/package.json` (currently `latest`): `@agentclientprotocol/sdk`,
   `@agentclientprotocol/claude-agent-acp`, `@anthropic-ai/claude-agent-sdk`, `playwright`.
7. **Multi-stack + API/WebSocket fixtures** (designed in `e2e-orchestrated-eval.md`, not built): RealWorld across
   React/Angular/Next/Blazor; Conduit API + Schemathesis; Socket.IO + routeWebSocket.
8. **(Optional) upstream `--agent` to claude-agent-acp** — purely ergonomic now that `options.agent` works.

---

## 8. Gotchas / invariants

- `eval/` is dev-only, **never installed** (`bin/init.mjs` scans only `agents//skills//bundles/`). Deps live in `eval/package.json`.
- Stdlib test path = the spine + suites (`*.test.mjs`); only `driver/*` carry deps + need a live model.
- Force `--model` ONLY for the model-comparison axis; otherwise the agent's frontmatter model applies natively.
- `_meta.claudeCode.options` keys must be **camelCase**.
- Always `cd` to a throwaway dir before `bin/init.mjs` (don't pollute the repo).
- Nothing is committed — branch `docs/eval-harness-design`, all of `eval/` is untracked.
