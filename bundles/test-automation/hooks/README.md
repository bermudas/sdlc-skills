# test-automation hooks

Three hooks, installed **only** with this factory. Two guard the lead against
the two failures the benchmark measured most; one records what a workflow
subagent concluded. The write guard runs on Claude Code, the Copilot CLI and
VS Code Copilot Chat; the other two are Claude Code only.

| Event | Script | Hosts | What it does |
|---|---|---|---|
| `PreToolUse` (`Write\|Edit\|MultiEdit\|NotebookEdit\|Bash`) / `preToolUse` | `lead-guard pretooluse` | Claude, Copilot CLI, VS Code | **Denies** the lead's own writes into the test tree, the abstraction layer, fixtures, framework configs, package files and `.env*` — with AGENT.md § No code edits quoted. A dispatched engineer's writes pass untouched. |
| `Stop` | `lead-guard stop` | Claude | **Blocks once** the lead's final turn when the session was a batch (two or more case ids in the ask, or two or more builder dispatches) and no `.agents/automation/<slug>/report.md` was written this session — the reason tells it to write the file. |
| `SubagentStop` (`test-automation-engineer\|test-automation-lead\|test-runner`) | `workflow-return` | Claude | Persists a workflow subagent's structured result to `.agents/telemetry/automation/returns/<run-id>/<agent-id>.json`, `async: true`, so an interrupted run resumes instead of redoing. |

## The lead guards

**Why.** TA-Bench core set, 2026-09-29, 18 single-unit runs on Claude: in 6 the
lead read the app's source, saw the bug, and wrote the spec itself with no
dispatch at all; in 5 more it skipped the reviewer "to save budget". In 24
batches the report file existed in 11. The AGENT.md said otherwise in every
run — prose is a weak lever against a model that has already seen the answer,
a refused tool call is not.

**How the guard tells the lead from its engineers** — the whole point, since it
must never hit a builder's write. Each host gives a different handle:

- **Claude Code** — the payload's `agent_type` (verified live on 2.1.282): the
  lead's own tool calls carry `test-automation-lead`, a dispatched engineer's
  `test-automation-engineer` — while `transcript_path` and the
  `CLAUDE_CODE_AGENT` env are identical for both.
