# TAE-SWE-bench-Harvest — a harvested-corpus benchmark for test-automation engineering under adversarial perturbation

> **Status (2026-06-08):** design refined after the first vetting/critique workflow. The load-bearing
> tiering decision is now **LOCKED**: **hand-seeded private faults are the gated HEADLINE; harvested
> public PRs are a report-only CALIBRATION overlay that never gates** (see §1.4). This cascades through
> §2.3 (the *seeded* corpus guarantees matrix coverage), §6/§10 (PR-tier = seeded static/served, mutation
> in-loop; nightly = harvested Docker), and resolves the §11 open decisions. Uncommitted.

A design for a new benchmark that **extends the existing `eval/` harness** ([`README.md`](../README.md),
[`HANDOFF.md`](../HANDOFF.md)). It mines real merged PRs from a curated allowlist of self-hostable
web apps and turns them into TAE (test-automation-engineering) tasks. The scored object is
**test quality under adversarial perturbation** — does the agent's test *fail on the bug and pass on the
fix* (SWT-bench), *kill near-miss mutants* (sensitivity), *survive a behavior-preserving refactor*
(robustness), *not flake* (stability), and produce all of that *efficiently* (quality-gated cost) — not
"can it fix the bug" (SWE-bench).

This doc reuses the spine scorers already built (`dual-run.mjs`, `lint.mjs`, `passk.mjs`, `usage.mjs`,
`report.mjs`, `conformance.mjs`) and the `fault-manifest.yaml` contract; it adds harvest tooling, a
case schema, and three new scorers. Every metric traces to a row in [`FAILURE-MODES.md`](../FAILURE-MODES.md).

It folds in the adversarial critiques verbatim where they say "no" or "with-changes": the harvest is a
**per-repo crawl, not a GitHub search**; the red→green oracle uses the **SWT-bench test_patch/code_patch
split**, never "run the test at the parent"; SENSITIVITY uses a **curated observable-mutant catalog scored
through the existing dual-run**, never Stryker-in-the-loop per mutant; refactor builds are **hand-authored,
gate-validated static fixtures**, never live-generated; and harvested cases are a **calibration tier**, not
the headline — the hand-seeded private faults remain the gated number.

---

## 1. Goal & framing

### 1.1 What it measures

Given a real bug-fix PR that *also* changed an in-repo E2E test, we reconstruct two app builds — `v-bug`
(the parent, before the fix) and `v-fix` (the merge, after the fix) — plus a set of **perturbations**
(mutants and refactors). We then hand the agent a TAE task derived from the issue text and score the test
it authors on five axes:

1. **Correctness** — the agent's test FAILS on `v-bug` and PASSES on `v-fix` (the SWT-bench dual-run S signal).
2. **Sensitivity** — it also kills a curated catalog of UI-observable *near-miss* mutants, not just the one
   canonical bug (mutation kill-rate, the strong test-quality metric — coverage is a weak proxy).
3. **Specificity / robustness** — it still passes on a **behavior-preserving refactor** build (`v-refactor-NN`):
   it is anchored on stable handles, not brittle locators.
4. **Stability** — it produces the same outcome classification across N reruns (no flake).
5. **Efficiency, quality-gated** — the headline is `pass^k` over a **qualified-run boolean** (correct AND
   sensitive-enough AND robust AND under a cost cap), reported with **cost-to-qualify**.

### 1.2 How it differs from SWT-bench / SWE-bench

| | SWE-bench | SWT-bench | **This benchmark (TAE harvest)** |
|---|---|---|---|
| Agent produces | a **code fix** | a **test** that reproduces the bug | a **test** + we measure its *quality under perturbation* |
| Oracle | hidden tests go fail→pass on the agent's patch | golden fix makes the agent's test go fail→pass | dual-run + **mutation kill** + **refactor-invariance** + **flake** + **cost-gate** |
| Test layer | unit/integration (in-process) | unit/integration | **browser E2E** (Playwright/Cypress against a running app) |
| What "good" means | the bug is fixed | the test catches the bug | the test catches the bug, **catches near-misses, survives refactors, doesn't flake, and is cheap** |
| Failure it rewards-against | n/a | weak/masking tests | + brittle locators, coverage-theater, over-assertion/snapshot-bloat, defect-masking |

SWT-bench's own finding — test-prediction is *more* memorization-prone than patch-prediction because the
target test text is short, named after the issue, and co-located with the fix — is the central
contamination hazard here and is why the harvested tier is **calibration, not headline** (§8).

### 1.3 The five TAE task types (what the corpus must cover)

The corpus is not one task shape. Each case carries a `taskType` and the scoring rubric shifts per type:

