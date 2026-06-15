---
name: Project briefing
description: Quality-engineering overlay — onboard a product for an in-sprint testing team; map running instance, requirements, cases, and run reports
type: project
---

## Project Knowledge

- **Engagement type:** in-sprint testing — the team intakes & **challenges** requirements, authors requirement-traced cases, executes them against the live build by **exploration**, reports, and **triangulates** (tested↔cases↔requirements↔functionality↔intent). Not framework automation. Your onboarding feeds that pipeline, so map the **evidence chain** (requirements → cases → results → build), not the application architecture in depth.
- **The running instance:** find how to reach a live, exercisable build — base URLs per environment (dev/staging/QA), the auth path and **which sample users/roles** exist (record env-var keys, never secrets), and how a tester gets a fresh build under test. Exploration-driven execution lives or dies on this; if there's no reachable instance, say so loudly.
- **Where requirements live:** the source of truth for stories + acceptance criteria — a tracker (Jira/Azure Boards/Linear), product docs, or a **requirement matrix that arrives as Excel** (the `requirement-traceability` skill reads those via `xlsx-reader`). Record the location and format so the story-analyst and case-curator can triage, match, and triangulate against it.
- **Where cases + results live:** existing manual test cases (TC files, a `test-cases/` tree, or xlsx) and prior run reports / a TMS (TestRail/Xray/Zephyr). These are the other two ends of the traceability matrix — note their format and whether case→requirement links already exist or have to be reconstructed.

## My Role Focus

Onboard the product for an in-sprint testing team: produce the usual
`.agents/*.md` (`profile.md`, `workflow.md`, `team-comms.md`) so the
`qe-lead` can run the triage→curate→author→review→execute→report→triangulate
pipeline without flying blind. The three fields the team leans on hardest
are the **reachable running instance** (with sample users), **where
requirements live**, and **where cases + run reports live** — fill them or
flag them explicitly as gaps.

Note for `workflow.md`: this team runs each pipeline stage as a **separate
single-purpose seat in an isolated dispatch** — `qe-lead` orchestrates
`story-analyst` (triage / cold case review / triangulation), `case-curator`,
`test-author`, `test-runner`, `test-reporter`; author ≠ executor ≠ reviewer is
structural. Capture **which browser/API exploration tooling is available**
(Playwright MCP, browser-verify, Chrome DevTools, direct API) so the runner and
author know what they can drive — there is no framework automation here. Also
record **where the existing test cases live** (TC tree / xlsx / TMS) — the
case-curator's inventory starts there.

Note for `team-comms.md`: it is the qe-lead's routing rulebook (hook-injected
at every dispatch) — it must state this team's actual shape: the seat roster
above, **all routing through the qe-lead** (no seat-to-seat handoff), the lead
as the **only tracker writer**, and that requirement questions go to the PO
out-of-band while the pipeline keeps moving.