- **Copilot CLI** — the `preToolUse` payload has no agent field at all
  (verified live on 1.0.87: `sessionId, toolName, toolArgs, cwd, timestamp`),
  but a dispatched subagent's calls arrive under a `sessionId` of their own.
  The root session's agent is on disk: `~/.copilot/session-state/<sessionId>/
  events.jsonl` opens with a `subagent.selected {agentName}` event — the same
  lookup the shared `session-start` hook uses to find the launch role. A
  subagent's `sessionId` has no such directory, so it resolves to nothing and
  passes. The deny goes out as a top-level `permissionDecision` (the CLI's
  shape); the model gets the reason back as the tool's error (`code: denied`)
  and carries on — a lead that then dispatches instead was the measured result.
- **VS Code Copilot Chat** — PreToolUse is Claude-shaped (`hook_event_name`,
  `tool_name`, `tool_input`, `session_id`) but has no agent field either, and
  `runSubagent` runs the engineer *inside the lead's chat session*, so
  `session_id` is the same for both (Chat 0.65 source). What differs is the hook
  **set**: a subagent runs the workspace hooks plus its own `.agent.md`
  frontmatter `hooks:`, the primary its own. So the installer splices this
  guard into the **lead's** `.agent.md` frontmatter (`hooks-copilot-agents.json`)
  with `SDLC_HOOK_ROLE=test-automation-lead` in its env — the file is the role —
  and the engineer's file carries no such entry. The workspace-level entry
  (which the CLI needs) also fires there for everyone, resolves no role, and
  allows.

No role resolvable (an older host, a relocated state dir) → the guard fails
open.

**What counts as a write.** Claude `Write`/`Edit`/`MultiEdit`/`NotebookEdit` by
`file_path`; Copilot CLI `create`/`edit`/`str_replace_editor` by `path`,
`apply_patch` by the files its patch names; VS Code `create_file`/
`replace_string_in_file`/`insert_edit_into_file`/`edit_notebook_file` by
`filePath`, `multi_replace_string_in_file` by each replacement's,
`create_directory` by `dirPath`, `apply_patch` likewise. For a shell (`Bash`,
`bash`, `powershell`, `run_in_terminal`), a guarded path that is the target of a
redirection or `tee`, an argument of `cp`/`mv`/`rm`/`touch`/`mkdir` or of a
PowerShell `Set-Content`/`Add-Content`/`Out-File`/`New-Item`/`Copy-Item`/
`Move-Item`/`Remove-Item`, an in-place `sed`/`perl`, or present alongside an
interpreter write (`open(p, 'w')`, `.write(`, `writeFileSync`) — the shapes the
leads actually used (`cat > tests/… <<'EOF'`, a python heredoc rewriting a page
object). Reads, greps, `sed -n`, the test runner and git pass.

**What is guarded — the seed decides, the defaults back it up.** The rule is
framework-independent; *which paths are the test tree* is not, so the guard
takes the union of two lists, matched case-insensitively:

- every backticked path in **`.agents/testing.md § Structure`** — scout records
  there where tests, page objects, step definitions, stories, fixtures and
  configs live for whatever framework the project uses (Vividus stories under
  `src/main/resources/story/`, qavajs `step_definitions/` and its root
  `config.ts`, a .NET `Tests/` folder). A `dir/` entry matches that directory
  anywhere in a path, `a/b/file.x` exactly that file, `file.x` any basename
  starting with it; placeholders like `<dir>/pages/`, URLs and glob tails are
  ignored (`tests/**/*.spec.ts` contributes `tests/`).
- the **defaults**: `tests/ test/ spec/ specs/ e2e/ __tests__/ features/
  src/test/ cypress/ .agents/automation/surface/` and files whose name starts
  with `playwright.config. cypress.config. jest.config. vitest.config.
  wdio.conf. pytest.ini conftest.py package.json package-lock.json
  pnpm-lock.yaml yarn.lock pyproject.toml requirements pom.xml build.gradle
  .env`.

`SDLC_LEAD_GUARD_DENY` (space-separated, same grammar; set it under `env` in
`.claude/settings.json`, or in the hook entry's `env` on Copilot) **replaces**
both lists; `SDLC_LEAD_GUARD=off` disables both guards.

**The stop guard never loops.** Claude marks the continuation's own stop with
`stop_hook_active`, and the guard lets that through — it asks once. A report
written in an earlier session does not count (mtime before this session's
first record).

**The stop guard is Claude-only.** It reads the batch signals (builder
dispatches, case ids) out of Claude's transcript JSONL; the Copilot CLI's
`agentStop` event and VS Code's `Stop` would need a reader for their own
transcript formats. Not ported — the Copilot failure the benchmark measured was
the lead building instead of dispatching, which the write guard covers.

## The receipt hook

### Why it exists

A dispatched agent's *payload* survives it — an implementer's commits are in
git, its surface-cache write-back is on disk. Its **conclusion** does not: the
structured result lives only in the value handed back, so an agent that dies
takes the record with it.

Measured on the lazy-modal campaign (2026-07-30): a foundation implementer built
its page objects, wrote the smoke spec, committed — then stalled. The branch was
finished and the workflow knew nothing about it. A human had to notice and
dispatch a rescue for work that was already done.

With this hook the same death costs nothing: the result file says the branch is
built, and the resume reads it.

### How it knows a dispatch came from a workflow

Claude Code files the two kinds apart:

```
subagents/workflows/wf_<run>/agent-<id>.jsonl   ← workflow
subagents/agent-<id>.jsonl                      ← dispatched directly
```

The path is the **only** reliable signal: both kinds carry the same
`agentType`, so the hook matcher cannot separate them — on the run above, one
`test-automation-engineer` sat in each place at the same moment. Matching the
path also works from either transcript store, a repo-local `.claude/projects`
or the global one, since both share that suffix.

Run id and agent id come out of the same string, so the hook needs no payload
fields beyond `transcript_path` and never has to know the batch slug.

### Why the result isn't just `last_assistant_message`

A schema-constrained agent returns through a `StructuredOutput` tool call, not
text — verified against real transcripts. The hook reads that call from the
transcript tail (bounded: one real agent transcript reached 1.3 MB). An
unschema'd agent falls back to its final text.

### The three rules it will not break

1. **Never writes to stdout.** Hook stdout can be injected into the model's
   context; bookkeeping chatter does not belong there.
2. **Never exits non-zero, never throws.** No node, no transcript, unreadable
   JSON, unwritable directory — all silent exit 0. The worst case is that a file
   is missing and the run behaves exactly as it does today.
3. **Never touches a non-workflow dispatch.** Verified: pointed at a directly
   dispatched agent it writes nothing at all, not even a directory.

## Install

**Claude Code** — `hooks.json` is merged into `.claude/settings.json`, tagged
`"_factory": "test-automation"` — re-running replaces only this factory's
entries, and other factories' hooks plus your own are left alone. Scripts land
in `.claude/hooks/test-automation/`.

**Copilot** (`--target copilot`) — `hooks-copilot.json` is written wholesale to
`.github/hooks/test-automation.json` (the engine's own `{version, hooks}` file,
read by both the CLI and VS Code), and `hooks-copilot-agents.json` is spliced
into the named agents' `.github/agents/<name>.agent.md` frontmatter `hooks:`
(VS Code reads those; the CLI ignores them). Scripts land in
`.github/hooks/test-automation/`. Only the write guard is registered — the
other two have no Copilot equivalent. Note the CLI loads repo hooks in `-p`
mode only for a trusted folder or with `COPILOT_ALLOW_ALL=true`, and VS Code
only in a trusted workspace (see the repo `hooks/README.md`).

Cursor and Windsurf get nothing; nothing changes there.

## Files

- `hooks.json` — the Claude event registration: the two lead guards and the
  receipt hook; the SubagentStop matcher lists the pipeline's
  dispatchable roles, `test-automation-engineer|test-automation-lead|test-runner`
  (`qa-engineer` left the roster in v2; `test-runner` is manual-qa's agent,
  matched so a runner PASS obtained on the needs-execution route banks a
  receipt in TA's own telemetry — a resume then doesn't pay the live run
  twice. Inert in manual-qa's own led runs: the hook writes only for
  Workflow-tool dispatches.)
- `hooks-copilot.json` — the Copilot workspace registration (`preToolUse` →
  the write guard), in the CLI's `{version, hooks}` shape with `bash` and
  `powershell` commands
- `hooks-copilot-agents.json` — the per-agent frontmatter hooks for VS Code:
  the write guard in the lead's file, with `SDLC_HOOK_ROLE` telling it whose
  calls it sees
- `scripts/lead-guard` — thin bash launcher (stdout carries the decision)
- `scripts/lead-guard.mjs` — both guards, all three host dialects, unit-tested
  in `lead-guard.test.mjs`
- `scripts/workflow-return` — thin bash launcher
- `scripts/workflow-return.mjs` — all the logic, unit-tested in
  `workflow-return.test.mjs` (kept OUT of `scripts/`, so it is not copied into consumer projects)
- `scripts/run-hook.cmd` — cross-platform launcher (mirrors the repo's core one)
