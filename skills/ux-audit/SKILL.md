---
name: ux-audit
description: Use when auditing UI/UX, form usability, error messaging, or page-type-specific patterns (landing, checkout, signup, search, and similar) on a web page.
license: Apache-2.0
compatibility: Needs browser automation — Playwright (MCP/CLI), Chrome DevTools (MCP/CLI), or the bundled browser-verify skill (Chrome + Node 22, CDP).
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# UI/UX & Page-Type Analysis

> **Schema & method** — the finding schema (p0–p3), evidence rules, dedup, and specialist dispatch are owned by [`quality-audit-workflow`](../quality-audit-workflow/SKILL.md). This skill is one specialist lane: the domain checks below and how to capture the evidence.

This skill is **agent-orchestrated** — the `qa-analyst` agent loads it as one
audit pass among several (accessibility, security, privacy, performance, responsive,
content/SEO, UX). It is not a standalone user command; it runs inside a larger quality
audit and contributes findings in the shared schema below.

Core pass:
- **UI/UX 🎨** — General UI patterns, forms, layout, navigation

Supporting passes (when detected):
- **GenAI 🤖** — AI/chatbot elements
- **Error Messages ⚠️** — Error states and messaging
- **Page-type checks** — domain-specific UX (see `references/page-types.md`)

## Driving the page — any browser tool (browser-verify shown)

Drive the page with whatever browser automation is wired — Playwright (MCP/CLI), a
Chrome DevTools MCP, or the bundled [`browser-verify`](../browser-verify/SKILL.md)
skill (CDP); see [`quality-audit-workflow`](../quality-audit-workflow/SKILL.md)
§ Browser data. The commands below use `browser-verify` as the worked example —
**read that SKILL.md first** for its script paths and full command list. Step-0
commands you'll lean on for a UX pass:

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"
bash "$SCRIPTS/chrome-launcher.sh" start --headless

node "$SCRIPTS/cdp.mjs" navigate "<page-url>"
node "$SCRIPTS/cdp.mjs" get-meta          # title / OG / structured data — confirm page type
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/audit-ux-overview.png
node "$SCRIPTS/cdp.mjs" query-all "form input, button, a"   # enumerate interactive elements
node "$SCRIPTS/cdp.mjs" get-styles ".btn-primary" --props "color,backgroundColor,fontSize"
node "$SCRIPTS/cdp.mjs" emulate mobile    # re-check layout / CTA hierarchy on small screens
node "$SCRIPTS/cdp.mjs" get-console       # surface JS errors behind broken interactions
node "$SCRIPTS/cdp.mjs" get-network --status error   # broken images / failed form posts

bash "$SCRIPTS/chrome-launcher.sh" stop
```

Screenshots and any captured evidence go to **ephemeral `/tmp`** (e.g.
`/tmp/audit-ux-<step>.png`, `/tmp/audit-checkout-validation.png`). Never write to a
project-root `reports/` or `tests/` directory — this audit produces findings, not
artifacts checked into the tree.

## UI/UX 🎨 — Focus Areas

- Unclear CTA hierarchy (which button is primary?)
- Inconsistent spacing/alignment
- Illegible typography
- Form fields without labels/placeholders
- No inline validation
- Confusing navigation
- Broken layouts (overlapping, broken grid)
- Missing empty states
- Overwhelming information density
- Unclear affordances (clickable or not?)

### Form Checks

- Labels associated with inputs
- Required fields marked
- Inline error messages
- Success state after submission
- Tab order matches visual order
- Appropriate input types (email, tel, number)

Drive forms with real input events (`type`, `click`, `press`) so client-side
validation actually fires, then read `get-console` and `get-network --status error`
to confirm whether submission worked. Capture before/after screenshots to `/tmp`.

## GenAI 🤖

Only when AI elements detected: chatbot failures, loading states, prompt injection
risks, missing escalation, no AI disclaimer, broken quick-replies.

## Error Messages ⚠️

Only when error states visible: generic messages, exposed stack traces, missing
retry mechanisms, no recovery path.

## Page-Type Checks

When the page matches a specific page type, read `references/page-types.md` for
targeted domain-specific checks. Confirm the page type from `get-meta` output
(title, OG type, structured data) plus the visible layout — don't guess from the URL
alone.

## Reference Files

- `references/page-types.md` — page-type specific focus areas (20+ types).
