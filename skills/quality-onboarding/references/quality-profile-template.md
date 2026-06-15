## .agents/quality.md Template

The **source-of-truth schema** for `.agents/quality.md` (OPTIONAL — QA-heavy
projects). Produced two ways: in the quality-engineering bundle scout derives it
autonomously from the surveyed codebase (no interview — per the bundle's scout
briefing); solo, `quality-onboarding` writes it interactively. Read on demand by
the qa-analyst (Quinn) when running `quality-audit-workflow` — **never**
added to the hook's always-injected shared-doc set.
Treat the sections below as themes, not required fields — fill what the
repo evidences and flag the rest under § Unconfirmed.

```markdown
# Quality Profile

> Scout-generated on {YYYY-MM-DD}. Per-product QA profile — specialist
> relevance, risk weighting, target surfaces, and standing waivers.
> Read on demand by the qa-analyst before audits. Update when
> the stack, surfaces, or user base shift.

## Specialist Relevance

One row per specialist. `high | med | low` with an evidence-based
*why* — cite what in the stack drives the rating. Specialists rated
`low` are de-prioritized (not banned) during an audit.

| Specialist    | Relevance | Why |
|---------------|-----------|-----|
| accessibility | high/med/low | e.g. public-facing UI, no `aria-*` usage detected |
| security      | high/med/low | e.g. handles auth + payment routes; JWT in localStorage |
| privacy       | high/med/low | e.g. stores PII in `users` table, no consent flow found |
| performance   | high/med/low | e.g. heavy client bundle, no code-splitting; image-heavy |
| responsive    | high/med/low | e.g. responsive breakpoints in CSS, mobile traffic likely |
| content-seo   | high/med/low | e.g. marketing pages present; meta tags sparse |
| ux            | high/med/low | e.g. multi-step flows (checkout, onboarding) |
| seo           | high/med/low | e.g. SSR/SSG marketing site vs. internal app |

## QA Priorities

Top risk areas for this product, highest first, each with *why*.

1. {highest-risk area} — {why: fragile flow / recent churn / untested surface}
2. {second} — {why}
3. {third} — {why}

## Target Environments & Viewports

Where audits should run, and the device/viewport matrix to cover.

| Environment | URL | Notes |
|-------------|-----|-------|
| Local       | http://localhost:{port} | {how to start} |
| Staging     | {url} | {access notes} |
| Production  | {url} | read-only — do not mutate |

- **Viewports:** {e.g. mobile 375×667, tablet 768×1024, desktop 1440×900 —
  derived from CSS breakpoints / supported devices}
- **Browsers:** {supported set, if the project states one}

## Standing Waivers

Known, accepted deviations an audit should **not** re-flag. Each waiver
names the scope, the reason, and (if known) an expiry / revisit trigger.

- {scope} — {why accepted} — {revisit when / expiry}

_None._ <!-- write this if there are no standing waivers -->

## Unconfirmed

- {anything scout couldn't determine from the codebase — Quinn confirms
  with the team before treating it as fact}
```

---

