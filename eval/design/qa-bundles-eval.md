# Eval Harness Design for the QA Bundles (`web-qa`, `test-automation`, `quality-engineering`)

A concrete, opinionated design for a repeatable benchmark that measures whether the QA bundles got **better or worse** every time you edit an agent prompt, a skill, or a bundle briefing — across host setups (Claude/Copilot/Cursor/Codex) and across versions of the app-under-test.

---

## 0. Framing: what does NOT exist, and what you must build

The single most important finding from the research: **essentially every public agent benchmark measures task *completion* (can the agent do X?), not bug *finding* (can the agent detect that X is broken?).** WebArena (812 tasks), VisualWebArena (910), WebVoyager (643), Skyvern Web Bench (5,750) all score "did the agent finish the shopping flow," not "did the agent catch the regression." Your three bundles are scored on the *opposite* axis:

- `web-qa` and `quality-engineering`/Quinn → **bug-finding** (recall/precision of defects).
- `test-automation` → **test-generation quality** (does the generated test fail on the bug and pass on the fix; does it kill mutants; does it avoid masking defects).

So there is no drop-in benchmark. What you can reuse:

| Reuse from research | For what |
|---|---|
| **Self-hosted deterministic fixtures** — RealWorld/Conduit, OWASP Juice Shop, Sauce Demo, TodoMVC, the-internet | The app-under-test substrate. NOT live sites (WebVoyager/Online-Mind2Web are uncontrollable — fatal for a versioned eval). |
| **SWT-bench** paradigm (golden-fix-as-oracle: a test counts only if it goes fail→pass when the fix lands) | Scoring `test-automation`'s generated tests. |
| **Mutation score** (PIT/StrykerJS; MutGen) as the *strong* test-quality metric; **coverage is a weak proxy** (TestEval: ~98% line coverage coexists with TestGenEval's ~19% mutation score) | Grading `test-automation` suite quality. |
| **RegMiner** regression-triple model (works → regressed → fixed) | The version-axis ground truth. |
| **ST-WebAgentBench**'s policy-violation scoring (Risk Ratio, Completion-Under-Policy) | The closest paradigm to "did the agent do something wrong" → adapt for **defect-masking** and **false-alarm** scoring. |
| **WebJudge / WebVoyager GPT-4V judge** (~85% human agreement) + **Anthropic "Demystifying evals"** (pass@k vs pass^k, outcome-vs-trajectory, calibrate judges, read transcripts) | The scoring methodology. |
| **Jason Arbon's 2026 seeded-bug eval** (seeded bugs + LLM-judge match → precision/recall/F1, offline-reproducible) | The single closest *published blueprint* — but it's 43 bugs on 3 static pages; you extend it with a running app and a version axis. |
| **Inspect AI** (Dataset/Solver/Scorer + sandboxing + epochs) or **BrowserGym/AgentLab** | The harness backbone (lives in a dev-only space — see §7). |

**The version axis is genuinely novel.** The 2026 "LLM-Based Test Generation Under Software Evolution" paper confirms robustness-across-versions is an open, under-measured problem. Your benchmark would extend the state of the art, not reproduce it.

---

## 1. What to measure — per bundle

Every metric below is computed against a fixture with **known ground truth** (a fault manifest, §2). Each run produces a structured artifact the harness already gets for free: `web-qa` emits the per-TC JSON executor schema (`tc_id/result/failure_step/...`) plus the Test Run Report; `quality-engineering`/Quinn emits p0–p3 findings (`priority/confidence/evidence/affected pages`); `test-automation` emits a PR-ready diff + a Run Report with an AFS classification. The harness parses these, so they are your scoring surface.

### 1a. `web-qa` (live manual QA — author cases, run via Playwright MCP, report)

| Metric | Definition | Source |
|---|---|---|
| **Bug recall** | seeded faults detected / total seeded faults on the build. A fault is "detected" if a `FAIL`/`BLOCKED` TC or a `Defects Found` item maps to a known fault ID (matcher in §4). | Run Report + executor JSON |
| **Precision (1 − false-positive rate)** | true detections / (true + false detections). A `FAIL` on the **clean** build, or a `FAIL` that maps to *no* seeded fault, is a false positive. This is the most important guardrail — a tester that cries wolf is worse than useless (cf. ST-WebAgentBench Risk Ratio). | run on clean build |
| **Steps-to-find / actions-to-find** | tool-call count (Playwright MCP actions) before the first true detection. Lower is better. Pulled from `tool_uses` in the executor JSON. | executor JSON |
| **Severity-calibration error** | mean abs diff between agent-assigned severity (High/Med/Low) and ground-truth severity, over matched faults. Penalizes both inflation and deflation. | Defect Severity table |
| **Report-quality score** | LLM-judge rubric (0–3 per dimension: reproduction steps present, evidence/screenshot attached, expected-vs-actual stated, severity justified). Held to the bundle's own `test-run-report-format.md`. | Test Run Report |
| **Coverage of the charter** | fraction of the assigned task suite (TC IDs) actually executed (`PASS`+`FAIL`, not `BLOCKED`/skipped). Distinguishes "found nothing because clean" from "found nothing because gave up." | executor JSON |

### 1b. `test-automation` (TMS case → merged framework-resident automated test)

This bundle's deliverable is *code*, so it gets the strongest, most objective oracle — the SWT-bench dual-run.

| Metric | Definition | Source |
|---|---|---|
| **Good-build pass rate** | generated test compiles AND passes on the *clean* build. | execute generated test |
| **Defect-build fail rate (the SWT-bench S signal)** | the *same* test **fails** on the seeded-defect build and **passes** on the clean build (fail-to-pass on the fault). This is the core "did the test actually catch the bug" signal. | dual-run vs §2 matrix |
| **Mutation kill rate** | run StrykerJS (JS/TS) / PIT (Java) / mutmut (Python) against the consumer framework, score killed/total mutants of the lines the case covers. The *strong* quality metric (MutGen: 89% vs vanilla-LLM 70–78%; coverage alone is misleading). | mutation tool |
| **Defect-masking rate** | fraction of generated tests that *pass on the buggy build* by asserting the buggy behavior (e.g. `expect(total).toBe(WRONG_VALUE)`), or by weakening assertions / wrapping in try-catch / removing the failing check. This directly enforces the bundle's hard rule "never mask product defects." Detected by: test passes on a build the fault-manifest says should fail it. (ST-WebAgentBench Risk-Ratio analog.) | dual-run + AST lint |
| **Locator-robustness across versions** | a test authored on version V_n is re-run unchanged on V_{n+1} (cosmetic-refactor build, §2). Score = % still passing without edits. Measures the "locator ladder / no brittle selectors" rule. | cross-version re-run |
| **No-sleep / quality-lint compliance** | static checks: zero `sleep()`/`waitForTimeout(<n>)`, locator ladder respected, no disabled assertions. Deterministic AST/regex lint. | AST lint of diff |
| **Review-gate pass rate** | fraction of implementer outputs the reviewer slot (qa-engineer/Tal merge gate) correctly accepts/rejects vs. a labeled set of good and deliberately-bad diffs (planted masking, planted sleep). Measures the *reviewer* persona, not just the implementer. | reviewer verdict vs label |
| **R2-cap / escalation correctness** | on `un-automatable`/`defect-found` cases, did the pipeline correctly classify and escalate instead of forcing a green test? | AFS classification |

### 1c. `quality-engineering` / Quinn (dimensional product-quality audit)

Quinn produces a *ranked p0–p3 finding list across dimensions* (a11y/WCAG, security/OWASP, privacy/GDPR, perf/CWV, responsive, content/SEO, UX, persona). Ground truth is a **curated issue list** with a dimension tag per item.

| Metric | Definition | Source |
|---|---|---|
| **Per-dimension recall** | seeded findings detected / seeded total, **bucketed by dimension**. Reported as a matrix (rows = dimension, cols = recall/precision) — this is the "coverage matrix completeness" the user wants. Reveals if an edit helped security but broke a11y. | findings vs manifest |
| **p0/p1 precision** | of findings the agent ranked p0/p1, fraction that are real and genuinely p0/p1 in ground truth. The high-severity slice is what stakeholders act on; false p0s are expensive. | findings |
| **False-alarm rate** | findings on the clean build that map to no seeded issue, weighted by claimed priority (a fabricated p0 hurts more than a fabricated p3). | clean-build run |
| **Evidence-discipline score** | the bundle requires every finding to cite an axe violation ID / screenshot / network trace / cookie. Deterministic check: does each finding carry a parseable evidence artifact? Findings without evidence are downgraded (matches the skill's "if you can't prove it, lower confidence; never fabricate"). | finding schema |
| **Coverage-matrix completeness** | did Quinn run all *applicable* specialists per the conditional-activation table (forms→ux-audit, EU content→privacy, etc.)? Score = applicable-specialists-run / applicable-specialists-expected. Catches "agent silently skipped accessibility." | report specialist list |
| **Dedup correctness** | the same issue on N pages must be ONE finding. Score penalizes both under-merge (N copies) and over-merge (two distinct issues collapsed). | findings |
| **Confidence calibration** | Brier-style: correlation between stated confidence (the `[p0 9/10]` score) and whether the finding is real. | findings |

> Note on `quality-engineering`: there are TWO sub-flows — Quinn's automated dimensional audit (browser-verify/CDP-driven, deterministic to harness) and the *manual* QE discipline (scout/ba/PM authoring requirement-traced cases). Phase the eval on Quinn first (objective, single-agent, evidence-bearing); the manual-discipline flow needs requirement→case→result traceability scoring which is a Run-phase extension.

---

## 2. Ground truth & fixtures — the fault-injected version matrix

### 2a. Which fixtures to pin (and why)

Pin **self-hosted, deterministic** apps. Layer by purpose (directly from the research):

| Fixture | Role in the eval | Why this one |
|---|---|---|
| **RealWorld / Conduit** (gothinkster) — Medium-clone, auth+CRUD+social, one fixed API spec, 100+ implementations + conformance suite | **Primary fixture** for `web-qa`, `test-automation`, cross-version. | One frozen spec → many implementations/git-revisions act as "app versions"; the published spec is requirement ground truth; non-trivial (beats toy apps). |
| **OWASP Juice Shop** | Security/privacy slice for **Quinn**. | Built-in auto-verifying scoreboard = machine-checkable ground truth with severity labels. *Caveat: known-challenge set may be in LLM training data → contamination. Use mainly to seed YOUR own mutated variants, not as-is.* |
| **Sauce Demo (Swag Labs)** | Cheap smoke fixture; `problem_user`/`performance_glitch_user` are pre-documented seeded defects (broken images, mis-sort, latency); `standard_user` = clean baseline. | Zero setup, ready-made known-bug personas — perfect for the Crawl phase. |
| **TodoMVC** | Cleanest substrate for `test-automation` mutation experiments + locator-robustness across frameworks. | ~50 implementations of one minimal spec → controlled cross-version test-transfer. |
| **the-internet** (saucelabs) | Flakiness/robustness stress fixture (dynamic loading, tricky DOM). | Designed to be flaky → stress the agent's selector resilience and your variance handling. |

Do **not** use WebVoyager/AssistantBench/GAIA-style live sites: uncontrollable, non-reproducible across versions.

### 2b. The version matrix (the novel contribution)

For each fixture, produce a **build matrix** as git revisions in a vendored fixtures repo, modeled on RegMiner's regression triple:

```
fixtures/realworld/
  v-clean/            ← golden, no seeded faults (the baseline — precision oracle)
  v-bug-001/          ← exactly ONE seeded fault (isolation: maps to one fault ID)
  v-bug-002/
  ...
  v-multi-A/          ← a curated bundle of N faults (realistic audit)
  v-refactor/         ← clean behavior, cosmetic DOM/selector churn → locator-robustness
  v-regression-007/   ← RegMiner-style: passes on v-clean, fails on this, fixed in v-fix-007
```

**How to inject faults** (control ground truth + defeat training-data contamination):
- **Functional faults** — hand-authored one-line mutations (off-by-one in cart total, broken redirect, swallowed validation error, 500 on edge case). One fault per `v-bug-NNN` build keeps recall attributable.
- **Dimensional faults** for Quinn — remove `alt` text (a11y), drop a CSP/security header (OWASP), add a non-consented tracking cookie (GDPR), inflate an image to break LCP (perf/CWV), break a mobile breakpoint (responsive), introduce a misleading CTA (UX).
- **Mutants** for `test-automation` quality — generated by StrykerJS/PIT/mutmut, not hand-authored; used only for mutation-kill scoring.

### 2c. Encoding the expected-findings ground truth

One YAML manifest per build, machine-checkable. This is the contract the scorer matches against:

```yaml
# fixtures/realworld/v-bug-001/fault-manifest.yaml
build: realworld@v-bug-001
base: realworld@v-clean
faults:
  - id: F-001
    dimension: functional          # functional|security|privacy|a11y|perf|responsive|content|ux
    severity: high                  # critical|high|medium|low  (maps to p0..p3 for Quinn)
    location: "cart total calculation"
    repro: "Add 2 items priced 10.00 → total shows 30.00 (off-by-one × first item)"
    oracle:                         # deterministic checker (preferred over LLM)
      type: dom-assert
      url: "/cart"
      selector: ".cart-total"
      expect_clean: "$20.00"
      expect_buggy: "$30.00"
    match_keywords: ["total", "cart", "price", "sum"]   # fuzzy fallback for LLM matcher
    swt:                            # for test-automation dual-run
      fails_on: [v-bug-001]
      passes_on: [v-clean]
expected_clean_findings: 0          # precision oracle: clean build => zero true faults
```

The manifest doubles as: (a) the recall/precision oracle, (b) the SWT-bench dual-run spec for `test-automation`, (c) the dimension/severity labels for Quinn's coverage matrix.

---

## 3. Task suites — deterministic enough to score

A **task** = (fixture build, bundle entrypoint prompt, charter, ground-truth manifest). Keep prompts fixed and versioned (the "golden dataset" pattern). Three families:

### 3a. `web-qa` task
- **Input:** a frozen authored test suite (`tasks/<suite>/TC-*.md` in the bundle's own format) — author it **once** against `v-clean`, vendor it, reuse across all builds. (Do NOT let the agent re-author per run; that adds variance. Author-quality is a *separate* sub-task you can score independently.)
- **Charter prompt (fixed):** "Run the smoke suite in `tasks/smoke/` against `{base_url}` via Playwright MCP and produce a Test Run Report."
- **Determinism levers:** pin `base_url` to the local fixture; seed the DB to a fixed state (RealWorld ships fixtures); pin the Playwright MCP version; run accessibility-tree snapshot mode (not vision) to cut flakiness (per the research note on Playwright MCP).

### 3b. `test-automation` task
- **Input:** a TMS case in markdown adapter format (the bundle supports a markdown TMS), targeting a behavior that the seeded fault breaks.
- **Charter prompt (fixed):** "Automate TC-NNN into the project's Playwright framework."
- **Scoring is fully objective** via dual-run + mutation — minimal judge needed. This is your highest-signal, lowest-noise suite; build it first.
- **Reviewer sub-suite:** feed the reviewer slot a labeled set of pre-written diffs (5 honest, 5 with planted masking/sleeps) → score accept/reject.

### 3c. `quality-engineering` / Quinn task
- **Charter prompt (fixed):** "Run a full quality audit of `{base_url}` and produce the ranked p0–p3 report."
- **Determinism levers:** `browser-verify` CDP is already deterministic-ish (headless Chrome pinned); freeze the page (no live third-party scripts — self-host everything); pin Node + axe-core version (axe is the deterministic backbone of a11y findings).

**General determinism rules (apply to all):** local fixtures only; seeded DB state; pinned tool/MCP/axe versions; temperature 0 *as a variance-reducer, not a reproducibility guarantee* (see §5); fixed charter prompts vendored in the harness; one-fault-per-build for attributable recall.

---

## 4. Scoring — deterministic first, LLM-judge as fallback, kept honest

Two-layer scheme (directly from the cross-stream takeaway: execution-based validators are primary, LLM judge is secondary):

### Layer 1 — Deterministic checks (the oracle, trust these)
- **`test-automation`:** dual-run (compile+pass on clean, fail on bug), mutation-kill via Stryker/PIT, AST lint (no sleeps, locator ladder, no disabled asserts), masking detector (passes on a build it must fail). **No LLM needed.**
- **Quinn:** axe violation IDs, presence of security header, cookie enumeration, LCP/CLS numbers, `alt`-attribute presence — all programmatic. Evidence-discipline and coverage-matrix are parse-and-count.
- **`web-qa`:** DOM-assert oracles from the manifest verify whether the seeded fault is actually observable; the executor JSON gives PASS/FAIL/steps deterministically.

### Layer 2 — LLM-as-judge (only where output is free-text)
Needed for: **finding↔fault matching** (does this prose finding describe fault F-001?), **report-quality rubric**, **severity justification**. Use the WebVoyager/WebJudge protocol (~85% human agreement). Rules to keep the judge honest (from Anthropic "Demystifying evals" + MT-Bench):
- **Structured per-dimension rubric, not a holistic 1–10.** Each dimension 0–3 with explicit anchors. Provide an **"Unknown" escape hatch** so the judge abstains instead of hallucinating a match.
- **Pairwise for ranking versions** (prompt A vs prompt B on the same task) — relative judgments are more reliable; **mitigate the ~33% position-bias flip rate by scoring both orders and counting only order-consistent verdicts.**
- **Calibrate against a human-labeled subset** before trusting any judge number for gating. Re-calibrate when you change the judge model.
- **Read transcripts.** Anthropic's rule: failures should "seem fair." Keep every transcript (Inspect View / your own JSONL) and sample them.
- **Judge ≠ subject model family** where possible, to reduce self-preference bias.

### Combining into a score
Per task, per build: compute the metric vector (§1). **Do not collapse to one number** — report the vector and the **per-dimension matrix** for Quinn. For trend/gating, define a small set of **headline metrics per bundle** (e.g. `test-automation`: defect-build-fail-rate + mutation-kill − masking-rate; `web-qa`: recall + precision − false-positive; Quinn: macro-averaged per-dimension F1 + p0/p1 precision). Track outcome AND trajectory separately (Anthropic): a high outcome on a lucky run with a terrible trajectory is a yellow flag, not a pass.

---

## 5. Nondeterminism & variance — how many runs, and is a change a real regression?

**Temperature 0 does NOT give reproducibility on hosted APIs** (research: arXiv 2408.04667 found up to ~15% accuracy swings and ~70pp best-vs-worst gaps at temp 0; Thinking Machines Lab showed 80/1000 unique completions from batch variance). So a single run is meaningless.

**Run policy:**
- **N = 5–10 runs per (task × build × host)** as "epochs" (Inspect AI has this primitive). Start at N=5 for Crawl, N=10 for the gating suite.
- **Report pass@1 (estimated from the N runs), pass^k, and a variance band** (median + IQR), not a point estimate.
- **Use pass^k as the headline reliability metric, not pass@k.** A QA agent that catches the regression 1 time in 3 is unshippable. Research math: a 70% single-attempt agent gives pass@3 ≈ 97% but **pass^3 ≈ 34%** — that 63pp gap is exactly the consistency you must measure. Report `pass^3` (catches it every time in 3) per fault.
- **Flake control:** median-of-N for binary outcomes (the golden-dataset CI practice); a fault counts as "reliably caught" only if pass^3 ≥ threshold.

**Regression vs noise decision rule:**
1. Establish a **baseline distribution** for each headline metric from the current `main` (N runs, stored).
2. On a change, re-run; compute the new distribution.
3. Flag a **regression** only if the new median falls below baseline median by more than the **baseline IQR band** AND a bootstrap/Mann-Whitney check over the N runs is significant (p < 0.05). This separates a real drop from stochastic flutter.
4. **Power/sample-size note** (from the golden-dataset research): to detect a ~5% effect at 95% confidence you need on the order of ~200+ samples *per scenario* — so the *gating* suite must aggregate many task×build cells, not rely on one task. Crawl phase intentionally under-powers and only *reports*; it does not gate.

---

## 6. Cross-host & cross-version matrix — without exploding cost

The naive matrix is `hosts(4) × builds(~10) × tasks(~15) × bundles(3) × N(5–10)` = thousands of agent runs per change. Tame it with tiers + smart pruning:

### Decouple the two axes — they answer different questions
- **App-version axis** answers "is the *agent* robust as the app drifts?" Run on **one canonical host (Claude Code)** only. This is most of your value and most of your cost; do not multiply it by hosts.
- **Host axis** answers "does the bundle behave the same once `init.mjs` flattens it into Copilot `.agent.md` / Codex TOML / Cursor dir?" This is a **portability/parity check**, not a quality re-measurement. Run it on a **tiny smoke subset** (1–2 tasks × clean + 1 bug build) per host. The thing you're testing here is the *installer's flattening* (`flattenAgentForCopilot`, `writeCodexAgent`, `injectSkillsSection`) — does the same agent, installed natively per host, still find the planted bug at all. Parity, not leaderboard.

### Cost levers
- **Tiered suites:** `smoke` (3–5 tasks, N=3, runs on every PR, ~minutes) → `full` (all tasks×builds, N=10, nightly/weekly or on agent-prompt changes) → `host-parity` (smoke × 4 hosts, on installer changes only).
- **Change-scoped runs:** the harness reads the git diff. Edited only the `accessibility-audit` skill? Run only Quinn's a11y-dimension tasks + a smoke regression on adjacent dimensions. Edited `test-automation-workflow`? Run the `test-automation` suite. Map skill/agent/briefing → affected tasks in a `coverage-map.json`. (This is the change-driven re-run the user asked for.)
- **Parallelism:** Inspect AI epochs / AgentLab's ray-joblib parallel runs; the Windows-Agent-Arena pattern (Azure-parallelized, full suite ~20 min) is the scaling template if you outgrow a laptop.
- **Host axis is cron-gated, not PR-gated** — installer flattening rarely changes, so re-run host-parity only when `bin/init.mjs` or hook templates change.

---

## 7. Harness architecture & CI — and how it coexists with the stdlib-only installer rule

### The hard constraint and the clean resolution
`bin/init.mjs` must stay **plain ESM Node, stdlib only, zero deps** — that is sacred. **The eval harness is a separate, dev-only workspace that the installer never touches and never ships.** Call this out explicitly: the harness MAY use dependencies (Playwright, Inspect AI, Stryker) because it lives outside the distribution surface and is never copied into a consumer's tree.

### Layout
```
eval/                          ← NEW top-level, dev-only, NOT in any bundle/skill, NOT installed
  package.json                 ← its OWN deps (playwright, @inspect-ai/*, stryker, etc.)
                                  → eval/node_modules is git-ignored; eval/ is excluded from
                                    init.mjs content discovery (it scans agents//skills//bundles/)
  fixtures/                    ← vendored apps + version matrix + fault-manifest.yaml (§2)
    realworld/  juice-shop/  saucedemo/  todomvc/
  suites/                      ← fixed charter prompts + task defs (the golden dataset, §3)
    web-qa/  test-automation/  quality-engineering/
  harness/                     ← runner: installs a bundle into a throwaway target dir via
    run.mjs                      `node ../bin/init.mjs init --bundle X --target Y`, dispatches
    score/                       the charter, captures artifacts, scores (§4)
    matchers/  judges/  oracles/
  coverage-map.json            ← skill/agent/briefing → affected tasks (§6 change-scoping)
  baselines/                   ← stored result distributions per metric per main commit (§5)
  results/                     ← per-run JSONL transcripts + scored vectors (git-ignored or LFS)
```

**Why this respects every house rule:**
- The installer's content discovery globs `agents/`, `skills/`, `bundles/` — `eval/` is none of those, so it is never installed or distributed.
- `npm test` (root) stays `node --test` over `*.test.mjs` and stays dependency-free. The harness's *unit tests* (matchers, manifest parser, scorer math) ARE plain `*.test.mjs` and run under root `node --test` with **zero deps** — only the *agent-running* part needs Playwright/Inspect, and that runs via `cd eval && npm run eval`, never in the stdlib test path.
- CI already validates bundles + agentskills spec; the eval is a **separate workflow** (`.github/workflows/eval.yml`) on a schedule + manual-dispatch + a label trigger, so it never blocks the fast validate job.

### How it's invoked
```bash
# from eval/
npm run eval -- --bundle test-automation --suite smoke --host claude --builds clean,bug-001 --n 5
npm run eval -- --bundle quality-engineering --suite full --diff HEAD~1   # change-scoped (§6)
npm run eval -- --host-parity --bundle web-qa                            # installer flattening parity
```
The runner uses the **real installer** (`bin/init.mjs init --bundle ... --target ...`) into a temp dir so you measure the *actually-installed* agent, including per-host flattening — not the source files. This is what makes the cross-host axis meaningful.

### Results storage & comparison over time
- Each run → JSONL transcript + a scored `result.json` (metric vector, pass^k, costs/tokens/tool-calls per Anthropic & HELM efficiency-as-first-class).
- `baselines/<metric>.json` holds the current-`main` distribution. A `compare.mjs` diffs new-vs-baseline using the §5 decision rule and prints a verdict table.
- Track **cost/latency/tokens** alongside quality (HELM treats efficiency as first-class; Anthropic lists turn-count, tool-call-count, tokens). A quality win that doubles token spend is a real trade-off the maintainer should see.

### Gate or report?
- **Crawl/Walk: report only.** Post a comment on the PR with the metric delta table; never block merges (the suite is under-powered and the agents are stochastic).
- **Run: gate the high-signal, low-noise metrics only** — `test-automation`'s defect-build-fail-rate and masking-rate (deterministic, reliable). Gate on a *significant* regression per §5, with median-of-N flake control. Leave LLM-judged metrics (report quality) as advisory.

---

## 8. Crawl / Walk / Run roadmap

### Crawl — minimum viable, highest signal per effort
Target the **`test-automation` bundle on one fixture, one host, deterministic scoring only** — because it needs *no LLM judge* (dual-run + mutation are objective), giving you a trustworthy first number.
- 1 fixture: **TodoMVC** or RealWorld. 3 builds: `v-clean`, `v-bug-001` (one functional fault), `v-refactor` (locator-robustness).
- 1 task: "automate TC-001 into the Playwright framework."
- Scoring: good-build-pass, defect-build-fail (SWT-bench-style), masking-rate, no-sleep lint. N=5, report pass^3.
- Output: a printed delta table vs a stored baseline. No CI gating yet.

### Walk
- Add **`web-qa`** (manual run + report) and **Quinn** dimensional audit on **OWASP Juice Shop + RealWorld** with a real fault matrix (5–8 single-fault builds + 1 multi-fault).
- Add the **LLM-judge layer** (finding↔fault matcher + report-quality rubric), calibrated against a small human-labeled set; pairwise mode for version comparison with order-swap.
- Add **mutation scoring** (StrykerJS) for `test-automation`.
- Wire **change-scoped runs** (`coverage-map.json`) and the **nightly `eval.yml`** workflow that posts a PR comment (report-only).

### Run — the full thing
- Full version matrix per fixture incl. RegMiner-style regression triples; **cross-host parity** smoke across Claude/Copilot/Cursor/Codex via the real installer; power-sized gating suite; baseline distributions + significance-tested regression gating on the deterministic metrics; cost/token tracking; optionally build on **Inspect AI** (Dataset/Solver/Scorer + epochs + Inspect View transcripts) or **BrowserGym/AgentLab** rather than hand-rolling the run loop.

### Concrete FIRST step — do this week
1. `mkdir eval && cd eval && npm init` with its own `package.json` (deps allowed here only); add `eval/node_modules` to `.gitignore`; confirm `bin/init.mjs`'s content discovery ignores `eval/` (it globs only `agents/`/`skills/`/`bundles/`).
2. Vendor **TodoMVC** (or one RealWorld impl) and hand-create exactly **two builds**: `v-clean` and `v-bug-001` (one obvious functional fault, e.g. "completed todos don't get the `completed` class"). Write its `fault-manifest.yaml` (§2c).
3. Write one stdlib-only `*.test.mjs` for the **manifest parser + dual-run scorer math** so it runs under root `node --test` immediately (proves the scoring core with zero deps).
4. Run the `test-automation` bundle once by hand via `node bin/init.mjs init --bundle test-automation --target claude` into a temp dir, dispatch "automate the todo-toggle case," and **manually score** the resulting diff against the manifest (does it pass on `v-clean`, fail on `v-bug-001`, contain no `waitForTimeout`?).

That single end-to-end pass — install → dispatch → dual-run score — validates the whole architecture on the cheapest, most objective bundle, and everything else (more builds, web-qa, Quinn, LLM judge, hosts, CI) is additive on top of it.

---

### Key citations grounding this design
Bug-finding ≠ task-completion gap, and the closest blueprints: **Arbon 2026 seeded-bug eval** (precision/recall/F1, offline), **SWT-bench** (fail-to-pass golden-fix oracle), **ST-WebAgentBench** (policy/Risk-Ratio → masking & false-alarm). Fixtures: **RealWorld/Conduit, OWASP Juice Shop, Sauce Demo, TodoMVC, the-internet**; version axis from **RegMiner** + **SWE-bench-Live** (contamination-free moving target) + **"Test Generation Under Software Evolution"** (open problem). Quality metric: **mutation score** (PIT/StrykerJS, MutGen) over coverage (TestEval vs TestGenEval gap). Methodology: **pass@k vs pass^k** (consistency), **temp-0 non-determinism** (arXiv 2408.04667, Thinking Machines), **LLM-as-judge** (WebVoyager/WebJudge ~85%, MT-Bench position bias), **Anthropic "Demystifying evals"** (outcome vs trajectory, read transcripts, efficiency metrics), **golden-dataset CI gating** (median-of-N, power sizing). Harness backbone: **Inspect AI** (Dataset/Solver/Scorer, epochs, sandboxing) or **BrowserGym/AgentLab**; **Playwright MCP** as the constant execution substrate. All file paths above are under `` (proposed new `eval/` dir; existing scoring surfaces: `bundles/web-qa/knowledge/test-run-report-format.md`, `bundles/quality-engineering/skills/quality-audit-workflow/SKILL.md`, `bundles/test-automation/skills/test-automation-workflow/SKILL.md`).
