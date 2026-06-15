---
name: accessibility-audit
description: Use when auditing a rendered web page for accessibility and WCAG 2.1 AA/AAA conformance — contrast, ARIA, keyboard navigation, focus order, screen-reader semantics — from axe-core results plus visual review.
license: Apache-2.0
compatibility: Needs browser automation — Playwright (MCP/CLI), Chrome DevTools (MCP/CLI), or the bundled browser-verify skill (Chrome + Node 22, CDP).
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Accessibility & WCAG Analysis

> **Schema & method** — the finding schema (p0–p3), evidence rules, dedup, and specialist dispatch are owned by [`quality-audit-workflow`](../quality-audit-workflow/SKILL.md). This skill is one specialist lane: the domain checks below and how to capture the evidence.

This skill is **agent-orchestrated** — the `qa-analyst` (or whatever
agent owns a quality audit on the project) loads it as one specialist pass of a
larger page audit. It is not a standalone user command; it consumes the shared
Step-0 capture that the orchestrator collected once and reused across specialist
skills, then emits findings in the common schema.

Two analysis passes:

- **Accessibility ♿** — General a11y, user experience impact
- **WCAG Compliance 📋** — Technical WCAG 2.1 AA/AAA criteria

## Data Sources

**Primary — axe-core results** from an axe injection (collected in Step 0 by
whatever browser tool is wired — see § Step 0 below):

```
violations[].impact → priority mapping:
  critical → p0,  serious → p1,  moderate → p1,  minor → p3
```

Each violation has `id`, `description`, `helpUrl`, `nodes[].html`,
`nodes[].failureSummary`.

Attribute each violation to **Accessibility ♿** (UX-focused: cognitive load,
navigation clarity) or **WCAG 📋** (technical: contrast ratios, ARIA roles).

**Visual analysis** — for issues axe cannot catch. Take a screenshot to ephemeral
`/tmp` (e.g. `/tmp/audit-a11y-focus.png`) and review:

- Cognitive load and layout clarity
- Focus visibility (is the focus ring visible after `focus`?)
- Reading order vs visual order
- Motion/animation triggering vestibular issues
- Empty interactive elements with no accessible name

## Step 0 — capture once (browser-verify shown)

Capture with whatever browser tool is wired — Playwright (MCP/CLI), a Chrome
DevTools MCP, or the bundled `browser-verify` skill; see
[`quality-audit-workflow`](../quality-audit-workflow/SKILL.md) § Browser data for
the menu. The block below uses `browser-verify` (Chrome over CDP, zero npm
install) — read [`skills/browser-verify/SKILL.md`](../browser-verify/SKILL.md)
first for its command set, or run the equivalent axe/screenshot/meta/console
captures through your tool. The orchestrator typically captures Step 0 once and
shares it; if you are running the page cold, capture it yourself:

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"
bash "$SCRIPTS/chrome-launcher.sh" start --headless

node "$SCRIPTS/cdp.mjs" navigate "<page-url>"
node "$SCRIPTS/cdp.mjs" inject-axe                       # axe-core WCAG violations — primary source
node "$SCRIPTS/cdp.mjs" inject-axe --selector "main"     # scope axe to a subtree if the page is large
node "$SCRIPTS/cdp.mjs" get-meta                          # lang attr, page title, document metadata
node "$SCRIPTS/cdp.mjs" get-console                       # ARIA / framework warnings surface here
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/audit-a11y-overview.png
```

For keyboard / focus checks, drive real CDP input events and screenshot the
result to `/tmp`:

```bash
node "$SCRIPTS/cdp.mjs" press Tab                          # walk focus order
node "$SCRIPTS/cdp.mjs" evaluate "document.activeElement.outerHTML"   # what got focus
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/audit-a11y-focus-1.png
node "$SCRIPTS/cdp.mjs" get-styles ":focus" --props "outline,boxShadow,border"  # focus indicator
```

Use `get-html` / `get-text` / `get-attribute` to confirm ARIA attributes,
accessible names, and heading structure. Use `emulate mobile` + `screenshot` if
you need to confirm target-size or zoom behavior. Stop Chrome when done:
`bash "$SCRIPTS/chrome-launcher.sh" stop`.

All evidence goes to **ephemeral `/tmp`** (e.g. `/tmp/audit-a11y-<step>.png`) —
never a project-root `reports/` or `tests/` directory. The audit produces
findings, not committed artifacts.

## Accessibility ♿ — Focus Areas

Look for: missing alt text, unlabeled form controls, poor color contrast,
keyboard navigation issues, missing ARIA roles, focus order problems, missing
skip navigation, screen reader compatibility, interactive elements without
accessible names, missing form error announcements.

## WCAG 📋 — Criteria

See [`references/wcag-checklist.md`](references/wcag-checklist.md) for the full
criteria with priority mapping. The high-frequency offenders:

- Contrast ratios below 4.5:1 (AA) or 7:1 (AAA) — 1.4.3 / 1.4.6
- Missing text alternatives — 1.1.1
- Keyboard traps — 2.1.2
- Time limits without controls — 2.2.1
- No bypass blocks — 2.4.1
- Focus not visible — 2.4.7
- Language not specified — 3.1.1
- Error identification missing — 3.3.1
- Name/role/value violations — 4.1.2

## Reference Files

- [`references/wcag-checklist.md`](references/wcag-checklist.md) — WCAG 2.1 success criteria with priority mapping.
