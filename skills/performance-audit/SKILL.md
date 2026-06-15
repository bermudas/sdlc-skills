---
name: performance-audit
description: Use when auditing performance, Core Web Vitals (LCP/CLS/TTFB), network waterfall, console errors, or runtime JavaScript issues on a web page.
license: Apache-2.0
compatibility: Needs browser automation — Playwright (MCP/CLI), Chrome DevTools (MCP/CLI), or the bundled browser-verify skill (Chrome + Node 22, CDP).
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Performance, Network & Console Audit

> **Schema & method** — the finding schema (p0–p3), evidence rules, dedup, and specialist dispatch are owned by [`quality-audit-workflow`](../quality-audit-workflow/SKILL.md). This skill is one specialist lane: the domain checks below and how to capture the evidence.

This skill is **agent-orchestrated** — the `qa-analyst` agent loads it as
one specialist pass inside a multi-specialist web audit. A human does not invoke
it directly; the architect dispatches it against a page already opened by the
audit's browser tool and collects its findings alongside the other audit
specialists (accessibility, security, privacy, responsive, content/SEO, UX).

Three analysis passes:

- **Performance 📡** — Core Web Vitals, load times, resource sizes
- **Console 🖥️** — runtime errors, warnings, CSP violations
- **JavaScript ⚡** — async issues, memory leaks, deprecated APIs

## Data sources

This skill consumes a page-state snapshot from whatever browser tool the audit is
using — Playwright (MCP/CLI), a Chrome DevTools MCP, or the bundled
**`browser-verify`** skill (see [`quality-audit-workflow`](../quality-audit-workflow/SKILL.md)
§ Browser data). The commands below use `browser-verify` as the worked example;
read [`skills/browser-verify/SKILL.md`](../browser-verify/SKILL.md) first for its
command set and resolve the scripts path from the install location, e.g.
`SCRIPTS=".claude/skills/browser-verify/scripts"`.

**Performance** uses `get-performance` and `get-network`:

```bash
node "$SCRIPTS/cdp.mjs" get-performance     # timing, resource sizes, LCP/FID/CLS
node "$SCRIPTS/cdp.mjs" get-network         # all requests + timing
node "$SCRIPTS/cdp.mjs" get-network --status error   # 4xx / 5xx / failed requests
```

Pull from `get-performance`: page timing (load, first byte), Core Web Vitals,
and the slowest resources. Pull from `get-network`: any 4xx/5xx, CORS failures,
and waterfall bottlenecks.

**Console** uses `get-console`:

```bash
node "$SCRIPTS/cdp.mjs" get-console         # all console messages
```

**Additional passes** (run if the first pass surfaces something to drill into):

```bash
node "$SCRIPTS/cdp.mjs" get-network --type xhr
node "$SCRIPTS/cdp.mjs" get-network --type script
```

## Performance 📡 — thresholds

See [`references/cwv-thresholds.md`](references/cwv-thresholds.md) for complete
thresholds, resource budgets, and the Lighthouse-score → priority mapping. The
headline gates:

| Metric | Good | Poor | Priority |
|---|---|---|---|
| LCP | < 2500ms | > 4000ms | p0 |
| CLS | < 0.1 | > 0.25 | p1 |
| TTFB | < 800ms | > 1800ms | p1 |
| Total load | < 1500ms | > 5000ms | p0 |

Look for: slow resources, oversized images, waterfall bottlenecks, missing
caching, CORS errors, render-blocking scripts, broken resource URLs.

## Console 🖥️ — focus areas

Look for: JS errors, deprecated API warnings, CSP violations, failed resource
loads, unhandled rejections, compatibility warnings.

Priority: `console.error` = p1, `console.warn` = p2, deprecated API = p3.

## JavaScript ⚡ — focus areas

Look for: uncaught promise rejections, missing error handlers, blocking
operations, memory leaks, race conditions, deprecated APIs, failed dynamic
imports.

## Reference files

- [`references/cwv-thresholds.md`](references/cwv-thresholds.md) — Core Web Vitals,
  resource budgets, Lighthouse-score and network-error priority mappings.
