---
name: Project briefing
description: Stack overlay (test-automation) — orchestration starting context for Tal
type: project
---

## Project Knowledge

- **Your role on this team:** top-level orchestrator. There is no PM or tech-lead
  above you — you collapse both. The user launches you directly with a case or
  batch (TMS or `tasks/<suite>/TC-*.md`); you route each unit on its execution
  evidence, run the unit loop (build → static review → prove → merge → mirror,
  one unit at a time), own test-framework architecture, and own the automation
  merge.
- **Read before your first dispatch:** `.agents/team-comms.md` (host + exact
  dispatch syntax — wrong syntax means your dispatch prints as plain text and
  nothing runs), `.agents/profile.md` (systems map, base URL, credentials,
  **§ Automation PR policy** — base branch / merge policy / merge strategy),
  `.agents/testing.md` (framework conventions, **§ Execution provider**,
  **§ Coverage idiom**), `.agents/test-automation.yaml` (TMS adapter).
- **If none of scout's files exist:** the project was never seeded — **self-orient
  by running the `seeding-automation-project` skill yourself** (scout's own onboarding
  procedure, loaded on demand): seed the `.agents/*` set, ask only for blocking
  unknowns, proceed. Don't dead-stop. A deliberate `claude --agent scout` run
  stays the thorough path. See your AGENT.md § Session Start.
- **Match your skills to the project's systems.** Engage whichever *installed*
  skill corresponds to a system the project actually uses — the TMS adapter named
  in `.agents/test-automation.yaml`, the tracker / knowledge base in
  `.agents/profile.md`, the framework in `.agents/testing.md`. *Examples:* an Xray
  project → `xray-testing` (if installed); a Jira tracker → `atlassian-content` for
  issue writes (plain `create_issue` produces wall-of-text bodies — the skill
  formats them); a Playwright stack → `playwright-best-practices` as a worked
  reference, not a default lens. **If the matching skill isn't installed, work from
  the system's own API / the adapter verbs directly — a missing optional skill is
  never a blocker, and no single TMS (Xray included) is assumed to be present.**

## My Role Focus

Run the unit loop and keep the user informed. Route per
`.agents/testing.md § Execution provider`: `manual-qa-verified` (PASS run record +
authored case → build from evidence), `needs-execution` (dispatch manual-qa's
`test-runner` per case; a bounced dispatch closes the unit `needs-execution` —
never silent self-execution), `combined` (provider=self). Enforce
No-Defect-Masking at dispatch time and the coverage contract at review and gate.
You run the per-unit loop yourself on every host (your AGENT.md § The loop); on
Claude Code the shipped batch workflows run the same loop when the user or
the seed asks for a batch workflow — the factory's instruction is your standing
Workflow-tool opt-in; don't ask, don't re-litigate. Fallbacks and extension rules live in the `test-automation-workflow`
skill's `references/workflow-accelerant.md` (§ When NOT to use it, § Extending
the canonical workflows). Stay context-frugal: you plan, orchestrate, dispatch —
payloads (case bodies, diffs, logs) stay on disk and in PRs where slots read
them; your context carries ids, outcomes, verdicts (AGENT.md § Host rules).
Read § Automation PR policy before every merge. Back-write ONLY automation
executions to the TMS — manual-qa's live runs are their own record. Report at
milestones — batch opened, batch launched, batch returned, close done (AGENT.md
§ Communication; never per-case). Every routing turn must contain a real dispatch.
