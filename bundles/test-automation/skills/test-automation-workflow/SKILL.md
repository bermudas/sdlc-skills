---
name: test-automation-workflow
description: "Reference library and Claude Code workflow scripts for the test-automation pipeline — the coverage contract, the reviewer contract, tech-task briefs, TMS adapters, framework architecture and scaffolds, campaign planning, the batch-build / campaign / integrate / stabilize workflows, the gate and cleanup scripts. The pipeline's operating procedure (routing on execution evidence, one unit per synchronous dispatch, build → static review → prove → merge → mirror, one report per batch) lives in the test-automation-lead agent body; open a reference here when that body names it."
license: Apache-2.0
metadata:
  authors:
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.4.0"
---

# Test Automation Workflow — reference library

This skill is a **library, not a procedure**. The orchestrator's operating manual — intake, routing, the per-unit loop, the gate, the report, the close, the outcome vocabulary, the dispatch card, blockers and the R2 cap, the host rules — is the `test-automation-lead` agent's own `AGENT.md`, identical on every host. The build slot's manual is `test-automation-engineer`'s `AGENT.md`. Nothing behaviour-critical lives only here; where a reference and an agent body differ, the body wins.

## The pipeline in one paragraph

A compiler from ready-made test cases (TMS or `tasks/<suite>/TC-*.md`) — and from tech-task briefs for work that is not a case — to merged, honest automated tests. Every case needs live-execution **evidence**, obtained one of three ways decided by `.agents/testing.md § Execution provider`: `manual-qa-verified` (the manual-qa team already executed it — build from their run record, never pay the live run twice), `needs-execution` (policy says manual-qa but no evidence exists — their `test-runner` earns it first; a runner that cannot be dispatched leaves the unit `needs-execution`, never silent self-execution), `combined` (provider `self` — the automated test's first green run against the real system IS the first execution). Units run **one at a time, each on its own branch** — build, static review by a fresh engineer, fix rounds until APPROVED, then the **gate** (N× green plus the blast radius once, plus the coverage-grammar grep and the CI-selection check), merge per the project's PR policy, mirror to tracker and TMS — and **one report** per batch. On Claude Code a batch the user or the seed asks to run as a workflow takes the same loop on a batch trunk with one machine-readable report (§ Claude Code workflows). The only repo artifacts are test code and the surface cache (`.agents/automation/surface/<feature>.md`). Two sources of truth: the case (read-only) and the code; the **coverage declaration** in every spec binds them.

## When to open which reference

| Moment | Reference |
|---|---|
| Any review, any gate, any back-write — the contract's invariants, grammar, closed exclusion vocabulary, enforcement split | [`references/coverage-contract.md`](references/coverage-contract.md) |
| Dispatching or filling the reviewer slot — the case↔code step walk, exclusion checks, masking checks, re-review classification (`unaddressed` / `persists` / `external`) | [`references/reviewer-contract.md`](references/reviewer-contract.md) |
| A unit that is not a case — required brief sections, quality gate, example | [`references/tech-task-brief.md`](references/tech-task-brief.md) |
| Intake from a TMS — adapter contract, supported TMSes, transports, dual-write policy, `.agents/test-automation.yaml` schema | [`references/tms-adapters.md`](references/tms-adapters.md) |
| Framework detection, host dispatch syntax, TMS CLI and back-write recipes | [`references/commands.md`](references/commands.md) |
| A framework decision — greenfield bootstrap, framework-scale work, mid-flow escalation | [`references/framework-architecture.md`](references/framework-architecture.md) |
| Executing a framework plan — minimal scaffolds per language | [`references/framework-scaffold.md`](references/framework-scaffold.md) |
| Live investigation tooling triage | [`references/browser-tools.md`](references/browser-tools.md) |
| A backlog ≳ 2× the batch size or a new coverage area — waves, foundation pass, clusters, the campaign card | [`references/campaign-planning.md`](references/campaign-planning.md) |
| **Claude Code** — running a batch as one deterministic workflow, the dispatch card, `resumeFromRunId`, model tiering, when NOT to use it | [`references/workflow-accelerant.md`](references/workflow-accelerant.md) |
| The long-form reference behind the lead's manual — dispatch templates, status reporting detail, interruption and resumption, anti-patterns, measured incidents | [`references/orchestration-playbook.md`](references/orchestration-playbook.md) |
| The build slot's own references — investigation, defect filing, extend-existing, reporters, Playwright patterns, field evidence | [`../test-automation-implementation/SKILL.md`](../test-automation-implementation/SKILL.md) |

## Claude Code workflows

On Claude Code, when the user or the seed asks for a batch to run as a workflow, the shipped scripts run it; installing the factory is the standing opt-in for the Workflow tool's multi-agent gate, so the lead does not re-ask. The scripts execute the same per-unit loop the lead runs by hand elsewhere — nothing about the contract changes, only who executes it.

| Script | Use |
|---|---|
| `scripts/workflows/batch-build.workflow.mjs` | the canonical batch: per unit build → review → fix rounds → merge back, then the gate, then the report |
| `scripts/workflows/batch-campaign.workflow.mjs` | waves of batches with a foundation pass, conducted from a campaign card |
| `scripts/workflows/batch-stabilize.workflow.mjs` | a red gate classified flake / test-code bug — batch-level diagnosis before any fix |
| `scripts/workflows/batch-integrate.workflow.mjs` | repair tool: re-merge a parked unit |
| `scripts/gate/gate-case.mjs` | the gate's mechanical half — fetch, checkout on the trunk, merge base first, run `--n 1` with timings, verdict; never merges, classifies or fixes |
| `scripts/cleanup.mjs` | close-out branch sweep; dry-run by default; deletes only what a merged PR names (`--merged` required) |
| `scripts/git-env.mjs` | the few git facts a script may read for itself |

```js
Workflow({
  scriptPath: "<installed skill dir>/scripts/workflows/batch-build.workflow.mjs",
  args: {
    slug: "<batch-slug>",                   // names .agents/automation/<slug>/
    base: "origin/<base-branch>",           // from .agents/profile.md
    cases: [{ id: "TC-101", title: "…" }],  // intake is the lead's — bodies snapshotted before dispatch
    // clusters: [["TC-1","TC-2"]]          // sizing-pass clusters
    // gateN, gateCmd, fixRounds, skipGate  // loop/gate knobs — defaults are right
  }
})
```

Write the `runId` to disk the moment the call returns. Crash or pause → re-invoke the same `scriptPath` + `args` plus `resumeFromRunId`. Recovery of an interrupted run has no script on purpose (branch naming, case-id shape and PR host are seed conventions): read the receipts under `.agents/telemetry/automation/returns/`, then git, then write the report — `references/orchestration-playbook.md` § Interruption and resumption.

## Filling the orchestrator slot without the shipped lead

Any agent named in `.agents/team-comms.md` § Roster as the orchestrator can fill the slot: read `agents/test-automation-lead/AGENT.md` from the installed factory (or this repository) as the contract, then use the references above. The build slot likewise reads `agents/test-automation-engineer/AGENT.md`.
