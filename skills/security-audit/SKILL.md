---
name: security-audit
description: Use when auditing a web page for security exposure — XSS, CSRF, missing or weak headers (CSP, HSTS, X-Frame-Options), mixed content, exposed secrets, and the OWASP Top 10 surface.
license: Apache-2.0
compatibility: Needs browser automation — Playwright (MCP/CLI), Chrome DevTools (MCP/CLI), or the bundled browser-verify skill (Chrome + Node 22, CDP).
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Security & OWASP Audit

> **Schema & method** — the finding schema (p0–p3), evidence rules, dedup, and specialist dispatch are owned by [`quality-audit-workflow`](../quality-audit-workflow/SKILL.md). This skill is one specialist lane: the domain checks below and how to capture the evidence.

The **Security 🔒** specialist pass. This skill is agent-orchestrated — the
qa-analyst (or whichever agent owns the audit) loads it on demand when a
page handles auth, sensitive data, forms, or admin surfaces, or whenever the
operator explicitly asks for a security check. It is not a user-invocable
command; it runs as one specialist inside a larger audit and emits findings in
the shared finding schema (below).

What it covers: browser-visible security exposure — XSS vectors, CSRF gaps,
missing or weak security headers, mixed content, exposed secrets, and the slice
of the OWASP Top 10 you can detect without source access.

## Browser data (any browser tool; browser-verify shown)

Drive the page with whatever browser automation is wired — Playwright (MCP/CLI),
a Chrome DevTools MCP, or the bundled **`browser-verify`** skill (CDP, real input
events, zero deps); see [`quality-audit-workflow`](../quality-audit-workflow/SKILL.md)
§ Browser data. The commands below use `browser-verify` as the worked example —
**read `skills/browser-verify/SKILL.md` first** for its launch flow and command
reference, then resolve the scripts path:

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"
bash "$SCRIPTS/chrome-launcher.sh" start --headless
node "$SCRIPTS/cdp.mjs" navigate "<url>"
```

Collect the security-relevant signals (these are real `cdp.mjs` commands):

```bash
# Network — failed/security-relevant requests, status, initiators
node "$SCRIPTS/cdp.mjs" get-network --status error
node "$SCRIPTS/cdp.mjs" get-network --status 4xx

# Meta tags (CSP delivered via <meta http-equiv>, referrer, etc.)
node "$SCRIPTS/cdp.mjs" get-meta

# Cookies — flags (Secure, HttpOnly, SameSite)
node "$SCRIPTS/cdp.mjs" get-cookies

# Storage — sensitive data parked in localStorage/sessionStorage
node "$SCRIPTS/cdp.mjs" get-storage

# DOM — forms, inputs, inline handlers, reflected params
node "$SCRIPTS/cdp.mjs" get-html --selector "form"

# Arbitrary probes — enumerate scripts, check protocol, find tokens
node "$SCRIPTS/cdp.mjs" evaluate "location.protocol"
node "$SCRIPTS/cdp.mjs" evaluate "JSON.stringify([...document.querySelectorAll('script[src]')].map(s=>s.src))"

# Evidence (ephemeral /tmp only — NEVER a project reports/ or tests/ dir)
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/audit-security-form.png
```

Note on response headers: HTTP security headers (CSP, HSTS, X-Frame-Options,
X-Content-Type-Options) are most reliably read from `get-network` entries for the
document request; `<meta http-equiv>` only catches the subset delivered in HTML.
When you can't observe a header directly, say so and lower confidence — don't
assert a header is missing on a hunch.

Stop Chrome when done:

```bash
bash "$SCRIPTS/chrome-launcher.sh" stop
```

## Focus areas

Look for:

- **XSS vectors** — form/URL input reflected into the page without encoding;
  inline event handlers; `innerHTML` sinks; URL params rendered as content.
- **CSRF** — state-changing forms with no anti-CSRF token; cookies without
  `SameSite`.
- **Mixed content** — `http://` resources loaded on an `https://` page.
- **Exposed sensitive data** — tokens, passwords, PII, session IDs in URLs;
  secrets/API keys in page source, inline scripts, or network payloads.
- **Cookie flags** — missing `Secure`, `HttpOnly`, or `SameSite`.
- **Sensitive data in storage** — auth tokens or PII in `localStorage` /
  `sessionStorage`.
- **Weak password policy** — no length/complexity requirement; no strength meter.
- **Missing/weak security headers** — CSP, X-Frame-Options, HSTS,
  X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- **Clickjacking** — page embeddable in an iframe (no X-Frame-Options / frame
  CSP `ancestors`).
- **Open redirects** — redirect-target parameters in URLs.
- **Input validation gaps** — fields accepting unbounded or unsanitized input.

## OWASP Top 10 quick check

See [`references/owasp-checklist.md`](references/owasp-checklist.md) for the full
browser-visible indicator list and the security-headers table with priorities.

| OWASP | What to look for |
|---|---|
| A01 Broken Access Control | Direct object references, admin routes reachable without auth, CORS misconfig |
| A02 Cryptographic Failures | HTTP / mixed content, sensitive data in URLs or storage, cookies without `Secure` |
| A03 Injection | Reflected URL params, unencoded inputs, DB details in error messages |
| A05 Security Misconfiguration | Verbose error/stack pages, default-credential hints, version-leaking headers |
| A07 Auth Failures | No rate limiting, weak password policy, tokens in URLs, cookies without `HttpOnly` |
| A09 Logging Failures | No failed-login feedback (limited browser visibility — mostly informational) |

## Reference files

- [`references/owasp-checklist.md`](references/owasp-checklist.md) — OWASP Top 10
  browser-visible indicators + the security-headers table with priorities.
