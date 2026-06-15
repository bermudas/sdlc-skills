---
name: responsive-audit
description: Use when auditing responsive and mobile-web behavior — touch-target size, viewport configuration, horizontal overflow, breakpoints, mobile navigation — via device emulation.
license: Apache-2.0
compatibility: Needs browser automation — Playwright (MCP/CLI), Chrome DevTools (MCP/CLI), or the bundled browser-verify skill (Chrome + Node 22, CDP).
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Mobile & Responsive Analysis

> **Schema & method** — the finding schema (p0–p3), evidence rules, dedup, and specialist dispatch are owned by [`quality-audit-workflow`](../quality-audit-workflow/SKILL.md). This skill is one specialist lane: the domain checks below and how to capture the evidence.

**Mobile 📱** specialist pass. This skill is agent-orchestrated — `qa-analyst` loads it as one specialist lane in a broader quality audit, then folds its findings into the consolidated report. It also runs standalone when the request is scoped to responsive / mobile-web behaviour alone.

The specialty here is **device-emulated layout**: how the page behaves at a phone viewport with touch input — touch-target ergonomics, viewport meta configuration, horizontal overflow, breakpoint integrity, and the presence of a usable mobile navigation pattern. You assert against what the emulated device actually renders, not against what the desktop layout implies.

## Data collection

Drive the page with whatever browser automation is wired — Playwright (MCP/CLI), a Chrome DevTools MCP, or the bundled **`browser-verify`** skill (CDP); see [`quality-audit-workflow`](../quality-audit-workflow/SKILL.md) § Browser data. Device emulation is the load-bearing capability here, so use a tool that can emulate a phone viewport. The commands below use `browser-verify` as the worked example — **read `skills/browser-verify/SKILL.md` first** (it owns Chrome lifecycle and the command surface), resolve `$SCRIPTS`, and start Chrome per that skill (`bash "$SCRIPTS/chrome-launcher.sh" start`), then:

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"

node "$SCRIPTS/cdp.mjs" navigate "<page-url>"
node "$SCRIPTS/cdp.mjs" emulate mobile
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/audit-mobile-emulated.png
node "$SCRIPTS/cdp.mjs" evaluate "JSON.stringify({
  viewport: { w: window.innerWidth, h: window.innerHeight },
  docWidth: document.documentElement.scrollWidth,
  horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  isMobileBreakpoint: window.matchMedia('(max-width: 768px)').matches,
  touchTargets: [...document.querySelectorAll('a, button, [role=button], input, select')]
    .map(el => { const r = el.getBoundingClientRect();
      return { text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), tooSmall: r.width < 44 || r.height < 44 }; })
    .filter(t => t.tooSmall && t.w > 0 && t.h > 0).slice(0, 15)
})"
node "$SCRIPTS/cdp.mjs" emulate desktop   # always restore emulation after the pass
```

Pull the viewport meta separately — `get-meta` already parses it:

```bash
node "$SCRIPTS/cdp.mjs" get-meta            # inspect the viewport meta tag + its content
```

Useful follow-ups when a finding needs proof:

- `node "$SCRIPTS/cdp.mjs" viewport 375 812` then `screenshot` — pin an exact phone viewport instead of a named device.
- `node "$SCRIPTS/cdp.mjs" emulate tablet` / `emulate ipad` — check an intermediate breakpoint where layouts often break.
- `node "$SCRIPTS/cdp.mjs" get-styles "<sel>" --props "font-size,overflow-x,position"` — confirm a computed value (text size, fixed-width container, sticky element) rather than guessing from source.
- `node "$SCRIPTS/cdp.mjs" query-all "<sel>"` — enumerate matches when one offending element repeats.

All evidence goes to **ephemeral `/tmp`** (e.g. `/tmp/audit-mobile-<page>-<step>.png`). Never write screenshots or reports into a project-root `reports/` or `tests/` directory.

## Focus areas

| Issue | Default priority |
|---|---|
| Touch targets < 44×44px (WCAG 2.5.5) | p1 |
| Horizontal scrolling at mobile width | p1 |
| Missing / misconfigured viewport meta | p1 |
| Fixed-width layout breaking on small screens | p1 |
| Hover-only interactions (no touch equivalent) | p1 |
| Pinch-zoom disabled (`user-scalable=no` / `maximum-scale=1`) | p1 |
| Content cut off or overlapping at mobile width | p1 |
| Unusable modal / dialog on small screens | p1 |
| Body text < 16px on mobile | p2 |
| Wrong mobile keyboard type (`<input type>` mismatch) | p2 |
| No mobile navigation pattern (hamburger / drawer / bottom bar) | p2 |
| Non-responsive images (fixed px width, no `srcset`) | p2 |

If `.agents/quality.md` pins a stricter touch-target threshold or a specific device matrix, defer to it over these defaults.

