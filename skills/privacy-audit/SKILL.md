---
name: privacy-audit
description: Use when auditing cookies, trackers, storage, consent banners, or GDPR compliance on a web page.
license: Apache-2.0
compatibility: Needs browser automation — Playwright (MCP/CLI), Chrome DevTools (MCP/CLI), or the bundled browser-verify skill (Chrome + Node 22, CDP).
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Privacy & GDPR Audit

> **Schema & method** — the finding schema (p0–p3), evidence rules, dedup, and specialist dispatch are owned by [`quality-audit-workflow`](../quality-audit-workflow/SKILL.md). This skill is one specialist lane: the domain checks below and how to capture the evidence.

This skill is **agent-orchestrated** — the `qa-analyst` loads it when a page
needs a privacy or GDPR pass; it is not something a human invokes directly. It runs
two analysis passes over the live page:

- **Privacy 🍪** — Cookie consent, trackers, storage hygiene
- **GDPR 🇪🇺** — GDPR compliance (browser-visible criteria only)

## Browser automation — any browser tool (browser-verify shown)

Drive the page with whatever browser automation is wired — Playwright (MCP/CLI),
a Chrome DevTools MCP, or the bundled **`browser-verify`** skill (CDP, zero
external deps); see [`quality-audit-workflow`](../quality-audit-workflow/SKILL.md)
§ Browser data. The commands below use `browser-verify` as the worked example
(it owns cookie/storage/network enumeration with no setup) — **read
`skills/browser-verify/SKILL.md` first** for its full command reference, then
resolve the scripts path from the install location:

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"
bash "$SCRIPTS/chrome-launcher.sh" start --headless
node "$SCRIPTS/cdp.mjs" navigate "https://example.com"
```

Screenshots and any captured evidence go to **ephemeral `/tmp`** (e.g.
`/tmp/audit-consent-banner.png`). Never write a project-root `reports/` or `tests/`
directory.

## Data Sources

**Primary — from the page itself** (no MCP can provide this):

```bash
node "$SCRIPTS/cdp.mjs" get-cookies     # name, value, domain, httpOnly, secure, expires per cookie
node "$SCRIPTS/cdp.mjs" get-storage     # localStorage + sessionStorage keys/values combined
node "$SCRIPTS/cdp.mjs" get-network     # requests + timing — see who fires before consent
node "$SCRIPTS/cdp.mjs" get-console     # console noise that may leak tracker init
node "$SCRIPTS/cdp.mjs" get-meta        # privacy-relevant meta / structured data
```

**Tracker enumeration** (run via `evaluate`):

```bash
node "$SCRIPTS/cdp.mjs" evaluate "JSON.stringify({
  googleAnalytics: !!(window.ga || window.gtag || window.dataLayer),
  metaPixel: !!(window.fbq || window._fbq),
  hotjar: !!window.hj,
  intercom: !!window.Intercom,
  segment: !!window.analytics,
  mixpanel: !!window.mixpanel
})"
```

**Cookie banner detection:**

```bash
node "$SCRIPTS/cdp.mjs" evaluate "JSON.stringify({
  hasCookieBanner: !!document.querySelector('[class*=cookie],[class*=consent],[id*=cookie],[id*=consent],[class*=gdpr],[id*=gdpr]'),
  hasAcceptButton: !!document.querySelector('[class*=cookie] button,[class*=consent] button,button[id*=accept i],button[class*=accept i]')
})"
```

**Third-party scripts:**

```bash
node "$SCRIPTS/cdp.mjs" evaluate "JSON.stringify((() => {
  const host = location.hostname;
  return [...document.querySelectorAll('script[src]')].map(s => s.src).filter(src => !src.includes(host));
})())"
```

**Tracking-before-consent check.** Navigate fresh (clear cookies first via
`clear-cookies`), then `get-network` *before* dismissing any banner — any
analytics/pixel request that already fired is a finding. Screenshot the banner state
to `/tmp/audit-consent-banner.png` as evidence.

## Privacy 🍪 — Focus Areas

Look for:

- Missing cookie consent banner
- Tracking scripts loading BEFORE consent
- Unclear data collection disclosures
- Missing privacy policy link
- Third-party scripts without notice
- Sensitive data in localStorage (tokens, PII)
- Analytics firing without consent
- Cookies missing `httpOnly` or `secure` flags

## GDPR 🇪🇺 — Focus Areas

Look for:

- No explicit consent before tracking
- Bundled consent without granularity
- No right-to-withdraw mechanism
- Missing data retention disclosures
- Pre-ticked consent boxes
- Unclear privacy notices

See `references/gdpr-checklist.md` for detailed pass/fail criteria. That checklist
covers only browser-visible compliance — legal-completeness is out of scope.

## Reference Files

- `references/gdpr-checklist.md` — GDPR compliance checks (browser-visible criteria)
