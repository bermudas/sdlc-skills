---
name: test-automation-implementation
description: "Reference library for the build slot of the test-automation pipeline — live investigation and the surface cache, defect filing with the pristine-repro gate, extending a covering spec, reporter and diagnostics tiers, Playwright patterns, and the field evidence behind the engineer's rules. The engineer's operating procedure itself (six-phase loop, Hard Rules, coverage declaration, Run Report) lives in the test-automation-engineer agent body; open a reference here when that body names it."
license: Apache-2.0
metadata:
  authors:
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.2.0"
---

# Test Automation Implementation — reference library

This skill is a **library, not a procedure**. The build slot's operating manual — the unit contract, the six-phase loop (Absorb → Investigate → Automate → Execute → Debug → Handoff), the 12 Hard Rules, the coverage declaration, the Run Report, the host rules — is the `test-automation-engineer` agent's own `AGENT.md`, identical on every host. Nothing behaviour-critical lives only here. Open a reference below when the agent body names it, or when you are filling the build slot as some other agent and need the detail behind a rule.

## When to open which reference

| Moment | Reference |
|---|---|
| Phase 2 — a handle you cannot resolve on paper, when to go live, fast-reach, evidence capture, blocked-step reasoning, surface-cache mechanics | [`references/investigation.md`](references/investigation.md) |
| Phase 5 — a product defect to file: pristine-repro gate, synthetic-input hygiene, tracker routing, the three filing styles, bundle-per-case | [`references/defect-filing.md`](references/defect-filing.md) |
| An `extend-existing` unit — additive-only mechanics, the tag chain, verdict scope over the whole extended spec | [`references/extend-existing.md`](references/extend-existing.md) |
| Phase 5 — failure artifacts are uninformative; a reporter question (diagnostic tiers, TMS/result reporters must be CI-gated and graceful, never replace a reporter mid-PR) | [`references/reporters.md`](references/reporters.md) |
| A Playwright project — POM and fixture patterns, selector specifics, gotchas | [`references/playwright-patterns.md`](references/playwright-patterns.md) |
| Why a rule is shaped the way it is — measured incidents behind context economy, waiting on long runs, reverse masking, read-only-by-default, memory commit safety, scaffold minimal | [`references/field-evidence.md`](references/field-evidence.md) |
| The full coverage contract — invariants, reviewer enforcement, gate mechanics | [`../test-automation-workflow/references/coverage-contract.md`](../test-automation-workflow/references/coverage-contract.md) |
| A tech-task brief instead of a case | [`../test-automation-workflow/references/tech-task-brief.md`](../test-automation-workflow/references/tech-task-brief.md) |

## Filling the build slot without the shipped engineer

Any agent named in `.agents/team-comms.md` § Roster as the builder can fill the slot: read `agents/test-automation-engineer/AGENT.md` from the installed factory (or this repository) as the contract, then use the references above. Orchestration — routing, dispatch, review, gate, merge — is the `test-automation-workflow` skill's territory and the lead agent's body.