| `taskType` | The agent is asked to… | Primary scored axis | Maps to FAILURE-MODES row |
|---|---|---|---|
| **author** | author an E2E test from an issue/requirement that the parent build violates | Correctness (fail→pass) + Sensitivity | "Manual case → automation translation"; "Oracle-rich tasks" |
| **extend** | extend an existing spec to cover a newly-described case/edge | Sensitivity (kill-rate on the new region) | "Breadth / edge-case enumeration"; "Coverage theater" |
| **repair** | fix a test broken by a behavior-preserving refactor (the refactor changed the DOM, not the behavior) | Robustness (does the repaired test re-anchor on stable handles?) | "Brittle locators / DOM over-fit" |
| **triage** | given a failing E2E run, decide *is this a real product defect or a flaky/obsolete test?* and classify | Correctness of the verdict (defect vs flake vs stale) | "Defect masking" (don't paper over a real bug); "Nondeterminism & flakiness" |
| **stabilize** | take a known-flaky spec and make it deterministic without weakening it | Stability (pass^k up) **and** Sensitivity unchanged (didn't mask) | "Nondeterminism & flakiness"; "Defect masking" |

`author` and `extend` are scored fully by the dual-run + mutation oracle (objective). `triage` and
`stabilize` need a small structured verdict + the no-masking guard. `repair` is scored on the refactor axis.

### 1.4 Two tiers: seeded HEADLINE + harvested CALIBRATION (the load-bearing decision)

Everything downstream depends on this split. It is **decided**, not open (it was the §11 decision the user
locked; the rationale is the SWT-bench memorization hazard in §1.2 / §8):

| | **Seeded tier (HEADLINE)** | **Harvested tier (CALIBRATION)** |
|---|---|---|
| Source | hand-authored private faults (extend `fixtures/todomvc` + new seeded fixtures) | real merged PRs from the §3 allowlist apps |
| Contamination | **zero** — bug + expected assertion never existed on GitHub | structural (golden test is public) → `headlineEligible: false` |
| Yield | **guaranteed** (we author exactly the cells we want) | **whatever the gate produces** (~28–55, §4.5) — no quota pressure |
| Who fills the coverage matrix (§2.3) | **the seeded corpus** (it owns the quota + the ≥60%-hard target) | a **realism overlay** — tagged into the same matrix, never required to fill a cell |
| Substrate | static / served builds (no Docker) | Dockerized app stacks (arm64) |
| Mutation execution | **in-loop, PR-affordable** (`page.route` on a warm served build) | **nightly only** (Docker cells too slow for PR, §6.2) |
| Gating | **YES** — `pass^k_qualified` + `cost_to_qualify` gate PRs (§6.5) | **NO** — report-only; it informs, never blocks |
| Role | the number we defend and regression-gate | realism check + contamination sanity (does the headline track reality?) |

**Consequence:** the harvest's brutal <1% yield (§4.5) is **no longer a blocker** — the headline never
depended on harvest volume. Harvest is a complement that buys realism; the seeded corpus buys
guaranteed, contamination-free, matrix-spanning, gateable signal. This dissolves the Cal.com-SSR
single-point-of-failure (a small *seeded* SSR fixture covers the headline SSR rubric; §2.3, §11) and the
app-promotion pressure (§11). The decided posture is cross-referenced wherever it bites: §2.3, §4.5, §6.2,
§6.5, §8, §10, §11.

---

## 2. Coverage axes & matrix

Two taxonomies are **first-class design axes**, not appendices. Every harvested case is tagged with both,
and the corpus is deliberately steered to span the hard cells (don't let it collapse into CRUD).

### 2.1 (A) Special-case taxonomy — the perturbation that probes each, and the FAILURE-MODES row it stresses

For each category: the **perturbation** is what the harvest injects/varies to make the case adversarial
(a mutant flavor, a refactor flavor, or an environmental toggle), and the **FAILURE-MODES row** is the
failure mode the resulting metric catches.

| # | Special-case category | Perturbation that probes it | FAILURE-MODES.md row(s) stressed |
|---|---|---|---|
| **SC1** | **Auth & session** (login, OAuth/SSO redirect, MFA/multi-step, concurrent-session/forced-logout, CAPTCHA) | token-refresh mutant (drop/expire token mid-flow); redirect-target mutant; session-fixation refactor (rename session cookie) | Deep-state/long-horizon bugs; Environmental coupling (BLOCKED vs FAIL); Negative-space security |
| **SC2** | **Scrolling / long pages** (deep+lazy-load, infinite-scroll dup/missing, sticky-header overlap, horizontal, virtual scrolling, scroll-memory on back) | lazy-load off-by-one mutant (skip/duplicate an item); virtual-window mutant (render wrong slice); DOM-restructure refactor (wrap the list) | Brittle locators / DOM over-fit; Deep-state/long-horizon; Visual/experiential correctness |
| **SC3** | **File operations** (single/multi upload, drag&drop, large/chunked, download interception, in-browser preview, throttled-network upload) | response-mutation (200→4xx on upload chunk, drop a field); throttled-network env toggle; download-content mutant | Error handling/edge; Environmental coupling; True non-functional behavior (mark out-of-scope, don't fake) |
| **SC4** | **Complex UI** (drag&drop reorder/kanban, rich-text Quill/TipTap/ProseMirror + paste-from-Word, date/time pickers + tz/locale, multi-select, canvas/WebGL, iframes/cross-origin, custom context menus) | reorder-index mutant (swap positions); editor-serialization mutant (drop a mark); **id/class rename refactor** (the canonical brittle-locator probe) | Brittle locators / DOM over-fit (heavy); Visual/experiential; No-oracle/ambiguous (canvas) |
| **SC5** | **Timing / state / async** (debounced inputs, WebSocket push, long-running jobs/polling, race/double-submit, optimistic UI + rollback, animation non-interactivity) | response-mutation via `page.routeWebSocket` (reorder/drop messages, force reconnect); double-submit mutant (allow 2nd submit); rollback mutant (don't revert optimistic state) | Nondeterminism & flakiness (`pass^k`, no-sleep); Deep-state/long-horizon; Defect masking (optimistic rollback) |
| **SC6** | **Responsive / cross-env** (breakpoints, touch gestures, high-DPI, browser zoom, print view) | breakpoint mutant (break a media query); viewport env toggle (mobile/desktop projects) | Visual/experiential correctness; Environmental coupling |
| **SC7** | **Error handling / edge** (network failure mid-action, 4xx/5xx surfacing, empty states, extreme-length/unicode/RTL/emoji/zero-width, back/forward SPA routing, tab-close mid-flow / unsaved data) | network-failure injection (`page.route` abort); 5xx surfacing mutant (swallow the error → silent success); extreme-input mutant | Error handling/edge; Defect masking (✗✗ swallowed errors); Hallucinated findings (precision) |

### 2.2 (B) Architecture axis — detection signal(s) and per-architecture testing focus

Each app/case is tagged by web architecture, because the testing focus and the agent's *detection burden*
differ. The harvest auto-detects the architecture from the live `v-fix` build (§4.6); the per-architecture
focus shifts the rubric (§6.7).

| Arch | Detection signal(s) (auto-probed at harvest) | Per-architecture testing focus (rubric weight added) | FAILURE-MODES row(s) |
|---|---|---|---|
| **MPA** | full HTML doc per nav; no `<div id="root">`; `Content-Type: text/html` per route | per-page assertions; form POST round-trips; no client-router deep-link assumptions | Brittle locators; Environmental coupling |
| **SPA** | `<div id="root">`/`<app-root>`; XHR/fetch after first paint; client-side route changes w/o full reload | client routing & **deep-link reload**; **token-refresh**; bundle-load failure; empty-state on cold cache | Deep-state/long-horizon; Brittle locators; Nondeterminism |
| **SSR** | `__NEXT_DATA__`, `window.__NUXT__`, server-rendered first paint then hydrate; `x-powered-by: Next.js` | **hydration errors**; first-paint accuracy vs hydrated state; SEO meta presence; no flash-of-wrong-content | Visual/experiential; Nondeterminism (hydration races) |
| **SSG** | static HTML at build time; long `cache-control`; `x-vercel-cache`/`cf-cache-status: HIT` | **stale-cache** vs runtime data; build-vs-runtime divergence; 404 on un-built route | Environmental coupling; Regression-vs-baseline |
| **ISR** | `x-vercel-cache: STALE→HIT` revalidation; `cache-control: s-maxage,stale-while-revalidate` | revalidation correctness (stale then fresh); first-request-after-expiry | Environmental coupling; Deep-state |
| **PWA** | service-worker registration; manifest.json; cache API; offline capability | **offline / cache-staleness**; install prompt; push; update-on-reload | Environmental coupling; Error handling/edge |
| **micro-frontend** | multiple bundles/`window` globals; module-federation `__webpack_share_scopes__`; iframe islands | **cross-module nav**; **shared-state** consistency; iframe isolation | Deep-state/long-horizon; Brittle locators (cross-frame) |
| **REST-backed** | JSON over `/api/*`; REST verbs; resource URLs | request/response contract; status surfacing; pagination | Oracle-rich (contract); Error handling/edge |
| **GraphQL** | single `/graphql` POST endpoint; `{query,variables}` body; `application/graphql-response+json` | **query/mutation contract**; subscription reconnect; **error-payload** surfacing (200-with-errors) | Oracle-rich; Defect masking (200-with-errors swallowed) |
| **WebSocket/real-time** | `Upgrade: websocket`/`wss://`; Socket.IO/DDP handshake; SSE `text/event-stream` | **reconnect-on-drop**; **message ordering**; concurrent-user consistency | Nondeterminism (race/ordering); Deep-state |
| **JAMstack** | static prebuilt + API calls to 3rd-party; CDN headers; no app server for HTML | build-vs-runtime data; CDN/cache; client-side auth | Environmental coupling; SSG focuses |

### 2.3 Coverage matrix (special-case × architecture) and target distribution

Which app can plausibly fill which cell (from the dossiers). `●` = strong/natural source, `○` = possible
with curation, blank = no chosen-app source (gap). Apps are the chosen four (§3): **Doc** = Documenso,
**n8n** = n8n, **RC** = Rocket.Chat, **Cal** = Cal.com/cal.diy.

| | MPA | SPA | SSR | SSG | ISR | PWA | micro-FE | REST | GraphQL | WS/real-time |
|---|---|---|---|---|---|---|---|---|---|---|
| **SC1 Auth & session** | | ● Doc/n8n/Cal | ● Cal | | | | | ● Doc | ○ RC | ● RC |
| **SC2 Scroll/long-page** | | ● n8n/RC | ○ Cal | | | | | ● RC | | ● RC |
| **SC3 File ops** | | ● Doc(PDF)/n8n | | | | | | ● Doc | | |
| **SC4 Complex UI** | | ● n8n(canvas)/RC(editor)/Cal(pickers) | | | | | | ● n8n | ○ RC | ● n8n |
| **SC5 Timing/async** | | ● n8n/Cal | ○ Cal | | | | | ● Cal | ○ RC | ● RC(DDP)/n8n |
| **SC6 Responsive** | | ○ Cal/RC | ○ Cal | | | | | ○ Cal | | |
| **SC7 Error/edge** | | ● Doc/n8n/RC | ○ Cal | | | | | ● Doc/RC | ○ RC | ● RC |

> **Who owns this matrix (per §1.4):** the cell sources shown above (`●`/`○` against the four apps) are the
> **harvested calibration overlay** — they tell us which realism the corpus *can* sample. The **coverage
> quota and ≥60%-hard target below are obligations on the SEEDED headline corpus**, which we **author
> exactly to spec** (guaranteed yield, contamination-free). Harvest then lands wherever the gate produces
> cases and is tagged into the same matrix as a realism check — it is **never required to fill a cell**. A
> matrix cell with only a harvested `●`/`○` and no seeded fixture is **calibration-only, not headline**.

**Deliberate target distribution** (so the corpus spans hard cells, not CRUD). This is the **seeded
headline batch** spec — **~30 seeded cases authored to the mix below** (yield is guaranteed because we
author them; the harvested overlay adds whatever the §4.5 lanes yield on top). The two constraints — the
`taskType` quota **and** the ≥60%-hard-category target — are jointly satisfied by the worked 30-case
allocation at the end of this section.

- **≥ 60% from SC4/SC5/SC7 + SC1** (the hard, agent-defeating categories: complex UI, async/timing,
  error/edge, auth). These are where brittle-locator and defect-masking failures live.
- **≤ 20% trivial CRUD** (`author` happy-path on a simple form) — kept only as low-noise calibration anchors.
- **Architecture spread:** every case is SPA-or-richer. The **seeded** corpus authors the rubric-firing
  architectures directly: a small **seeded WS/real-time** fixture (so the §6.7 reconnect/ordering rubric
  fires without depending on a Docker app) and a small **seeded SSR fixture** (so the SSR hydration rubric
  has a headline source — removing the Cal.com single-point-of-failure; §1.4, §11). The **harvested** overlay
  then samples the *real* versions (Rocket.Chat DDP, n8n executions; Cal.com Next.js SSR) for realism/calibration.
- **GraphQL / SSG / ISR / PWA / micro-FE remain gaps** in *both* tiers for now: no chosen app is a clean
  harvest source (RC's GraphQL is non-primary `○`; Twenty is deferred, §3.2), and we have **not** yet
  authored seeded fixtures for them. They are cheaply addable later as **seeded fixtures** (a seeded GraphQL
  surface; an Astro/Eleventy seed for SSG/ISR; a module-federation seed for micro-FE) **without** needing a
  qualifying real-repo app (§11). Until authored, the §6.7 rubrics for these **do not fire** — declared gap,
  not silent zero.
- **`taskType` spread** (single-batch minimums for the **seeded** batch): ≥ 8 `author`, ≥ 4 `extend`,
  ≥ 4 `repair` (hand-authored `v-refactor` family, §5/§6.3), ≥ 3 `triage`, ≥ 3 `stabilize`. These sum to
  **22**, leaving slack inside a 30-case batch. Harvested `repair`/`triage`/`stabilize` (Lanes B/C, §4.3b/c)
  add realism on top but are **not** counted toward these headline minima.

**Worked 30-case seeded-headline allocation** (one concrete batch satisfying *both* the taskType quota and ≥60% hard):

| taskType | count | SC mix (hard = SC1/SC4/SC5/SC7) | of which hard |
|---|---|---|---|
| `author` | 9 | 2×SC3(1 CRUD anchor)+1×SC7+2×SC1+2×SC5+2×SC4 | 6 |
| `extend` | 5 | 1×SC2+1×SC7+1×SC4+1×SC5+1×SC1 | 4 |
| `repair` | 5 | 3×SC4+1×SC5+1×SC7 (brittle-locator-rich) | 5 |
| `triage` | 5 | 2×SC5+1×SC7+1×SC1+1×SC3 | 4 |
| `stabilize` | 6 | 3×SC5+2×SC1+1×SC7 | 6 |
| **total** | **30** | | **25 / 30 = 83% hard** |

CRUD anchors are capped at the single `author` SC3 happy-path (1/30 ≈ 3% ≤ 20%); the hard-category share is
**25/30 = 83% ≥ 60%**; every `taskType` minimum is met. Because these are **authored**, the allocation has
no yield risk (contrast the harvested overlay's ~28–55 *uncertain* yield, §4.5). The §10 roadmap builds this
seeded corpus first (**Crawl/Walk**), with the harvested overlay layered in from **Walk** onward.

**Gaps and how the two tiers cover them (declare them, don't fake them):**
- **SSR — covered for the HEADLINE by a seeded fixture; Cal.com is calibration-only.** The headline SSR
  hydration rubric (§6.7) fires on a **small seeded Next.js SSR fixture** we author (clean, pinned,
  arm64-safe) — so it has **no** dependency on the fragile Cal.com harvest. Cal.com's real SSR cases are a
  **harvested realism overlay** (calibration); if cal.diy yields 0 SSR-path cases, the *calibration* SSR
  signal is simply absent — the **headline SSR rubric still fires on the seed**. This **dissolves the former
  single-point-of-failure** (§1.4, §11). Cross-referenced at §6.7 and §11.
- **WS / real-time — covered for the HEADLINE by a seeded fixture.** A small **seeded WS fixture** fires the
  §6.7 reconnect/ordering rubric on the headline tier; Rocket.Chat (DDP) and n8n (executions) provide the
  harvested realism overlay.
- **GraphQL, SSG, ISR, PWA, JAMstack, MPA, micro-frontend — declared gaps in BOTH tiers (for now).** No
  chosen app is a clean *harvest* source (RC's GraphQL is non-primary `○`; Twenty deferred, §3.2), **and** we
  have not yet authored *seeded* fixtures for them. They are cheaply addable later as **seeded fixtures** (a
  seeded GraphQL surface; an Astro/Eleventy seed for SSG/ISR; a module-federation seed for micro-FE) **without**
  promoting a real-repo app (§11). Until authored, the §6.7 rubrics for these **do not fire** — the benchmark
  **cannot claim** SSG-stale-cache, ISR-revalidation, PWA-offline, GraphQL-contract, or micro-FE coverage;
  the §10 roadmap defers them explicitly.
- **CAPTCHA (SC1)** and **canvas/WebGL visual-only (SC4)** are inherently un-oracle-able by a deterministic
  E2E assertion (CAPTCHA is adversarial by design; canvas has no DOM). Tag-and-defer: these become `triage`
  cases ("is this even automatable?") or are marked out-of-scope per the "True non-functional / No-oracle"
  FAILURE-MODES rows, not scored as `author`.

---

## 3. Vetted app shortlist

### 3.1 All candidates (full vetting table)

| App | Tier | Stack | **Architecture** | #svc | arm64 | E2E (framework / in-repo) | License | Qualifying-PR est. | **Special-cases naturally exercised** | Key gotcha |
|---|---|---|---|---|---|---|---|---|---|---|
| **Documenso** | **use** | React/React-Router (Remix) + tRPC + Prisma/PG | SPA (Remix SSR-capable) · REST-backed (tRPC) | 2 prod / 4 dev | **native multi-arch** | Playwright, in-repo (`packages/app-tests/e2e`) | AGPL-3.0 (EE coupling) | **many** (bot `🚨 e2e changes 🚨` label flags 135 PRs) | SC3 (PDF upload/preview/sign), SC1 (session/password-reset), SC7 (4xx/5xx surfacing) | documented E2E flakiness (#2227); EE folder must stay for builds |
| **n8n** | **maybe→use** | Vue 3 + Pinia (editor-ui) + Node/TS; SQLite default | SPA (Vue canvas) · REST-backed · WS (executions) | 1–2 (SQLite) | **native multi-arch** | Playwright, in-repo (`packages/testing/playwright`, incl. `regression/`) | Sustainable-Use (fair-code) | **few** but real (PR 18857 = source+spec) | SC4 (node-graph canvas, DnD), SC5 (executions/polling), SC3 (workflow import), SC7 | bug refs are **private Linear** tickets; Cypress→PW migration Oct 2025 (pin post-migration) |
| **Rocket.Chat** | **maybe→use** | React/TS (+ legacy Meteor/Blaze) on Meteor/Node; MongoDB replica set; DDP/WS | SPA · WebSocket/real-time (DDP) · REST · ○GraphQL | 2 minimal | **native multi-arch** | Playwright, in-repo (`apps/meteor/tests/e2e`, 90+ specs) | MIT (CE; avoid `ee/`) | **some** (~11% of recent fix PRs pair source+e2e; 417 type:bug PRs) | SC5 (real-time message push/ordering), SC1 (SAML/SSO, concurrent session), SC2 (msg list scroll), SC7 | needs **Mongo replica set** (oplog); issue links via plain `#`-refs not `closes`, backport bundles |
| **Cal.com / cal.diy** | **maybe** | Next.js (React) + tRPC + Prisma/PG + Redis | **SSR** (Next.js) · SPA-routing · REST-backed | 5 (trim to web+pg) | native but **`-arm` suffix only** (not multi-arch manifest) | Playwright, in-repo (`apps/web/playwright`) | MIT (post-rebrand cal.diy) | **some** (verified gold PR #19257) | SC1 (OAuth/booking auth, MFA), SC4 (date/time pickers + tz/locale), SC5 (booking race/double-submit), SC6 (tz) | **must pull `-arm` tag explicitly** (defaults to emulated amd64); weak compose pinning; closed-source pivot, harvest from cal.diy history |
| **Twenty (CRM)** | maybe | React/Recoil + NestJS GraphQL; PG16/Redis | SPA · **GraphQL** | 4 | native multi-arch | Playwright, in-repo (`packages/twenty-e2e-testing`, ~7 specs) | AGPL-3.0 + EE | **few** (0 merged `type:bug` PRs; manual archaeology) | SC4 (kanban DnD, data-grid), GraphQL contracts | label-driven harvest **fails**; tiny suite; high effort/low yield |
| **Ghost** | maybe | Ember admin + React apps + Node/Bookshelf; MySQL8 | SPA (Ember+React) · SSR-ish themes | 4–6 | native (Docker Official) | Playwright, in-repo (`e2e/`, **post-migration ≤1yr**) | MIT | **few** (legacy PW suite removed Apr 2026 #27038; team prefers Ember accept. tests) | SC4 (Koenig/Lexical editor), SC1, SC7 | golden tests from old PRs point to **deleted** path; heavy Tinybird/MySQL/Redis stack |
| **Mattermost** | maybe | React/TS + Go; PostgreSQL | SPA · REST · ○WS | 2–6 | **community arm64 only** (issue #23387 open) | Cypress **and** Playwright, in-repo (`e2e-tests/`) | AGPL/MIT/Apache | **some** (source+e2e plentiful) | SC5 (real-time), SC1, SC2 | **arm64 HIGH risk** (x86 emulation breaks pinned-native repro); bugs in **Jira** not GitHub; big refactor PRs |
| **Plane** | **reject** | React/Next-ish + Django/Celery; PG/Redis/RabbitMQ/MinIO | SPA · REST | 13 | native multi-arch | **none** (pytest API only; no Playwright/Cypress) | AGPL-3.0 | **none** (structural) | — | **no in-repo browser E2E** — disqualifier; 13-service stack |
| **Medusa** | **reject** | Node/TS (Express) + admin React; PG/Redis | SPA admin · REST | 3 (self-built) | **community** (no official image) | **none in-repo** (Jest API; Playwright only in *separate, deprecated* storefront repos) | MIT | **none** (E2E not co-located with source) | — | E2E split across repos → source+E2E can never co-change; no official Docker |
| **Outline** | **reject** | React/MobX/ProseMirror SPA + Koa/Sequelize; PG/Redis/S3 | SPA | ~4 | native multi-arch | **none** (Vitest only) | BUSL-1.1 | **none** (structural) | — | **no in-repo E2E** — disqualifier; BSL source-available |

### 3.2 The chosen four (and why)

Selection criteria: low service-count, **native arm64**, **in-repo Playwright/Cypress**, healthy
qualifying-PR population, permissive-enough license for *private* fixture use, AND **complementary matrix
coverage** so the corpus spans hard cells.

1. **Documenso — primary `use` app.** The only turnkey `use`-tier candidate: native multi-arch arm64, lean
   2-service prod stack (app + `postgres:15`, auto-migrate + `prisma:seed`), in-repo Playwright, and the
   single best harvest signal in the field — the bot-applied **`🚨 e2e changes 🚨`** label that auto-flags
   every PR touching `packages/app-tests` (135 merged, ~40 begin with `fix`). Verified gold case PR #2597
   (one source file + a new `pdf-viewer.spec.ts` regression test, clean 500→302). **Fills SC3** (PDF
   upload/preview/sign — a genuinely hard special case rare in other apps) and SC1/SC7. Caveats adopted:
   budget for documented flakiness (#2227 → quarantine, §6.4); keep `packages/ee/` in place for builds,
   never redistribute.

2. **n8n — complex-UI + async anchor.** Native multi-arch, single-container SQLite self-host (lowest run
   cost of the set), mature in-repo Playwright incl. a `regression/` folder of bug-driven specs. **Fills
   SC4** (the Vue node-graph **canvas**, drag-and-drop, connections — the hardest "complex UI" surface in
   the corpus) and SC5. Caveats adopted: pairing is rare and bug refs are **private Linear tickets** — so
   **relax the public-bug-issue requirement** for n8n and accept `regression/`-folder + UI-spec cases
   (§4.2); pin to a **post-Cypress-migration** commit (cypress removed Oct 2025) so the matching framework
   exists at the ref.

3. **Rocket.Chat — real-time / WebSocket anchor.** Native multi-arch, large in-repo Playwright suite (90+
   specs), MIT CE. **Fills SC5/WS** (DDP/WebSocket message push, ordering, reconnect, concurrent users —
   no other chosen app has a first-class real-time surface) and SC1 (SAML/SSO, concurrent-session/forced-
   logout). Caveats adopted: **relax issue-linkage** to `type:bug` label + `#`-references/timeline cross-
   references (they almost never use `closes #`); prefer the **original develop fix PR** over `imported
   fixes` backport bundles; strip the compose to **app + Mongo replica-set** only; avoid `ee/` paths.

4. **Cal.com / cal.diy — SSR + locale/tz calibration realism (curated subset only).** The only **SSR
   (Next.js)** app in the set, so it is the source of the **calibration** SSR realism overlay (§6.7) and of
   **SC4 date/time pickers + tz/locale** and SC5 booking races. The **headline** SSR-hydration rubric fires
   on a *seeded* Next.js fixture (§2.3, §11 risk 5), so Cal.com is **no longer the only SSR source** and no
   cell depends on it. MIT post-rebrand. Kept despite `maybe` tier for its SSR + tz **realism**, not because
   any cell requires it. Caveats adopted honestly: arm64 ships **only as `-arm`-suffixed tags** (not a
   multi-arch manifest) so the harvest **must explicitly pull `…-arm`** and assert the image arch (§7);
   compose pinning is weak → hard-pin `postgres` and the app tag ourselves; harvest from the preserved
   **cal.diy** git history (AGPL-era PRs), never the now-private cal.com. **Use as a curated handful, not a
   turnkey source.**

**Explicit rejections** (so the corpus doesn't waste harvest budget on them):
- **Plane, Outline** — *no in-repo browser E2E suite at all* (pytest / Vitest only). The qualifying-PR
  population is **structurally zero**; everything else (arm64, license) is moot.
- **Medusa** — in-repo tests are Jest **API** tests; Playwright lives in *separate, deprecated, frontend-
  only* storefront repos, so a fix PR can **never** co-change app source + an in-repo browser E2E. Plus no
  official Docker image (community arm64 only).
- **Mattermost** — *deferred, not chosen*: strong E2E (Cypress+Playwright) but **arm64 is community-only**
  (maintainer-confirmed, #23387 open) → pinned-native-arm64 reproducibility breaks on Apple Silicon; bugs
  live in **Jira**; qualifying PRs skew to huge accessibility/refactor diffs. Revisit only if x86-emulation
  is accepted or an official arm64 image lands.
- **Twenty, Ghost** — *deferred*: both `maybe` with **low expected yield** (Twenty: 0 merged `type:bug`
  PRs, ~7 specs; Ghost: legacy PW suite deleted Apr 2026, team prefers Ember tests). Useful later as
  GraphQL (Twenty) / rich-editor (Ghost Koenig) fillers if the chosen four under-deliver on those cells.

---

## 4. Harvest pipeline

The critic's hardest correction: **this is not "search GitHub" — GitHub search cannot express "diff
touches path X AND path Y", caps at 1000 results, and only indexes default-branch HEAD.** It is a
**per-repo full-history crawl** over the curated allowlist (§3), with `closingIssuesReferences` as the only
reliable PR↔issue join. Expect to **over-provision repos** (per-repo yield is single digits) and to
**human-review every survivor**.

Tooling lives under `eval/harvest/` (carries deps; not in the stdlib test path — same rule as `driver/`):

```
eval/harvest/
  crawl.mjs            # GraphQL: page ALL merged PRs per repo; read closingIssuesReferences + files
  filter.mjs           # static metadata gate (paths, lockfile, code_patch non-empty, recency, e2e-content)
  classify-pr.mjs      # ROUTE each PR to a taskType lane (author/extend ↔ red→green; repair; stabilize/triage)
  split.mjs            # split each PR diff into test_patch (e2e paths) vs code_patch (everything else)
  gate.mjs             # red→green inclusion gate (test_patch materialize → RED → +code_patch → GREEN → PASS_TO_PASS)
  mine-flaky.mjs       # flaky-fix miner: PRs that ONLY touch e2e (test.skip/timing tweaks) → stabilize/triage seeds
  mine-refactor.mjs    # refactor-driven test-fix miner: behavior-preserving change broke + re-anchored a test → repair seeds
  tag.mjs              # auto-tag specialCases[] + architecture from issue text + live build probe
  determinism.mjs      # N-rep stability; quarantine flaky survivors
  emit-case.mjs        # write the case manifest (case.yaml, §5) + per-case parent image snapshot
  allowlist.json       # the curated repos + per-repo relaxation flags (issue-link strictness, ee/ excludes)
```

**The pipeline has three task-type lanes, not one.** The red→green gate (§4.3) is, by construction, only an
`author`/`extend` source: it emits a fail→pass spec + PASS_TO_PASS neighbors. It cannot yield `repair`,
`triage`, or `stabilize`. So `classify-pr.mjs` (a routing step after `filter.mjs`) sorts each surviving PR
into one of three lanes, and the §4.2 step-6 / §4.1 cal.com filters become **routers, not unconditional
rejects** — they redirect the flaky/selector-churn material to the lanes that consume it instead of dropping
it on the floor:

- **Lane A — `author`/`extend`** (§4.3 red→green gate): a real app fix that paired with a fail→pass E2E.
- **Lane B — `repair`** (`mine-refactor.mjs`, §4.3b): a **behavior-preserving** change (rename/restructure,
  empty or near-empty behavioral `code_patch`) that **broke and re-anchored an existing test** (the test
  diff changes selectors/locators, not assertions about behavior). These are the PRs the old "selector-rename
  churn" reject would have discarded; they are now the repair seed.
- **Lane C — `stabilize`/`triage`** (`mine-flaky.mjs`, §4.3c): a PR that **only touches e2e** with
  `test.skip()` / `waitForTimeout` / retry-count / `expect(...).toPass()` timing tweaks (no source change).
  These are the PRs §4.2 step 6 and §4.1's cal.com rule used to reject outright; they are now the
  stabilize/triage seed.

### 4.1 The crawl query (per repo, not a global search)

There is no `gh search` that works. Page every merged PR via GraphQL and join the issue client-side:

```bash
# eval/harvest/crawl.mjs uses this GraphQL shape per repo (paged 100 at a time):
gh api graphql -f query='
query($owner:String!, $name:String!, $cursor:String) {
  repository(owner:$owner, name:$name) {
    pullRequests(states:MERGED, first:100, after:$cursor,
                 orderBy:{field:UPDATED_AT, direction:DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title mergedAt baseRefOid headRefOid
        files(first:200) { nodes { path additions deletions } }
        closingIssuesReferences(first:10) {
          nodes { number title labels(first:20){nodes{name}} url }
        }
      }
    }
  }
}' -f owner=documenso -f name=documenso --paginate
```

Per-repo relaxation (from the dossiers) lives in `allowlist.json`:
- **Documenso:** strict — join on the **issue's** `type: bug` label (PRs rarely carry it); the
  `🚨 e2e changes 🚨` label is a free pre-filter for "touched `packages/app-tests`".
- **Rocket.Chat:** relaxed link — accept `type:bug` label + plain `#`-reference / timeline cross-reference
  (`closingIssuesReferences` will be sparse); prefer original develop PRs over `imported fixes` bundles.
- **n8n:** relaxed issue requirement — accept `regression/`-folder specs and private-ticket refs
  (`SUG-/ADO-/CAT-`) as the "bug anchor"; the issue link is recorded as `private-ticket`, flagged
  contamination-neutral.
- **Cal.com:** target `calcom/cal.diy` history. Flaky-fix PRs that touch **only** e2e with
  `test.skip()`/timing tweaks are **not rejected for the red→green lane outright** — they are **routed to the
  `stabilize`/`triage` lane** (`mine-flaky.mjs`, §4.3c). They are excluded only from the `author`/`extend`
  red→green gate (which needs a real `code_patch`), not from the corpus.

### 4.2 PR inclusion filter (`filter.mjs` + `split.mjs`) — cheapest gates first

Order by cost so static filters reject ~90% **for free**, before any build or stack bringup:

1. **Diff-path intersection:** PR `files` must contain **≥1 E2E path** (`**/e2e/**`, `**/playwright/**`,
   `*.spec.ts`, `*.cy.ts` per the repo's layout) **AND ≥1 non-test source path**. (Computed client-side
   from the file list — search can't do this.)
2. **`code_patch` non-empty outside test/snapshot paths** — else it's a **test-only PR** (red→green driven
   by the test change, not an app fix). A test-only PR is **ill-posed for the `author`/`extend` red→green
   gate** and is **dropped from Lane A**, but it is **not deleted**: `classify-pr.mjs` **routes** it to
   `mine-flaky.mjs` (Lane C, `stabilize`/`triage`) if the e2e-only diff is `test.skip()`/timing/retry churn.
   *(Recommended change adopted — but as a *router*, not an unconditional drop.)*
3. **Content-based E2E classification:** the matched "e2e" file must actually **navigate the app** —
   contains `page.goto`/`cy.visit`/`baseURL`. **Reject** Playwright **component tests**, snapshot files,
   and unit-tests-living-in-an-`e2e/`-folder. *(Adopted.)*
4. **Lockfile present at the parent commit** (`package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`) → enables
   `npm ci`/`--frozen-lockfile`. **No lockfile at parent → drop** before any compute. *(Adopted, controls
   buildability decay.)*
5. **Recency:** parent `< ~6 months` old at capture — both builds-more-reliably AND satisfies the
   contamination window (§8). Older cases go to a `contamination-suspect` secondary line, never headline.
6. **Issue↔assertion relevance:** cheap keyword join (issue title/body ↔ the assertion text in
   `test_patch`); low-confidence pairs flagged for human review. Bundled **flaky-stabilization** and
   **selector-rename churn** are **rejected from Lane A** (they aren't a real fix→test pair), but `classify-
   pr.mjs` **routes** them rather than discarding: flaky-stabilization churn → `mine-flaky.mjs` (Lane C,
   `stabilize`/`triage`), selector-rename churn → `mine-refactor.mjs` (Lane B, `repair`). *(Adopted — as a
   router from Lane A into Lanes B/C, not an unconditional reject.)*

`split.mjs` splits the unified PR diff into:
- **`test_patch`** = hunks touching E2E/test paths (the golden test the agent must *re-derive*, never copy).
- **`code_patch`** = everything else (the fix; defines what `v-fix` is).

### 4.3 The red→green inclusion gate (`gate.mjs`) — the SWT-bench contract, never "run the test at parent"

The single biggest correctness bug the critic flags: **the golden test usually does not exist at the
parent commit** (it's added in the same PR). "Check out parent, run the changed test" returns *no tests
found* and silently discards the best cases. Use the SWT-bench mechanism:

```
GATE(case):
  build_parent  = checkout(parentSha)            # this is v-bug
  build_fix     = checkout(mergeSha)             # this is v-fix
  # 1. MATERIALIZE the test on the parent (it isn't there yet):
  apply(test_patch, onto=build_parent)
  # 2. RED: targeted spec must FAIL on parent — and FAIL for the RIGHT reason:
  red = run_spec(build_parent, target_spec, --reporter=json)
  require red.status == "failed" AND red.failureKind == "assertion"   # not compile/import/setup error
  # 3. GREEN: apply the fix too → must PASS:
  apply(code_patch, onto=build_parent)            # == build_fix behavior
  green = run_spec(build_parent_plus_code, target_spec)
  require green.status == "passed"
  # 4. PASS_TO_PASS: the rest of the relevant E2E suite still passes on v-fix (no collateral break):
  require run_suite(build_fix, neighbors_of(target_spec)).allPassed
  emit FAIL_TO_PASS = [target_spec], PASS_TO_PASS = neighbors
```

**Failure modes handled explicitly:**

| Failure mode | Handling |
|---|---|
| **Test added, not failing at parent** (file absent) | apply `test_patch` onto parent **first** to materialize it; only then run → real RED. |
| **RED for the wrong reason** (compile/import/env break, not the bug) | parse runner JSON; require `failureKind == "assertion"`, else drop. *(Adopted.)* |
| **Parent won't build** (floating deps, yanked pkg, Node drift) | require committed lockfile + `npm ci`/frozen install; pin Node via `.nvmrc`/`engines`; drop on build failure **before** stack bringup; snapshot a working parent image once per case for reuse. |
| **E2E added in a SEPARATE follow-up PR** (fix PR has no test) | not capturable as a single triple → dropped at filter step 1. Recorded as a known false-negative class (biases toward E2E-in-PR-disciplined repos — acknowledged in §11). |
| **Test-only PR** (no real app fix) | filter step 2 drops it **from Lane A** and `classify-pr.mjs` **routes** it to Lane C (`mine-flaky.mjs`, §4.3c) if it's `test.skip()`/timing churn. |
| **Bundled flaky-fix / selector-rename** unrelated to the issue | filter step 6 + human review drop it **from Lane A**; `classify-pr.mjs` routes flaky-fix → Lane C (§4.3c) and selector-rename → Lane B (§4.3b, `mine-refactor.mjs`). |

**Cheap-fail-first pipeline** (controls the dominant cost line — the critic's ~1800-stack-starts warning):
(a) static filters (§4.2) reject ~90% free → (b) `install + build only` rejects buildability before any
stack → (c) only survivors reach the **full Docker stack + red→green + N-rep determinism**, each reusing a
**per-case snapshotted parent image** (build once; reused for the merge probe, the N reps, and later agent
runs). Turns ~1800 stack-starts into a few dozen.

### 4.3b The repair lane (`mine-refactor.mjs`) — harvested `repair` cases

Source: PRs `classify-pr.mjs` routes here (behavior-preserving change that broke + re-anchored an existing
test; selector-rename churn from §4.2 step 6). The signal is a `code_patch` that is **behavior-preserving**
(rename/move/restructure with no assertion-level behavior change) **paired with a `test_patch` that only
re-anchors locators** (selector/`data-testid`/`getByRole` changes, assertions unchanged). The lane gate:

```
REPAIR_GATE(case):
  build_parent = checkout(parentSha)              # test PASSES here (pre-refactor selectors)
  build_fix    = checkout(mergeSha)
  # 1. The pre-PR test BREAKS on the refactored build for a LOCATOR reason, not a behavior reason:
  broken = run_spec(build_fix_minus_testpatch, target_spec, --reporter=json)
  require broken.status == "failed" AND broken.failureKind in {"locator","timeout-on-locator"}  # not assertion
  # 2. Behavior-equivalence proof (same gate as §6.3): oracle value + a11y-tree + tab-order
  #    diff between parent and fix is EMPTY → the change really was behavior-preserving.
  require behavioralEquivalent(build_parent, build_fix) == true
  # 3. The PR's own test_patch re-anchors and PASSES on the fix (the "known-good repair").
  require run_spec(build_fix, target_spec).status == "passed"
  emit taskType=repair, brokenSpec=target_spec, goldenRepair=test_patch (never shown to agent)
```

The agent is handed the **pre-refactor (broken-on-fix) spec** plus the refactored build, and must re-anchor
it on stable handles (scored on the §6.3 robustness axis). PRs failing step 1 with `failureKind ==
"assertion"` are **not** behavior-preserving (real behavior changed) → they fall back to Lane A or are
dropped. This lane reuses the **same behavioral-equivalence gate** as the hand-authored `v-refactor`
fixtures (§6.3), so harvested-repair and constructed-repair share one validity definition.

### 4.3c The stabilize/triage lane (`mine-flaky.mjs`) — harvested `stabilize` and `triage` cases

Source: PRs `classify-pr.mjs` routes here — **e2e-only** diffs whose `test_patch` adds `test.skip()` /
`waitForTimeout` / retry-count / `expect(...).toPass({timeout})` / `test.fixme` (no `code_patch`). The lane
gate confirms the spec is **actually flaky** (not just touched) and reconstructs a pre-stabilization build:

```
STABILIZE_GATE(case):
  build = checkout(parentSha_of_flaky_PR)          # the flaky spec as it was BEFORE the stabilization PR
  # 1. Demonstrate flake: run the pre-stabilization spec N=10 and require a MIXED outcome
  #    (not all-pass, not all-fail) → it genuinely flakes.
  reps = run_spec_xN(build, flaky_spec, N=10)
  require 0 < count(reps == "passed") < 10          # mixed ⇒ flaky-by-evidence
  # 2. The PR's stabilization test_patch (the human's deterministic version) must run STABLE (10/10).
  require run_spec_xN(checkout(mergeSha), stabilized_spec, N=10).allSame == true
  emit:
    taskType=stabilize  → agent gets the flaky spec, must make it deterministic WITHOUT masking (§6.4/§6.5)
    taskType=triage     → agent gets ONE captured failing run, must classify defect | flake | stale (§1.3)
```

`stabilize` is scored on Stability (`pass^k` up) with the no-masking guard unchanged (§6.5); `triage` is
scored on **verdict correctness** via the new `rubrics/triage.json` LLM-judge (§9). The human's
stabilization patch is the calibration answer key, never shown to the agent. PRs that fail step 1 (the spec
is not actually flaky — it was a one-off skip) are dropped.

**Lane yield is separate from the red→green yield** and is accounted for separately in §4.5 — these lanes do
not pass through `gate.mjs`'s FAIL_TO_PASS contract.

### 4.4 Determinism re-run / drop policy (`determinism.mjs`)

E2E is the flakiest test class; a green-3/3 at harvest may still flake under the agent's environment, so
**run the gate in the SAME pinned container the agent will use** (so stability transfers). Policy
(consistent with the platform critic's N=5 rule):

- Run the gate **N=5** times at parent+code_patch (RED→GREEN) and on `v-fix` (PASS_TO_PASS).
- A case is **STABLE** only if it produces the identical outcome classification in **≥4/5** runs.
- **2+ deviations → QUARANTINE** (excluded from the scored set, **flagged as a finding, not silently
  dropped**) so we can measure how much E2E flake is costing the corpus.

### 4.5 Scan-to-yield estimate (realistic, from the critic)

Per the harvest critic: **well under 1% of bug-fix PRs** satisfy the full conjunction; expect **~5–15% of
buildable + E2E-bearing candidates** to survive the full gate, **~3–8 usable cases per disciplined repo**.

The yield is reported **per lane** (§4.3 / §4.3b / §4.3c), because the three lanes have different sources and
different gates — collapsing them hid the fact that the red→green gate alone can never produce
`repair`/`triage`/`stabilize`.

**Lane A — `author`/`extend`** (red→green gate, §4.3):

| Stage | Documenso | Rocket.Chat | n8n | cal.diy | Notes |
|---|---|---|---|---|---|
| merged PRs crawled | full history | full history | full history | cal.diy history | per-repo, paged |
| pass static filter (e2e∩source, lockfile, recency, code_patch) | ~135 (e2e-label) → ~40 `fix` | ~80 scanned → ~9 paired | ~40 fix → ~0–2 paired | dozens → handful | §4.2 |
| survive red→green + assertion-RED | ~15–25 | ~6–9 | ~2–4 | ~3–6 | §4.3 |
| survive determinism (≥4/5) | ~10–18 | ~5–8 | ~2–3 | ~2–5 | §4.4 |
| **human-approved → Lane A** | **~8–14** | **~4–7** | **~2–4** | **~2–5** | **author/extend: ~16–30** |

**Lane B — `repair`** (`mine-refactor.mjs`, §4.3b — selector-rename / behavior-preserving-churn PRs that
Lane A routes here):

| Stage | Documenso | Rocket.Chat | n8n | cal.diy | Notes |
|---|---|---|---|---|---|
| routed selector-rename / behavior-preserving PRs | ~10–20 | ~8–15 | ~3–6 | ~3–8 | from §4.2 step 6 router |
| pass behavior-equivalence proof + locator-RED | ~3–6 | ~2–5 | ~1–3 | ~1–3 | §4.3b |
| **human-approved → Lane B** | **~2–4** | **~1–3** | **~1–2** | **~1–2** | **repair: ~5–11** |

**Lane C — `stabilize`/`triage`** (`mine-flaky.mjs`, §4.3c — e2e-only `test.skip()`/timing PRs that Lane A
routes here):

| Stage | Documenso | Rocket.Chat | n8n | cal.diy | Notes |
|---|---|---|---|---|---|
| routed flaky-fix PRs (test.skip/timing) | ~10–20 | ~15–30 | ~3–8 | ~3–8 | RC/Cal flake-rich; §4.2 step 6 + §4.1 router |
| confirmed-flaky (mixed N=10) + stable golden | ~3–6 | ~4–8 | ~1–3 | ~1–3 | §4.3c |
| **human-approved → Lane C** | **~2–4** | **~3–6** | **~1–2** | **~1–2** | **stabilize+triage: ~7–14** |

So **4 apps → ~16–30 (Lane A) + ~5–11 (Lane B) + ~7–14 (Lane C) ≈ ~28–55 harvested cases**, requiring manual
triage of **~300–600 raw PRs** and human sign-off on every survivor. This range is **pure realism upside on
top of the seeded headline corpus — it carries NO quota obligation** (the §2.3 quota is owned by the
*seeded* batch, which is authored to spec; §1.4). Whatever the lanes yield is what we get; the upper end
gives rotation headroom. This is **why harvest is a calibration complement, not a
replacement** for the hand-seeded fixtures (§8): seeding buys guaranteed yield + contamination-freedom;
harvest buys realism.

### 4.6 Auto-tagging cases with special-case + architecture (`tag.mjs`)

So §2's matrix is **populated from real cases, not guessed**:

- **`architecture`** — probe the **live `v-fix` build** once (the case's stack is already up for the gate):
  fetch the root HTML + a representative route + headers via the harness's own `serveDir`/`fetch`, then run
  the §2.2 detectors (`__NEXT_DATA__`→SSR/Next; `<div id="root">`+XHR→SPA; `Upgrade: websocket` handshake or
  `page.routeWebSocket` traffic→WS; `/graphql` POST→GraphQL; `x-vercel-cache`/`cache-control`→SSG/ISR;
  service-worker→PWA). Record the matched signal(s) in the case for auditability.
- **`specialCases[]`** — derive from (a) the **changed source paths** (e.g. `pdf-viewer/` → SC3;
  `*editor*`/`ProseMirror` → SC4; `*socket*`/`*subscription*` → SC5; `*upload*` → SC3; `*auth*`/`*session*`
  → SC1), (b) **keyword match** on the issue title/body against the SC1–SC7 lexicon, and (c) the
  **perturbation kind** the case will carry (a `routeWebSocket` mutant ⇒ SC5; a `page.route` abort ⇒ SC7).
  Multiple tags allowed. Low-confidence tags are surfaced for the same human review that signs off the case.

The tagger writes the matrix-populating fields straight into `case.yaml` (§5), and `report.mjs` rolls them
up into the live coverage matrix so §2.3's target distribution is **measured**, not assumed.

---

## 5. Case schema

Extends the existing `fault-manifest.yaml` contract (same `oracle`/`swt`/`match_keywords` vocabulary the
spine already reads) with harvest provenance, the perturbation catalog, and the two coverage tags. One
`case.yaml` per harvested case, under `eval/fixtures/harvested/<app>/<case-id>/`.

**Fields:**

| Field | Meaning |
|---|---|
| `caseId`, `app`, `repo` | identity + source repo |
| `parentSha`, `mergeSha` | the two commits → `v-bug` (parent) and `v-fix` (merge) |
| `issueUrl`, `prUrl`, `bugLabel`, `issueLink` | provenance + linkage kind (`closes` / `cross-ref` / `private-ticket`) |
| `taskType` | `author` \| `extend` \| `repair` \| `triage` \| `stabilize` (§1.3) |
| **`specialCases[]`** | SC1–SC7 tags (§2.1) — drives rubric weighting (§6.7) |
| **`architecture`** | one of §2.2 + the `archSignals[]` that matched |
| `goldenPatch` (`code_patch`) | the fix diff (defines `v-fix`); the agent never sees it |
| `goldenTest` (`test_patch`) | the human test (used for the **novelty gate** §8 and golden-calibration §6.5; never given to the agent) |
| `image` | `repo/app@sha256:…` (the **`-arm`** tag for Cal.com) |
| `dbVersion` | pinned DB image@digest (e.g. `postgres:15@sha256:…`) |
| `seed` | seed command (`prisma:seed`) or `none` (spec self-provisions) |
| `e2eCmd` | runner cmd (`playwright test <spec> --reporter=json`) |
| `targetSpec`, `FAIL_TO_PASS`, `PASS_TO_PASS` | the dual-run + regression contract (from `gate.mjs`) |
| `oracle` | deterministic DOM/behavioral checker (existing shape) |
| **`perturbations[]`** | the adversarial catalog (mutants + refactors), each with id, kind, the one-line change, and the observable `expect_clean`/`expect_buggy` |
| `golden` | per-case calibration anchors: `golden_kill`, `golden_robust`, `golden_cost`, `golden_assertions` (§6.5) |
| `dates` | `mergedDate`, `introducedDate`, `capturedAt` (contamination window, §8) |
| `tier` | `headlineEligible: false` for harvested (calibration); `contaminationSuspect` flag if pre-cutoff. Seeded headline cases set `headlineEligible: true` |

```yaml
# eval/fixtures/harvested/documenso/D-2597-invalid-token-500/case.yaml
caseId: D-2597-invalid-token-500
app: documenso
repo: documenso/documenso
parentSha: a1b2c3d
mergeSha:  e4f5a6b
issueUrl:  https://github.com/documenso/documenso/issues/2484
prUrl:     https://github.com/documenso/documenso/pull/2597
bugLabel:  "type: bug"            # on the ISSUE, not the PR
issueLink: closes
taskType:  author
specialCases: [SC3, SC7]          # PDF-viewer access-token flow; 4xx/5xx surfacing
architecture: SPA                 # archSignals: ["<div id=root>", "xhr-after-paint", "/api/* JSON"]
archSignals: ["root-div", "xhr-after-first-paint", "rest-json"]
image:     "documenso/documenso@sha256:..."      # native multi-arch arm64
dbVersion: "postgres:15@sha256:..."
seed:      "npx prisma db seed"
e2eCmd:    "pnpm exec playwright test {spec} --reporter=json"
targetSpec: "packages/app-tests/e2e/pdf-viewer/pdf-viewer.spec.ts"
FAIL_TO_PASS: ["pdf-viewer › invalid QR token returns 302 not 500"]
PASS_TO_PASS: ["pdf-viewer › valid token renders document"]
oracle:
  type: http-status                # deterministic: status code on the access route
  url: "/d/{invalidToken}"
  expect_clean: 302                 # v-fix: redirect
  expect_buggy: 500                 # v-bug: unhandled findFirstOrThrow
swt:
  passes_on: [v-fix]
  fails_on:  [v-bug]
match_keywords: ["token", "access", "302", "500", "redirect"]
perturbations:
  # --- mutants: UI-observable near-misses, scored via the existing dual-run ---
  - id: M-001
    kind: mutant
    flavor: response-mutation        # via page.route — no rebuild (§6.2)
    change: "access route 500 → 404 (different wrong status)"
    expect_clean: 302
    expect_buggy: 404                # a good test asserts ==302, so it kills this
  - id: M-002
    kind: mutant
    flavor: response-mutation
    change: "expired-token branch returns 200 with empty body (silent success)"
    expect_clean: 302
    expect_buggy: 200                # catches defect-masking near-miss
  # --- refactors: behavior-preserving, gate-validated static builds (§6.3) ---
  - id: R-001
    kind: refactor
    class: testid-rename             # data-testid renamed, all for/aria/CSS hooks updated
    frozenSelectors: ["role=link[name=/document/i]"]   # oracle channel the refactor MUST NOT touch
    rationale: "rename data-testid=pdf-canvas → pdf-surface; behavior identical"
  - id: R-002
    kind: refactor
    class: dom-restructure           # wrap the viewer in an extra container
    frozenSelectors: ["role=link[name=/document/i]"]
    rationale: "wrap canvas in <section>; roles+names preserved"
golden:
  golden_kill: 1.0                   # human golden test kills 2/2 mutants
  golden_robust: pass                # human golden test survives R-001,R-002
  golden_cost: 0.06                  # USD the golden-equivalent run costs
  golden_assertions: 3
dates: { mergedDate: 2026-03-10, introducedDate: 2026-03-02, capturedAt: 2026-06-08 }
tier: { headlineEligible: false, contaminationSuspect: false }
```

---

## 6. Scoring

Per produced test, five axes. Each maps to a **spine module to REUSE** vs a **NEW scorer**, and to the
**FAILURE-MODES.md row** it catches. The new scorers stay stdlib-only in `eval/spine/` (zero-dep test
path); the **execution** (browser, mutation builds) is done by `eval/harvest/`/`driver/` and *fed* to the
pure scorers — exactly as `dual-run.mjs` already separates SCORE from EXECUTE.

### 6.1 Correctness (fail-to-pass)
- **Definition:** the agent's test passes on `v-fix` and fails on `v-bug` → `classifyDualRun → "real"`.
- **Reuse:** `spine/dual-run.mjs` `classifyDualRun({passedOnClean, failedOnBug})` **unchanged** (map
  `v-fix`→clean, `v-bug`→bug). `spine/lint.mjs` `lintTestCode` for the honesty guard (no `test.skip`, no
  `waitForTimeout`).
- **New:** none for scoring; the driver runs the two builds.
- **Catches:** "Defect masking" (passes on the buggy build) + "Oracle-rich tasks" success.

### 6.2 Sensitivity (mutation kill-rate) — the critic's feasible approach, NOT naive full-stack-per-mutant
The named tools (StrykerJS/PIT/mutmut) mutate source + re-run **unit** tests in-process; they have no
concept of "rebuild + restart + drive a browser." Pointing Stryker at an E2E suite reports a garbage 0%
(NoCoverage) or runs the whole suite per mutant (hours). **Do not wire Stryker into the per-run loop.**
Instead:

- **Definition:** kill-rate over a **curated, manifest-declared, UI-observable mutant catalog** scoped to
  the **golden-patch region** (the changed lines), scored through the **existing dual-run** — a mutant =
  one extra browser navigation, not a rebuild.
- **Execution (cost model adopted):** mutants are applied as **build variants behind the serve layer, or
  as response-level mutation via `page.route`/`page.routeWebSocket`** (status 201→200, drop a JSON field,
  reorder/drop a WS message) with **warm-stack reuse** — boot the stack **once**, mutate per *request*, not
  per *rebuild*. Cost = `N × (|mutants| × (t_apply + t_e2e) + t_warmup)`. **This is exactly the §1.4 tier
  split:** **seeded headline cells are static/served** (`t_apply≈0`, `t_e2e≈1–2s` → a 10-mutant catalog × N=5
  ≈ 1–2 min/case) → **mutation runs IN-LOOP on PR** and feeds the gate. **Harvested cells are Docker**
  (`t_apply` = one request, `t_e2e ≈ 5–15s`) → **mutation runs NIGHTLY only, report-only** (it informs
  calibration, never gates). So the expensive Docker mutation never sits on the PR path, and the gated
  headline only ever depends on the cheap seeded catalog. Catalog size per tier: §11 decision #4 — seeded
  headline cases get a full **~8–12 observable mutants**; harvested cells get a **light 2–4-mutant** catalog
  (or skip sensitivity entirely, since they are report-only).
- **Per-mutant `pass^k` guard:** a mutant counts as **killed** only if the test fails on it in ≥⌈N/2⌉ runs
  AND passes clean in ≥⌈N/2⌉ — removes flake-as-false-kill.
- **Equivalent-mutant policy (stated in FAILURE-MODES):** catalog mutants are **human-vetted
  observable-by-construction**, so `kill-rate < 1.0` means a **weak test**, not an unkillable mutant.
  Auto-generated mutants are **forbidden in the scored path** (unbounded equivalence at E2E granularity).
  StrykerJS is allowed only **offline, as a mutant-authoring aid for the maintainer** (vet that
  hand-authored mutants are operator-diverse), never in the per-run E2E loop.
- **Scope fix:** mutants live **only in the behavior region the case targets** (the diff), so a focused
  single-flow test scores high instead of being penalized for not killing unrelated whole-app mutants.
- **Reuse:** `spine/dual-run.mjs` (each mutant is an extra clean/bug pair) + `spine/passk.mjs`
  `passHatK` (the per-mutant kill guard).
- **New:** `eval/spine/sensitivity.mjs` (`killRate(catalogResults)` — iterates manifest `perturbations`
  of `kind: mutant` through `classifyDualRun`, applies the `pass^k` kill guard, returns `killed/total`
  minus the canonical bug already counted by Correctness so it's **orthogonal** signal). Execution helper
  `eval/driver/mutate.mjs` (materialize a served build variant OR a `page.route` response-mutation — **not**
  a Stryker integration).
- **Catches:** "Coverage theater" (executes without meaningful assertions); "Defect masking" near-misses.

### 6.3 Specificity / robustness (refactor-invariance) — the critic's validated refactor-generation approach
The trap: the refactor and the golden oracle share selectors, so a `testid`-rename breaks **both** the
agent test and the answer key — you can no longer prove the refactor preserved behavior. And naive
regex/DOM-shuffle refactors aren't behavior-preserving (they flip `label[for]`/`aria` associations, tab
order, `:nth-child` CSS). So:

- **Definition:** the agent's test still passes on `v-refactor-NN` (a behavior-preserving DOM/id churn
  build) **and** the case is fairly refactor-stable (the golden also passes it).
- **Decouple the oracle from the refactored surface:** the case manifest declares a **`frozenSelectors`
  allowlist** (a role+accessible-name or JS-evaluated state channel) the refactor is **contractually barred
  from renaming**; the oracle uses *only* that frozen channel, while the agent's test is scored on the
  **whole** selector surface.
- **Mandatory validation gate (the answer to "is the refactor truly behavior-preserving?"):** a
  `v-refactor-NN` build is admitted to scoring **only if** (a) `driver/dual-run.mjs goldenCompleteTodo`-style
  golden oracle **plus** a hand-authored **locator-ladder reference test** both still pass on it, AND (b) a
  **behavioral-equivalence diff** (drive the same reference script on `v-fix` and `v-refactor`, diff the
  oracle value + **accessibility-tree snapshot** + **tab-order**) is **empty**. Fail either → the refactor
  is **rejected as not-behavior-preserving** (it changed behavior or hit the oracle) and **no agent is
  scored against it.** This catches accidental bug-reintroduction and the `for`/aria/tab-order class.
- **Generate-then-verify, never live:** refactors are **hand-authored static builds** (`v-refactor-NN`),
  pinned/git-committed like the bug builds, each with a one-line rationale; automation may *propose* (DOM/AST
  transform via parse5/jsdom, never regex), but the validation gate **disposes**. Pinning removes refactor
  nondeterminism from the run loop (no Monday-vs-Tuesday drift). Admissible classes per case (in the
  manifest): (1) **testid/id rename** (all `for`/aria/CSS hooks updated), (2) **DOM restructure**
  (wrap/move, roles+names preserved), (3) **cosmetic class/style churn**; **field-reorder** is a gated 4th
  class behind the strongest tab-order+submit-order equivalence proof.
- **Per-locator accountability (binary → ranked):** parse the agent test's selectors, rank each on the
  locator ladder (role/label/text/testid = robust; id/css-class/`:nth-child`/xpath = brittle). **Only
  penalize** a refactor failure when the refactor changed a surface the agent **could have avoided** (a
  robust handle existed and it chose brittle). If the app exposed **no** robust handle, mark the case a
  **fixture-testability limitation**, surfaced separately — not an agent penalty.
- **Reuse:** `spine/dual-run.mjs` (`v-refactor` re-run = a clean-only pass check); `spine/lint.mjs`
  `BRITTLE` patterns (promoted from advisory to a robustness predictor — extend to flag `id=` and bare
  `.class`).
- **New:** `eval/spine/robustness.mjs` (`refactorVerdict({passedOnRefactor, agentSelectors, frozenSelectors,
  appExposedRobustHandle})` → `{robust, attributedTo, fixtureLimitation}`) + `eval/driver/refactor-gate.mjs`
  (the validation gate: golden + reference test + axe/aria-snapshot/tab-order behavioral-equivalence diff,
  using Playwright `page.accessibility.snapshot` + `getByRole`/`getByLabel` + `axe-core`).
- **Catches:** "Brittle locators / DOM over-fit."

### 6.4 Stability (flake over N)
- **Definition:** the test produces the **same outcome classification** (real/masked/broken) across N
  reruns in the **same pinned container** the agent ran in.
- **Reuse:** `spine/passk.mjs` `summarize(results, k)` → `pass^k` is the headline reliability number; same
  N=5 / ≥4-of-5 STABLE / 2+-deviation **QUARANTINE** policy as harvest (§4.4) and as the platform critic.
- **New:** none (passk already does the math); the runner supplies the N boolean array.
- **Catches:** "Nondeterminism & flakiness."

### 6.5 Efficiency, quality-gated — the precise "qualified run" + headline + cost-to-qualify
The critic's structural fix: **the gate must live INSIDE the boolean `pass^k` consumes**, not beside the
headline — otherwise a test that goes fail→pass but kills 40% of mutants reports `pass^3 = 1.0` and looks
shippable. And thresholds must be **per-case-fair** (calibrated to the golden), or a global bar measures
case difficulty, not agent skill.

- **Per-case calibration (non-arbitrary thresholds):** run the **human golden test once per case** through
  the same scorers and store `golden_kill`, `golden_robust`, `golden_cost`, `golden_assertions` in
  `case.yaml`. Then:
  - `sens_case = 0.9 × golden_kill` (agent must kill ≥90% of what the human oracle kills **on this case** —
    dissolves the equivalent-mutant denominator problem; hard cases get proportionally lower achievable bars).
  - `robust_case = golden_robust` (agent must survive the refactors the golden survives).
  - `cost_cap_case = 1.5 × golden_cost` **AND** `assertion_count ≤ 2 × golden_assertions` (closes
    over-assertion / snapshot-bloat gaming — a 400-line full-page-snapshot test now **fails** the cap even
    if it kills every mutant).
- **Qualified-run boolean (multiplicative zeroing, reusing the `conformance.mjs` pattern):**
  ```
  qualified_i =  outcome_PASS_i
              AND kill_i        >= sens_case
              AND robust_i      >= robust_case
              AND cost_i        <= cost_cap_case
              AND assertions_i  <= assert_cap_case
              AND no_masking_i              # lint.mjs masking == 0
              AND no_over_assertion_i       # new AST over-spec lint
  ```
  ANY failing dimension ⇒ `qualified_i = false`, fed as the boolean to `passk`.
- **Headline:** `pass^k_qualified = passHatK(qualified[], k)` over the qualified booleans (NOT a bare
  outcome). Reported as the pair **(`pass^k_qualified`, `cost-to-qualify`)** where
  **`cost-to-qualify = mean(cost_i) / qualify_rate`** (= expected USD to obtain **one** qualified artifact;
  `qualify_rate = c/n` on the qualified boolean). A run-set with `c<k` qualified reports `pass^k=0` with
  cost-to-qualify **ranked last (∞)**, never `null` — so the cheap-but-flaky agent ranks worst instead of
  vanishing.
- **Autonomy cost (renamed from "human-intervention cost", defined objectively from trace events only —
  no human is present in a headless run):** count auto-resolved permission prompts + `api_retry` events +
  R2/R3 rework rounds (`conformance.rounds`) + tool-error recoveries. **Tie-breaker among qualified runs**
  (lower = better), **never a gate**.
- **Cost-attribution fix (single source of truth):** when the headless `total_cost_usd` is present (it
  **already includes subagents**), use it **alone** — do **not** also `mergeRecords` parsed subagent
  transcripts into the same total (double-billing). Reserve `mergeRecords` for the transcript-fallback path;
  add a cross-check assertion (within ~5%), never a sum.
- **`reliabilityAdjustedCost` fix:** patch `seriesComposites` to divide by `max(passK, 1/C(n,k))` so a 2/5
  agent ranks worst instead of returning `null`.
- **Reuse:** `spine/passk.mjs` `passHatK` (consumes the qualified array); `spine/conformance.mjs`
  multiplicative-zeroing pattern (the model for `qualifyRun`); `spine/usage.mjs` `seriesComposites`
  (patched per above); `spine/lint.mjs` masking detector.
- **New:** `eval/spine/qualify.mjs` (`qualifyRun(run, manifest) → boolean` + `headlineMetrics` gains
  `pass^k_qualified` + `cost_to_qualify`); extend `lint.mjs` with an **over-assertion detector**
  (full-page snapshot, assertion count `> γ × golden_assertions`, pinning out-of-scope fields).
- **Catches:** "Coverage theater" + "Defect masking" + over-specification (the twin of masking) +
  efficiency-as-first-class.

### 6.6 Headline & gating summary

| Metric | Reuse | New | FAILURE-MODES row |
|---|---|---|---|
| Correctness (fail→pass) | `dual-run.mjs`, `lint.mjs` | — | Defect masking; Oracle-rich |
| Sensitivity (kill-rate) | `dual-run.mjs`, `passk.mjs` | `spine/sensitivity.mjs`, `driver/mutate.mjs` | Coverage theater |
| Robustness (refactor) | `dual-run.mjs`, `lint.mjs` BRITTLE | `spine/robustness.mjs`, `driver/refactor-gate.mjs` | Brittle locators / DOM over-fit |
| Stability (flake) | `passk.mjs` | — | Nondeterminism & flakiness |
| Efficiency (quality-gated) | `passk.mjs`, `conformance.mjs`, `usage.mjs` | `spine/qualify.mjs`, `lint` over-assertion | Coverage theater + efficiency |
| Contamination delta | `dual-run.mjs` | `spine/novelty.mjs` (§8) | Contamination / memorization |

### 6.7 Where the special-case / architecture tag changes the rubric

The tags are not decoration — they **add per-case checks and reweight**:

- **WS/real-time + SC5:** the dual-run + mutation catalog uses **`page.routeWebSocket`** to drop/reorder
  messages and force reconnect; the rubric **adds** *reconnect-on-drop caught* and *message-ordering
  asserted* as qualified-run sub-conditions. A passing test that ignores ordering is **not** sensitive. The
  **headline** reconnect/ordering rubric fires on the **seeded WS fixture** (§2.3); Rocket.Chat (DDP) and n8n
  (executions) provide the calibration realism overlay.
- **SSR + any SC:** rubric **adds** *hydration-error-free first paint* (assert no console hydration mismatch
  + first-paint state == hydrated state) and *SEO-meta presence*. Robustness weight is higher because SSR DOM
  churns between server and client renders. The **headline** SSR rubric fires on the **seeded Next.js SSR
  fixture** (§2.3, §11 risk 5), so it has **no dependency on Cal.com**; Cal.com's real SSR cases are a
  **calibration realism overlay** — if cal.diy yields 0 SSR-path cases, only the calibration sample is
  absent, the headline rubric still fires (the former single-point-of-failure is dissolved, §1.4).
- **GraphQL + SC7 (CONDITIONAL — not a firing rubric on the chosen four):** *if* an RC GraphQL-surface case
  survives the gate, the rubric **adds** *200-with-errors surfaced* (a mutant returns HTTP 200 with a
  `{errors:[…]}` payload; a sensitive test must fail on it — the classic GraphQL defect-masking trap).
  **But no chosen app is a confirmed GraphQL source** (RC's GraphQL is non-primary `○GraphQL`; Twenty is
  deferred, §3.2). So this rubric cell is **conditional/aspirational**: GraphQL is a **declared gap until
  Twenty is promoted** (§2.3 gaps), and this benchmark does **not** claim the GraphQL rubric reliably fires.
- **Complex-UI (SC4):** **brittle-locator robustness weighs heavier** — the locator-ladder accountability
  (§6.3) contributes more to the qualified-run boolean, because complex widgets (canvas, editors, pickers)
  are exactly where agents reach for `:nth-child`/xpath. `cost_cap` is loosened slightly (these legitimately
  need more setup).
- **Auth/session (SC1):** rubric **adds** *token-refresh handled* (mutant expires the token mid-flow) and
  treats environmental blockers (CAPTCHA) as **BLOCKED, not FAIL** (the FAILURE-MODES "Environmental
  coupling" row) — a `triage` verdict, not a scored `author` failure.
- **Error/edge (SC7):** rubric **adds** *5xx/4xx surfaced, not swallowed* (mutant turns an error into a
  silent 200; the test must catch it).

---

## 7. Platform / arm64 recipe

Adopts the platform critic in full, including the correction that **the oracle currently runs Playwright
chromium NATIVELY on the host** (`dual-run.mjs resolveChromium()`), not in any container — so we must make
**one substrate authoritative** and **pin the browser before the image**.

**Substrate decision (the resolved tension):** the scored dual-run runs **inside the linux/arm64 Docker
container** — that is the one authoritative substrate. This is a real change to the *browser-resolution path
itself*, not just to which revision is picked: `resolveChromium()` today is hardcoded to the **macOS host**
cache `~/Library/Caches/ms-playwright` (via `join(homedir(), "Library/Caches/ms-playwright")`) with
`mac-arm64/mac-x64/linux64` arch subdirs, i.e. it resolves the browser from the *developer's host cache*.
Moving the scored run into the container means the browser is resolved from a **container linux/arm64 cache**
(`PLAYWRIGHT_BROWSERS_PATH` inside the image), not the host. The host-native macOS path remains usable only
for the unscored local-dev smoke; it is **never** the scored substrate. (§7.1 covers both the sort-order fix
and this substrate move.)

1. **Pin the browser first (the real determinism hole), and re-point its substrate.** Replace
   `eval/package.json` `playwright: "latest"` with an **exact version** (commit the resolved `package-lock`);
   install chromium with that exact version (`npx playwright@<pinned> install chromium`), set
   `PLAYWRIGHT_BROWSERS_PATH`, and **checksum-verify the tarball**. Then fix `resolveChromium()` on **two**
   axes:
   - **(a) revision-selection bug:** select by an **explicit pinned revision** (env
     `PLAYWRIGHT_CHROMIUM_REVISION` / the pinned package's `browsers.json`), **not**
     `readdirSync().sort().reverse()` (which silently prefers the newest cached build). **Fail loudly** if the
     pinned revision is absent.
   - **(b) substrate/path:** `resolveChromium`'s cache path is **macOS-only** today (`~/Library/Caches/
     ms-playwright`, `mac-arm64/mac-x64/linux64` dirs). For the scored run, resolve from the
     **container's linux/arm64** `PLAYWRIGHT_BROWSERS_PATH` (linux arch dir), **not** the host cache.
     The host-native chromium resolution is retained only for unscored local dev; the scored dual-run is
     authoritative **only on linux/arm64-in-Docker**.
2. **Build native arm64 (no QEMU).** `docker buildx build --platform=linux/arm64` (single-arch); `FROM
   <base>@sha256:<digest>` for OS + **every** DB/search image from **official multi-arch** tags
   (`postgres`, `mongo:7+` for Rocket.Chat replica-set, `redis`). **Cal.com:** pull the **`…-arm`** app tag
   explicitly (it has no unified multi-arch manifest).
3. **Assert the arch (catch silent Rosetta/QEMU fallback).** Post-build gate:
   `test "$(docker image inspect --format '{{.Architecture}}' IMG)" = arm64` — **fail the build** rather
   than ship an emulated, timing-flipped case.
4. **Neutralize clock/locale/seed (digests can't).** `TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8` in the run env;
   Playwright context `timezoneId`, `locale`, `reducedMotion`, `page.clock` frozen time; seed any fixture
   RNG. Critical for Cal.com's **tz/locale (SC4/SC6)** cases.
5. **Determinism policy:** N=5 epochs at temp 0; **STABLE = identical outcome ≥4/5**; **2+ deviations →
   QUARANTINE** (flagged finding, not silent drop). Report `pass^k` consistency, not `pass@k`.
6. **Cross-arch stance (honest):** **arm64 is the CANONICAL scoring arch**; a published score reads
   "reproducible on linux/arm64 at `<fingerprint>`". Add an **x86/amd64 parity smoke** (a subset of
   deterministic, non-vision oracles) that must agree within tolerance; **vision-baseline and WS-latency-
   bound oracles are arch-stratified** (separate baselines per arch), never compared as a single absolute.
7. **Environment fingerprint in every scorecard:** stamp `{arch, node, playwrightVersion, chromiumRevision,
   TZ, LC_ALL, imageDigest, dbDigest}` into the JSON `report.mjs` writes; **refuse to compare scorecards**
   whose fingerprints differ on those keys.
8. **Digest-refresh + mirror policy:** pin by digest, **mirror** every pinned base/DB/browser artifact to a
   registry/cache we control (or check the chromium tarball checksum into the repo), re-pin on each
   quarterly fixture rotation, and add a CI "rebuild-from-scratch from pinned digests only" smoke so pins
   stay resolvable when upstream GCs tags.

---

## 8. Contamination plan

The dominant leak the plan must not ignore: **the golden TEST is public, and the task is to re-author it**
(SWT-bench's own "test-prediction is more memorization-prone" finding). So:

- **Hand-seeded private faults are the HEADLINE; harvested public PRs are CALIBRATION.** Promote the
  existing `fixtures/todomvc` v-clean/v-bug + private `fault-manifest.yaml` matrix (and new private
  hand-seeded cases) to the **gated number**; harvested cases are a **secondary line**, `headlineEligible:
  false`. The bug + expected assertion never existed on GitHub for the headline track, sidestepping
  golden-test leakage on the load-bearing metric. (This is the eval benchmarking our **prompt+skill layer**,
  not the model — a controllable private substrate is both more honest and more on-mission.)
- **Novelty gate (stop scoring "reproduce the golden test"):** a generated test that passes the dual-run
  **but is textually close to the public golden test** is scored **CONTAMINATED, not RESOLVED**. **New:**
  `eval/spine/novelty.mjs` — normalized-AST + token-shingle (Jaccard/n-gram) **+** embedding cosine of
  `emittedTest` vs `goldenTest`; above threshold ⇒ flag. This converts the public golden from "the answer"
  into "a forbidden crib."
- **Semantic (not just surface) perturbation:** perturb the **values the test must encode** (fixture
  values, thresholds, edge case, expected count), not just renames — a memorized assertion becomes **wrong**,
  not merely renamed. Verify every perturbed build still satisfies its own golden oracle automatically
  before scoring (guard against the perturbation breaking the manifest).
- **Per-model time-window (replace "prefer recent" with code):** record `introducedDate`/`mergedDate` and
  each evaluated model's `model_cutoff_at_capture`; the reporter scores the **post-cutoff subset per model**
  and **refuses cross-model comparison** on cells predating either model's cutoff. Every harvested cell
  carries an **expiry** (next model cutoff after its merge date); the reporter **visibly retires** expired
  cells from the headline so the benchmark can't silently rot.
- **Public/private split + rotation:** a **PUBLIC** split (published, reproducible, calibration) + a
  **PRIVATE held-out** split **never routinely sent to hosted APIs** (run only against self-hosted/local
  models, or ≤ a few audited runs/quarter), rotated **~20%/quarter**. Publish methodology + the public
  split + aggregate vectors + perturbation deltas; **withhold** private cases, canaries, raw transcripts.
- **Contamination as a first-class metric (not just a flag):** the scorecard reports **emitted-vs-golden
  similarity**, **canonical-vs-perturbed delta**, **pre/post-cutoff delta**, and **canary-hit rate** — so
  "is this number memorized?" is **answerable**, not asserted. A large pre/post or canonical/perturbed drop
  = memorization, reported beside the headline.
- **Catches:** the "Contamination / memorization" FAILURE-MODES ✗✗ row.

---

## 9. Reuse-vs-build map

| Component | Existing `eval/` file (REUSE) | NEW |
|---|---|---|
| Correctness dual-run classify | `spine/dual-run.mjs` `classifyDualRun` | — |
| Honesty lint (masking/sleep/brittle) | `spine/lint.mjs` | extend: `id=`/bare-class brittle + **over-assertion** detector |
| `pass^k` / reliability | `spine/passk.mjs` `passHatK`,`summarize` | — |
| Cost/usage attribution | `spine/usage.mjs` `parseClaudeResult`,`seriesComposites` | patch: single-source cost (no double-bill); `reliabilityAdjustedCost` ÷ `max(passK,1/C(n,k))` |
| Process conformance (multiplicative gate pattern) | `spine/conformance.mjs` | reuse pattern for `qualifyRun` |
| Report / baseline diff / cross-backend table | `spine/report.mjs` `renderReport`,`renderComparison` | add `pass^k_qualified`, `cost_to_qualify` as additive scalar keys in `headlineMetrics`; **plus new non-scalar handling** — `headlineMetrics`/`compareToBaseline` today only emit and diff **scalar numbers** (`typeof === "number"`), so the **coverage-matrix rollup** and **env-fingerprint comparison** are structurally new shapes (nested objects), not a metric add (see §7 fingerprint refusal). |
| Trajectory / trace / ACP signals | `spine/trajectory.mjs`, `extract-trace.mjs`, `acp-trace.mjs` | reuse (autonomy-cost events) |
| Routing / skills / seeding | `spine/routing.mjs`, `skills.mjs`, `seeding.mjs` | reuse as-is |
| LLM-judge verdict aggregation (`triage`/`stabilize`) | `spine/judge.mjs` `buildJudgePrompt`,`scoreRubric` | **NEW rubrics** `rubrics/triage.json`, `rubrics/stabilize.json` (only `rubrics/scout-seeding.json` exists today) for the structured verdicts. **Note:** `judge.mjs` is a pure prompt-builder + weighted-score aggregator with **no embedding capability** — the novelty embedding-cosine is **NEW** (`spine/novelty.mjs`, below), **not** a `judge.mjs` reuse. |
| Dual-run executor (serve builds + run in browser) | `driver/dual-run.mjs` `serveDir`; `resolveChromium` (revision-selection logic only) | **fix `resolveChromium` AND change its substrate.** Today it (a) selects newest-cached via `readdirSync().sort().reverse()` (the sort-order bug, §7.1) **and** (b) is hardcoded to the **macOS** cache path `~/Library/Caches/ms-playwright` with `mac-arm64/mac-x64/linux64` arch dirs. Making linux/arm64-in-Docker canonical (§7) means the browser resolution path itself moves substrate (host macOS cache → container linux cache), not just the revision-selection logic. Reuse for mutant/refactor builds once re-pointed. |
| Orchestrated pipeline driver | `driver/run-pipeline.mjs` | reuse to dispatch the TAE task to Tal |
| Case manifest contract | `fixtures/todomvc/fault-manifest.yaml` | extend → `case.yaml` (§5): `taskType`, `specialCases[]`, `architecture`, `perturbations[]`, `golden`, `dates`, `tier` |
| **Sensitivity scorer** | — | **`spine/sensitivity.mjs`** + `driver/mutate.mjs` (served-variant / `page.route` mutation; NO Stryker-in-loop) |
| **Robustness scorer + refactor gate** | — | **`spine/robustness.mjs`** + `driver/refactor-gate.mjs` (golden+reference+axe/aria/tab-order equivalence) |
| **Qualified-run + headline** | — | **`spine/qualify.mjs`** (`qualifyRun`, `cost_to_qualify`) |
| **Novelty / contamination** | — | **`spine/novelty.mjs`** (AST+token+embedding similarity, perturbation/time deltas) |
| **Harvest pipeline** | — | **`eval/harvest/{crawl,filter,classify-pr,split,gate,mine-refactor,mine-flaky,tag,determinism,emit-case}.mjs` + `allowlist.json`** — `classify-pr` routes PRs into the three task-type lanes (§4); `mine-refactor` (Lane B `repair`, §4.3b) and `mine-flaky` (Lane C `stabilize`/`triage`, §4.3c) are the stages that yield the non-author/extend taskTypes the §4.3 red→green gate cannot |
| **Platform build** | — | `eval/harvest/build/` Dockerfiles + buildx arch-assert + digest pins + mirror |

Every NEW `spine/*.mjs` is stdlib-only with a sibling `*.test.mjs` (the zero-dep `node --test` path);
everything that carries deps (Playwright, embeddings, Docker, `gh`) lives in `harvest/`/`driver/`.

---

## 10. Crawl / walk / run roadmap

**Seeded HEADLINE first, harvested CALIBRATION second** (per §1.4) — and smallest-first within that,
easy special-cases before hard ones. Effort is rough engineer-days. The crucial reordering vs the first
draft: **Crawl builds the gated seeded pipeline with NO Docker and NO harvest**; harvest only enters at Walk
as a report-only overlay. This way the headline number exists and is regression-gateable before we ever pay
the harvest/Docker cost.

### Crawl — the seeded headline pipeline + the three new scorers, static/served only (~4–6 d)
- **No Docker, no harvest, no LLM judge.** Everything runs on **static/served seeded fixtures** (extend the
  existing `fixtures/todomvc` v-clean/v-bug) so the loop is cheap and contamination-free.
- **Build the 3 new stdlib scorers + tests** (the zero-dep `node --test` path): `spine/sensitivity.mjs`,
  `spine/robustness.mjs`, `spine/qualify.mjs`, validated against the seeded fixtures.
- **Author a minimal seeded headline slice (~3–4 cases):** one **SC7 `author`** (deterministic status/DOM
  oracle), one **SC3-style `author`** (file/preview happy-path — CRUD anchor), one **`repair`** with **2
  hand-authored `v-refactor`** builds (testid-rename + DOM-restructure), driven through
  `driver/refactor-gate.mjs`. Mutation runs **in-loop** via `driver/mutate.mjs` (`page.route` on the served
  build) with a full ~8–12-mutant catalog (cheap on static, §6.2).
- **Score AND gate:** Correctness (`dual-run`) + Sensitivity + Robustness + Stability (`passk` N=5) →
  `spine/qualify.mjs` qualified-run boolean → **`pass^k_qualified` + `cost_to_qualify`**, with
  golden-calibrated thresholds (§6.5). This is the real gated headline, just on a tiny corpus.
- **Exit criterion:** one TAE task → install bundle → dispatch Tal → author test → dual-run + mutation +
  refactor + qualify → a **gateable** `pass^k_qualified`/`cost_to_qualify`, on native-arm64 chromium (pin
  the revision; fix the `resolveChromium` sort/substrate bug, §9/§7). Validates the whole *scoring*
  architecture cheaply, before any Docker.

### Walk — author the seeded matrix + stand up the harvested calibration overlay (~8–12 d)
- **Grow the seeded headline corpus toward the §2.3 quota (~18-case partial batch):** add the **seeded SSR**
  and **seeded WS** fixtures (so the §6.7 SSR-hydration and reconnect/ordering rubrics fire on the headline
  with no Docker dependency), plus SC1/SC4/SC5 seeded cases. Build `spine/robustness.mjs` per-locator
  accountability fully; add the `rubrics/triage.json` + `rubrics/stabilize.json` LLM-judge rubrics (scored
  via existing `judge.mjs scoreRubric`).
- **Stand up the FIRST harvested calibration app — Documenso** (turnkey `use`: native arm64, 2-service, bot
  `🚨 e2e changes 🚨` label, verified gold PR #2597): build `harvest/{crawl,filter,classify-pr,split,gate,
  tag,determinism,emit-case}.mjs` + `spine/novelty.mjs` (contamination detector incl. embedding-cosine) +
  the public/private split + per-model time-window in `report.mjs`. **Harvested cases land `headlineEligible:
  false` — report-only.** Mutation on Docker cells runs **nightly**, not on PR (§6.2).
- **Result:** a gateable ~18-case seeded headline + a Documenso harvested realism overlay that *informs but
  never blocks*. Wire the x86 parity smoke.

### Run — full seeded headline batch (gated) + multi-app nightly calibration (~10–15 d)
- **Reach the §2.3 worked ~30-case SEEDED allocation** (≥60% hard, full taskType quota) — this is the gated
  headline. Because it is authored, there is **no yield risk**.
- **Add harvested calibration apps as NIGHTLY overlays** (Docker, report-only): **n8n** (SC4 canvas, lowest
  run cost), **Rocket.Chat** (SC5 WS/DDP realism; `page.routeWebSocket` mutants; Mongo replica-set), and
  **Cal.com/cal.diy** (real SSR + tz/locale realism; `-arm` tag + arch-assert + frozen clock). These sample
  the *real* versions of the seeded SSR/WS rubrics; if cal.diy yields 0 SSR cases the **headline SSR rubric
  still fires on the seed** (§2.3, §11) — only the calibration sample is absent.
- **Gate** the deterministic seeded headline — `pass^k_qualified` + `cost_to_qualify` — on a **significant**
  drop past the baseline IQR band (Mann-Whitney over the N qualified booleans), median-of-N flake control;
  LLM-judged `triage` verdicts and **all harvested signal stay advisory**.
- Full contamination reporting (emitted-vs-golden, perturbation/time deltas, canary-hit), quarterly
  rotation, digest-refresh CI smoke. **Defer** the architecture gaps (GraphQL/SSG/ISR/PWA/micro-FE/JAMstack)
  — addable later as **seeded fixtures** (seeded GraphQL surface; Astro/Eleventy seed; module-federation
  seed) without promoting a real-repo app (§11).
- **Sequencing of hardness** (within the seeded authoring): SC7/SC3 (deterministic status/DOM oracles) → SC1
  (auth flows) → SC4 (brittle-locator-heavy complex UI) → SC5 (async/WS, flakiest, needs frozen clock +
  `routeWebSocket`) → SSR hydration (seeded SSR fixture). CAPTCHA / canvas-visual remain `triage`/out-of-scope.

---

## 11. Open risks & decisions needed

**The load-bearing decision is RESOLVED (§1.4): seeded private faults = gated HEADLINE; harvested public PRs
= report-only CALIBRATION.** That single choice cascades and resolves five of the six original open
decisions — recorded below, each with how the cascade settles it. They are reversible defaults; say the word
to revisit.

| # | Original risk / decision | **Resolution (cascade from §1.4)** |
|---|---|---|
| 1 | Contamination is structural for the harvested tier (golden test is public) | **RESOLVED — seeded headline, harvest calibrates.** Harvested cases carry `headlineEligible:false` and never gate; the contamination machinery (novelty gate, semantic perturbation, time-window, public/private split, §8) downgrades them to advisory. The number we defend is contamination-free by construction. |
| 2 | Scan-to-yield is brutal (<1% of bug-fix PRs; ~28–55 from 4 apps) → promote Twenty/Ghost/Mattermost to backfill? | **RESOLVED — NO promotion now.** The brutal yield is **no longer a blocker**: the seeded headline corpus is authored to the §2.3 quota (guaranteed yield), so harvest volume is pure upside. Keep the chosen four; accept whatever the lanes produce as realism overlay. Twenty/Ghost/Mattermost stay **deferred** (revisit only if we want their *specific realism*, not to hit a count). |
| 3 | Survivorship bias toward E2E-in-PR-disciplined repos → add a follow-up-PR joiner? | **RESOLVED — accept as a documented limitation; NO joiner.** The bias only afflicts the *calibration* tier, not the headline; a costly follow-up-PR joiner isn't worth it for a non-gating overlay. Documented here as a known property of the harvested sample. |
| 4 | Equivalent-mutant / refactor-validity rest on human vetting (per-case effort) → budget authoring or cap catalog? | **RESOLVED — budget authoring for the SEEDED headline only.** Seeded headline cases get a full **~8–12 observable mutant** catalog + gate-validated `v-refactor` builds (the effort is worth it — it's the gated signal). Harvested cells get a **light 2–4-mutant** catalog or skip sensitivity entirely (report-only). Effort is bounded to ~30 seeded cases, not the whole harvest. |
| 5 | Cal.com arm64 fragility = SSR single point of failure | **RESOLVED — SSR moved to a SEEDED fixture.** The headline SSR-hydration rubric (§6.7) fires on a small **seeded Next.js SSR fixture** (clean, pinned, arm64-safe); Cal.com's real SSR is demoted to a **harvested calibration overlay**. The single-point-of-failure is **dissolved** — if cal.diy breaks or yields 0 SSR cases, only the *calibration* sample is missing; the headline rubric still fires (§1.4, §2.3). |
| 6 | Mutation cost on dynamic Docker cells (not PR-affordable) → which cells run PR vs nightly? | **RESOLVED — PR = seeded static/served (in-loop); nightly = harvested Docker (report-only).** Exactly the §1.4 tier split, detailed in §6.2. Expensive Docker mutation never sits on the PR path. |

**Coverage cells — prioritize vs defer (under the resolved tiering):**

| Priority | Cells | Tier / source | Rationale |
|---|---|---|---|
| **Prioritize now (HEADLINE, seeded)** | SC7 (error/edge), SC3 (file/preview), SC1 (auth), SC4 (complex UI), SC5 (async) + **seeded SSR** + **seeded WS** | seeded fixtures (authored to §2.3 quota) | hard, agent-defeating, where brittle-locator + defect-masking live; authored ⇒ guaranteed yield, contamination-free, gateable |
| **Calibration overlay (harvested, report-only)** | the real versions of the above on Documenso / n8n / Rocket.Chat / Cal.com | harvested, `headlineEligible:false`, nightly Docker | realism + contamination sanity check; never gates |
| **Defer (need a new SEEDED fixture)** | GraphQL, SSG stale-cache, ISR revalidation, PWA offline, micro-FE cross-module, JAMstack, MPA | none yet (cheap to add as **seeded** fixtures: seeded GraphQL surface; Astro/Eleventy seed; module-federation seed) | no app promotion required — author a small seed when the cell becomes a priority |
| **Tag-and-defer (un-oracle-able)** | CAPTCHA (SC1), canvas/WebGL visual-only (SC4) | — | no deterministic E2E oracle; route to `triage`/out-of-scope per FAILURE-MODES "No-oracle / True non-functional" |

**Remaining decisions (genuinely still open — none block Crawl):**
- **Threshold multipliers** (`sens = 0.9× golden`, `cost_cap = 1.5× golden`, `assert_cap = 2× golden`):
  **proposed default = accept as-is**, then **tune per `taskType` after Crawl** produces real golden-vs-agent
  calibration data. (Not blocking — Crawl runs on the defaults.)
- **Deferred architecture fixtures** (GraphQL/SSG/ISR/PWA/micro-FE): **proposed default = defer past Run**,
  add as seeded fixtures when a specific cell becomes a priority. (Not blocking.)
- **Harvest investment ceiling:** how many engineer-days to spend on the calibration overlay (Walk/Run) given
  it never gates — a budget question for when we reach Walk, not now.