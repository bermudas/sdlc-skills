---
name: content-seo-audit
description: Use when auditing content quality and SEO on a web page — copy clarity, meta tags, structured data, headings, canonical/robots, broken links.
license: Apache-2.0
compatibility: Needs browser automation — Playwright (MCP/CLI), Chrome DevTools (MCP/CLI), or the bundled browser-verify skill (Chrome + Node 22, CDP).
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Content & SEO Audit

> **Schema & method** — the finding schema (p0–p3), evidence rules, dedup, and specialist dispatch are owned by [`quality-audit-workflow`](../quality-audit-workflow/SKILL.md). This skill is one specialist lane: the domain checks below and how to capture the evidence.

The **Content ✍️** specialist pass. This skill is agent-orchestrated — `qa-analyst`
loads it on demand as one specialist among several, working from page data already
collected in the shared Step 0. It is not invoked directly by a user; the orchestrating
agent dispatches it and merges its findings into the audit's finding schema.

## Data Sources

Drive the page with whatever browser automation is wired — Playwright (MCP/CLI), a Chrome
DevTools MCP, or the bundled **`browser-verify`** skill (CDP); see
[`quality-audit-workflow`](../quality-audit-workflow/SKILL.md) § Browser data. The commands below
use `browser-verify` as the worked example — read
[`skills/browser-verify/SKILL.md`](../browser-verify/SKILL.md) first for the launch dance and the
real command names, resolve `SCRIPTS=".claude/skills/browser-verify/scripts"`, start Chrome, then
collect:

**`get-meta`** — the primary source for this pass. Returns:

```
title, description, keywords, viewport, robots, canonical
og.*, twitter.*, structuredData (JSON-LD)
```

```bash
node "$SCRIPTS/cdp.mjs" get-meta
```

Supporting commands when `get-meta` isn't enough:

- `get-text` / `get-html [--selector s]` — pull body copy and heading structure for the
  copy-quality and headings checks (`get-text --selector "main"`, then inspect `h1`…`h6`).
- `screenshot --output /tmp/audit-<page>-<step>.png` — capture the rendered page for visual
  copy-quality analysis (vague CTAs, placeholder text, tone). Save evidence to **ephemeral
  `/tmp` only** — never a project-root `reports/` or `tests/` dir.
- `get-network --status 4xx` / `get-network --status error` — surface broken links and dead
  resources referenced from the page.

If no browser tool is available (no Playwright, no DevTools MCP, and browser-verify can't run —
no Chrome, Node too old), ask the operator for a screenshot of the page and note the missing
data — lower confidence accordingly.

## Focus Areas

Copy quality (visual + text analysis):

- Typos and grammatical errors
- Inconsistent tone/voice (against `.agents/quality.md` brand voice if pinned)
- Vague CTAs ("Click here", "Submit")
- Missing/misleading headings; `h1`…`h6` hierarchy that skips levels
- Placeholder text left in ("Lorem ipsum", "TODO")
- Unclear value proposition
- Broken links in body text (cross-check against `get-network --status 4xx`)

### SEO Meta Checks

| Element | Priority |
|---|---|
| `<title>` (missing/empty/duplicated) | p1 |
| `meta description` (missing/truncated) | p1 |
| `og:title` + `og:image` | p2 |
| `canonical` URL (missing, or wrong domain vs `.agents/quality.md`) | p2 |
| `robots` = `noindex` on a live page | p0 |
| Structured data (JSON-LD) present + valid | p2 |
| `twitter:card` | p3 |

A live page returning `noindex` is the one p0 here — it silently de-lists the page from search.
Confirm it's not an intentional `noindex` surface listed in `.agents/quality.md` before filing p0;
if the profile is absent, file at p0 with confidence ≤ 7 and flag the assumption.

