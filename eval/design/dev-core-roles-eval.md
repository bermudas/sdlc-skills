# Eval Harness Design — DEV + CORE Roles (sharing the QA bundle's harness)

## 0. Framing for THIS repo

This repo ships **templates**, not runtime code. Agents/skills are installed into a consumer project and run *there*. So the eval harness is itself a **new bundled artifact** that lives in this repo (proposed `eval/`), is **not** installed into consumers by `bin/init.mjs`, and runs in CI + locally against *throwaway fixture repos* the way `node bin/init.mjs init --bundle … --target …` already exercises the installer against a throwaway dir.

The unit of measurement is: *install agent X (a specific AGENT.md/SOUL.md/skill/briefing version) into fixture repo R at version V on host H, give it a task, score the result deterministically + by judge.* The user's goal — "edit a prompt → re-run → better-or-worse, across hosts and versions" — is exactly a regression harness keyed on `(agent_version, fixture@version, host)`.

**Anchor everything to the QA sibling's spine.** The QA harness already (per the brief) defines: seeded-fault apps, deterministic check + LLM-as-judge scoring, `pass^k` variance, a cross-host/version matrix, and CI gating. The DEV+CORE design below **adds role suites to that one runner** rather than forking a second harness. Where the QA harness owns a primitive (fixture repos, judge plumbing, matrix runner), DEV+CORE *consume* it.

Proposed layout (one runner, many suites):

```
eval/
  runner.mjs              # ONE entrypoint: eval/runner.mjs --suite <role> --fixture <id> --host <h> --k <n>
  spine/
    deterministic.mjs     # test-runner adapters: pytest, vitest/jest, swift test, go test → fail-to-pass/pass-to-pass
    judge.mjs             # LLM-as-judge: rubric in, {score, rationale, citations} out; double-judge + self-consistency
    passk.mjs             # pass^k / pass@k aggregation, CI bands (shared with QA)
    matrix.mjs            # (agent_version × fixture@version × host) expansion; reuses QA matrix
    report.mjs            # JSON + markdown scorecard; trend vs baseline
  fixtures/               # the seeded-fault repos — SHARED with QA (see §7)
    <fixture-id>/
      repo/               # the app at a pinned commit
      faults/             # seeded faults: diff + metadata + oracle tests (QA-owned, DEV-reused)
      facts/              # hand-labeled ground-truth fact set (scout)
      tasks/              # per-role task specs (issue text, story, plan-reference, etc.)
  suites/
    coding.mjs            # js-dev, python-dev
    ios.mjs               # ios-dev
    techlead.mjs          # review / decomposition / RCA
    ba.mjs                # story authoring
    pm.mjs                # orchestration / merge-gate
    scout.mjs             # onboarding-doc fact recall
    assistant.mjs         # personal-assistant tool-use
  baselines/              # committed scorecards per agent_version (regression deltas computed against these)
```

`runner.mjs` is plain ESM Node, stdlib-only — same constraint as `bin/init.mjs`. Test execution and Python judge calls shell out (already precedented: CI installs Python `skills-ref`).

---

## 1. Coding agents — js-dev (Jay) + python-dev (Py)

These two have the **most mature public benchmarks**, so they anchor the whole effort and validate the spine before the squishier roles use it.

### 1a. The benchmark spine (what to adopt, in priority order)

The research is blunt: **SWE-bench Verified is saturated and contamination-inflated** (The SWE-Bench Illusion, arXiv 2506.12286 — 3–6× better in-bench localization; UTBoost found ~41% of Lite and ~24% of Verified mis-scored; OpenAI deprecated Verified Feb 2026). Do **not** make Verified the headline.

Concrete spine, tiered:

- **Primary realistic signal — SWE-bench Pro (arXiv 2509.16941).** Contamination-resistant by design (copyleft legal barrier + private repos), and mid-2026 public tops out ~59% vs ~88–94% on Verified — it has real headroom, so prompt edits actually move the number. Use the **public set (731)** as the external reference point; we cannot run the commercial set.
- **Cross-language signal for Jay — Multi-SWE-bench (arXiv 2504.02605, JS+TS slice) + SWE-bench Multilingual (JS/TS slice of 300).** These are the *only* mature repo-level real-issue sets that isolate Jay's JS/TS stack. Verified is Python-only and does nothing for Jay; do not pretend it does.
- **Contamination-controlled trend line — LiveCodeBench (arXiv 2403.07974) date-windowed + SWE-bench-Live (arXiv 2505.23419, monthly refresh, post-2024 issues).** Score only on **post-model-cutoff windows** so a higher number reflects generalization, not memorization. LiveCodeBench is algorithmic/toy (use as a *floor/leading indicator*, not as evidence of real-repo competence).
- **Edit-application realism — Aider polyglot (225 Exercism, 2-attempt loop, JS + Python lanes).** Our agents *edit in place*; Aider's two-attempt edit loop + well-formed-diff metric is the closest public proxy for "did the agent apply a clean diff." Adopt its `pass_rate_2` and edit-format adherence as secondary metrics.
- **Sanity floor only — BigCodeBench (1,140 tasks / 139 libs) + HumanEval+/MBPP+.** Use as a regression *floor*: if a prompt edit tanks these, something broke badly. Never headline them.

**Why not just run the public leaderboards?** Because we're not benchmarking a *model* — we're benchmarking *our agent prompt+skill+briefing layer on top of a model.* The public numbers are a calibration reference; the load-bearing signal is our **in-repo fixture set** (below), which we control for contamination and can version alongside the agents.

### 1b. Contamination handling (so prompt edits aren't gamed)

This is the single most important design decision and the research mandates it:

1. **Held-out, never-published fixtures.** The in-repo fixture issues live in this private repo and are *never* posted to a leaderboard or pasted into a public model. Treat them like SWE-bench Pro's commercial set: access barrier = contamination barrier.
2. **Time-windowing.** Every fixture fault records `introduced_date` and `model_cutoff_at_capture`. The reporter flags any fixture whose source issue predates the evaluated model's cutoff as "contamination-suspect" and excludes it from the headline number (keeps it as a secondary).
3. **Rotating refresh.** Mirror SWE-bench-Live's discipline: each quarter, retire ~20% of fixtures and mint new ones from *recent* upstream issues. A baseline that only ever improves on a frozen set is the memorization smell.
4. **Mutation-perturbed variants (borrow from the QA mutation-kill machinery).** For each fixture, the QA harness can already mutate the app; reuse that to produce *paraphrased/renamed* variants of the same fault so a memorized fix doesn't transfer. Score the delta between canonical and perturbed — a large drop = memorization, exactly the Illusion paper's signal.

### 1c. The in-repo fixture set (the real deliverable)

A **small (~15–25), high-signal** set of real fail-to-pass issues per language. Quality over quantity (τ-bench's explicit design philosophy). Each fixture:

```
fixtures/<id>/
  repo/                       # app pinned at commit C (the QA seeded-fault app doubles here — §7)
  tasks/issue.md              # the GitHub-issue-style prompt the agent receives
  faults/<f>/
    state.before              # commit that exhibits the bug
    oracle/                   # FAIL_TO_PASS + PASS_TO_PASS test sets (the SWE-bench contract)
    meta.json                 # {language, framework, introduced_date, difficulty, files_touched_gold}
```

Sourcing strategy, in order of preference:
- **Reuse QA's seeded faults.** A seeded fault already has a known-bad diff + an oracle test. For a coding eval, hand the agent the *symptom* (failing test or bug report) and require it to produce a patch that flips FAIL_TO_PASS green while keeping PASS_TO_PASS green. Same fixture, different prompt. (This is the core of §7.)
- **Mine recent upstream issues** for our target frameworks where public sets are thin — the research's explicit gaps: **React/Next.js app work and FastAPI/FastMCP server work have NO public benchmark.** These are exactly Jay's and Py's domains, so a handful of hand-built FastAPI-endpoint and Next.js-RSC/hydration fixtures are *mandatory custom work* — no benchmark substitutes here.
- **Commit0 (arXiv 2412.01769) as the from-scratch/TDD template** for Py: spec + interactive test suite → implement a module. Borrow its *shape* (~6% full-dataset SOTA = nowhere near saturated) for a couple of "build this FastMCP server to pass the provided contract tests" fixtures.

### 1d. Metrics (deterministic spine + cost)

Per fixture, per `k` trials:
- **Resolved %** — FAIL_TO_PASS all pass AND PASS_TO_PASS all still pass (the SWE-bench gating contract).
- **fail-to-pass rate** — fraction of designated failing tests now passing.
- **regressions introduced** — count of PASS_TO_PASS tests the patch broke (false-fix detector; this is what UTBoost showed leaderboards miss).
- **tests-pass-on-fix** — for our TDD agents specifically: did the agent *write a new test that fails before the fix and passes after*? The research is emphatic that **no public benchmark grades TDD-as-process** (all grade against pre-written hidden tests). So we instrument it ourselves: run the agent's *added* test against `state.before` (must fail) and `state.after` (must pass). This is a custom, high-value metric the public world lacks.
- **edit-format adherence** — well-formed-diff rate (Aider-style).
- **cost/tokens** and **wall-clock** — captured by the runner per trial (BFCL tracks both; cheap to log, essential for "is the new prompt worth it").

---

## 2. ios-dev (Io) — acknowledge the GAP, go fixture-only

The research verdict is unambiguous: **iOS/Swift repo-level coding is a real benchmark gap.** The only repo-level Swift agent benchmark is **SWE-Bench Mobile (arXiv 2602.09540)** — 50 tasks, *one* ~500K-LOC codebase, best agent ~12%, brand new. Function-level proxies (**SwiftEval** — 28 hand-crafted problems; **MultiPL-E** Swift port, known-buggy; **McEval** Swift slice) cover none of SwiftUI/SwiftData/Combine/async-await app idioms.

**Decision: do not chase a public Swift benchmark. Build a fixture-based eval, ground truth = the Swift toolchain.**

- **Same fixture contract as §1c**, ground-truth oracle = `swift test` (swift-testing / XCTest) for logic + **XCUITest** for UI-level faults. The QA bundle already swaps Playwright→XCUITest/Appium in `team-ios`, so the runner's deterministic adapter for XCUITest is *shared* with QA, not new.
- **Seed Swift bugs** that target Io's declared specialties (his skills: `swiftui-pro`, `swiftdata-pro`, `swift-testing-pro`, `swift-concurrency-pro`): a SwiftData migration fault, a SwiftUI state/`@Observable` re-render fault, a structured-concurrency data race (the SwiftEval finding — models crater on Swift-*specific* features — tells us exactly where to seed).
- **Use SwiftEval/McEval as an external floor** only, with the loud caveat that they're function-level and say nothing about app context.
- **MacOS runner caveat:** `swift test`/XCUITest needs macOS. CI Swift suite runs on a `macos-latest` GitHub runner (separate job, gated `if: fixture.lang == swift`), not the Ubuntu Node job. Metrics are identical to §1d (resolved%, regressions, TDD test-first instrumentation) so iOS plugs into the same scorecard.

---

## 3. tech-lead (Rio) — review + decomposition + RCA

Three distinct deliverables, three scoring approaches.

### 3a. Blocking code review — recall without crying wolf (deterministic + seeded)

This is the most cleanly measurable Rio capability and the research gives us the right model: **c-CRAB (arXiv 2603.23448)** proves that *similarity* metrics (BLEU-4≈0.00, ROUGE-L≈7.02 even for a *correct* review) are useless, and that the right oracle is **behavioral — does the review lead to a correct fix.** SOTA review agents (incl. Claude Code) solve only ~40% — not saturated.

Design:
- **Seed known-bad diffs** into a fixture PR — reuse the QA seeded faults *as the change under review* (a seeded fault is a known-bad diff with a known oracle test). Each PR carries `N_real` planted defects + is paired with a clean control PR.
- **Recall** = fraction of planted defects Rio's review flags (mapped by file+line+category to the seeded fault's `meta.json`).
- **Precision / cry-wolf** = on the *clean control PR* and on the non-defective hunks, fraction of Rio's comments that are spurious. Report precision, recall, **F1**, and **false-block rate** (did Rio BLOCK a good PR — the costly error for a *blocking* reviewer).
- **c-CRAB-style behavioral check (the strong oracle):** convert each planted defect into the seeded fault's oracle test; a review "counts" only if a downstream fix agent, acting on Rio's review, makes that test pass. This reuses the *coding* suite (§1) as the verifier — same fixtures, same test adapter. This is the most defensible Rio number.
- Cite **RACE (arXiv 2407.11470)** for the *dimensions* (readability/maintainability/efficiency) when extending beyond correctness defects, but note it scores generated *code*, not review *comments* — so it's a rubric source, not an oracle.

### 3b. Decomposition (story → ordered tasks + interface contracts) — LLM-as-judge vs reference

The research is explicit: **no public benchmark scores decomposition quality.** PlanBench (arXiv 2206.10498) is toy Blocksworld and saturation/contamination-ridden (o1: 97.8% standard → 23.6% on hard); BFCL tests contract *conformance*, never contract *design*. So this is **rubric-judged, period** — be honest about it.

- **Reference plan per fixture:** a maintainer hand-authors the gold task graph (ordered tasks + interface contracts) for each fixture's feature.
- **LLM-as-judge rubric** scoring Rio's plan against the reference on: dependency-ordering correctness, granularity, completeness (no missing task), and interface-contract soundness (cohesive, minimal, typed, stable). Double-judge + report judge disagreement.
- **Borrow AgentBoard's progress-rate / MARBLE's milestone-KPI methodology** (arXiv 2401.13178 / 2503.01935) — score partial credit on the unfolding decomposition, not just final pass/fail.
- **A cheap deterministic backstop:** the reference plan defines a true dependency DAG; score topological-order agreement (e.g., edge-agreement / Kendall-τ on task order) deterministically *alongside* the judge, to reduce judge variance.

### 3c. Root-cause analysis — localization, mostly deterministic

RCA has a partly-deterministic oracle:
- **Fault-localization accuracy** against the seeded fault's known location: **Hit@1 / MRR at file and function level** (the SWE-bench file-level localization metric; SWE-PolyBench arXiv 2504.08703 formalizes file/node retrieval — the cleanest modern proxy). Use Defects4J *only* as a methodology reference, not a fixture source — it's Java-only and severely contaminated (2014).
- **DebugBench (arXiv 2401.04621)** as an external floor for pure debug skill (synthetic injected bugs across C++/Java/Python; GPT-4 75.0%). Floor only — synthetic, not repo-real.
- **GitChameleon (arXiv 2507.12367, ~50% SOTA)** — adopt a couple of *version-drift* RCA fixtures (a fault caused by a library-version API change), because dependency drift is a real Rio root-cause category and GitChameleon shows it's hard and unsaturated.
- The *narrative* quality of the RCA (classification, confidence, impact) is rubric-judged against a reference RCA.

---

## 4. ba (Alex) + project-manager (Max) — mostly rubric + process metrics

Be explicit: **neither role has a saturating public benchmark.** Honesty is the design here.

### 4a. ba — story authoring (rubric-judged, no leaderboard exists)

Research converges (arXiv 2507.15157): LLMs match humans on syntactic/semantic story quality but produce **fewer acceptance-criteria-passing stories** (defects: excessive conjunctions, low feature specificity, weak rationale). There is **no hard numeric benchmark** — only study-scale datasets + rubrics.

- **Rubric = INVEST + QUS 13-criterion framework** (Req. Eng. 2016 / AQUSA, CEUR Vol-1564). LLM-as-judge scores Alex's generated stories per criterion; report per-criterion pass rate.
- **Deterministic partial backstop — rebuild AQUSA's rule-based checks** (well-formedness, atomicity, uniformity, conflict-free) in `spine/` as a cheap pre-judge gate; the research shows LLMs now match/beat AQUSA, so use AQUSA's rules as the *floor* and the judge for semantic quality.
- **Acceptance-criteria testability via nl2spec/VLTL-Bench (arXiv 2303.04864 / 2507.00877):** for the subset of criteria that *can* be formalized, translate Alex's acceptance criteria to a checkable spec and verify non-ambiguity. Adjacent, over-constraining for agile ACs — use sparingly, flag as such.
- The **gold = human-authored stories** for each fixture feature; judge Alex vs human on the same rubric (the 2507.15157 design).

### 4b. project-manager — orchestration + merge gate (process metrics + dual-control proxy)

Research: **no SDLC-orchestration-native benchmark.** Best proxies — **MultiAgentBench/MARBLE** (arXiv 2503.01935, topology + milestone KPI = closest to Max's routing decisions), **tau2-bench** (arXiv 2506.07982, *dual-control* coordinate-a-second-actor = closest to dispatch+verify), **TheAgentCompany** (arXiv 2412.14161, 28 PM tasks, self-hosted, low-contamination). None scores merge-gate quality.

Split Max into measurable pieces:
- **Tool-use / policy-following plumbing — deterministic via tau-bench/tau2-bench/BFCL style.** Max routes tasks and gates merges via tools (issue tracker, git). Build a **tau-bench-style suite over a MOCKED issue tracker + git** (state-goal oracle: did the right task get routed to the right dev, did the merge gate fire). Score **pass@1 and `pass^k`** — `pass^k` is the load-bearing metric (an orchestrator must be *reliable*, not occasionally right; tau-bench's whole point).
- **Merge-gate decision quality — CUSTOM, deterministic confusion matrix.** No benchmark exists, so we build it: feed Max a stream of PRs, some good (should accept), some carrying seeded faults (should block). Score **false-accept rate** (let a bad change through — the dangerous error) and **false-reject rate** (blocked a good change). This directly reuses §3a's seeded-fault PRs.
- **Routing correctness** — deterministic against a reference routing for each fixture task graph (right specialist, right parallelism, no deadlock). Borrow **MARBLE's milestone KPI** for partial credit.
- **PlanBench** cited only for the planning-validity *concept*; not used as a fixture (toy + contaminated).

---

## 5. scout (Kit) — onboarding-doc fact recall

The deliverable is authoring `CLAUDE.md`/`AGENTS.md`/`.agents/*`. Research: the QA-over-repo sub-skill is well-served (**RepoQA** arXiv 2406.06025 — 500 needle-function tests; **SWE-QA** arXiv 2509.14635; **CoReQA**; **StackRepoQA**), but the *authoring* deliverable is essentially novel — **SWD-Bench (arXiv 2604.06793)** is the only thing that scores generated-doc *usefulness*, and it measures implementation utility, not orientation quality.

Design — **fact-recall against a hand-labeled fact set** (RepoQA-style, but inverted toward authoring):
- **Per fixture, a hand-labeled ground-truth fact set** `fixtures/<id>/facts/facts.json`: the load-bearing facts a correct onboarding doc must capture — package manager (npm vs pnpm), test command, build command, entrypoints, architecture layers, key conventions, Node/lang version pins. (This is exactly what the `seeding-a-project` skill is supposed to extract, so it doubles as a regression test for that skill.)
- **Scoring = fact recall + precision.** Run Kit to generate the docs, then either (a) string/structured-match each gold fact against the generated docs (deterministic where facts are atomic like `pnpm`, Node 20), or (b) for prose facts, LLM-as-judge "is fact F supported by the doc." Report **recall** (facts captured), **precision** (no fabricated/wrong facts — e.g., says `npm` when repo uses `pnpm`; this is the dangerous error since Jay/Py *act* on it), and **fabrication rate**.
- **Downstream-utility check (SWD-Bench-style, the strong oracle):** give a *downstream* agent (Jay/Py) a task using *only* Kit's generated docs, and measure whether their task success improves vs no-docs baseline. SWD-Bench showed good docs raised SWE-Agent solve rate by 20% — we measure the same lift, reusing the §1 coding suite as the verifier. This ties Kit's score to real value, not prose aesthetics.
- **RepoQA itself** as an external floor for Kit's repo-comprehension prerequisite (long-context needle retrieval), separate from authoring.

---

## 6. personal-assistant (Octo) — tool-use over mocked services

Research: best fit is **ASTRA-bench (arXiv 2603.01357)** — email+calendar+messages+contacts, 2,413 scenarios, rule-based milestones + LLM-judge — but it has **no Teams and no Obsidian** (Octo's actual stack: `microsoft-365`, `obsidian-vault`). Those two dimensions have **zero public coverage** → bespoke. tau-bench's `pass^k` and GAIA/AssistantBench/BFCL frame the rest.

Design — **tau-bench/GAIA/BFCL-style suite over MOCKED services**:
- **Mock the toolset**, never touch live accounts: stub the `microsoft-365` (Outlook mail/calendar, Teams) and `obsidian-vault` (linked-Markdown) tools with deterministic in-memory state. (The repo already gates these behind MCP servers, so a mock layer slots in cleanly.)
- **Scoring spine (ASTRA/tau-bench dual model):**
  - **Task success — state-goal oracle.** Final mock-DB state matches the goal (tau-bench's outcome reward). E.g., "draft a reply to thread X and add a calendar hold" → check draft exists + event created.
  - **Correct tool calls — BFCL-style.** AST/argument match against the expected call sequence; relevance/irrelevance detection (did it call the right tool with right args).
  - **No destructive mistakes — CUSTOM safety oracle (load-bearing).** Mocked tools log every mutation; assert **zero irreversible destructive ops** (deleted an email/event/note that wasn't in scope, sent instead of drafting). Any destructive false-positive = hard fail for that trial, regardless of task success. This is the assistant-specific analog of merge-gate false-accept.
  - **`pass^k`** for reliability (tau-bench) — an assistant that's right 6/10 is unusable.
- **Proactivity (π-Bench arXiv 2605.14678)** as an optional dimension for the conversational suite: fraction of hidden needs resolved. Judgment-based — flag it.
- **Obsidian + Teams suites are bespoke** — no public benchmark; state-goal oracles over the mocks.

---

## 7. Shared harness integration — one runner, many suites

This is the architectural keystone: **the seeded-fault apps the QA bundle already produces are the same fixtures every DEV+CORE suite consumes.** A single seeded fault is, simultaneously:

| Fixture artifact | QA suite uses it as | DEV+CORE suite uses it as |
|---|---|---|
| seeded fault diff + oracle test | bug to detect (recall/precision), mutation to kill | coding §1 fail-to-pass issue; review §3a known-bad diff; PM §4b PR-to-gate; RCA §3c localization target |
| app repo @ pinned commit | system-under-test | scout §5 onboarding target; ba §4a feature source; tech-lead §3b decomposition source |
| `facts.json` / `tasks/` | (n/a) | scout fact set; ba/tech-lead task specs |

**Shared scoring spine** (`eval/spine/`), used by every suite:
1. **Deterministic checks** — `deterministic.mjs` runs the right test adapter (pytest / vitest / `swift test` / XCUITest / go test) and returns the FAIL_TO_PASS / PASS_TO_PASS verdict. This is the QA harness's existing fault-oracle machinery; DEV reuses it verbatim.
2. **LLM-as-judge** — `judge.mjs` takes a rubric + artifact, returns `{score, rationale, citations}`. **Double-judge + self-consistency**, report inter-judge disagreement (the research repeatedly flags judge bias: CoReQA, ASTRA, story-quality). Same judge module for ba stories, tech-lead plans, scout prose facts, assistant proactivity.
3. **`pass^k` variance** — `passk.mjs` runs every trial `k` times and reports **pass@1 + pass^k + CI band** (tau-bench reliability metric, shared with QA's pass^k requirement). This is *the* defense against "the prompt edit looked better but it was noise."

**Cross-host / version matrix** (`spine/matrix.mjs`, reuses QA's matrix): expands `(agent_version × fixture@version × host)`. Hosts = the installer's real targets: **Claude, Cursor, Windsurf, Copilot, Codex, Kiro.** The runner *uses `bin/init.mjs` itself* to install the agent-under-test into a throwaway fixture clone per host (the per-host install shapes — Claude dirs, Copilot flat `.agent.md`, Codex TOML — are exactly what we want to test, since a prompt that works on Claude may break under Copilot's `SKILLS-INJECTED` block). "Version" = both `agent_version` (git SHA of AGENT.md/SOUL.md/skill/briefing) and `fixture@version` (app version), giving the user's "works across app versions" axis.

**CI / reporting** — extend `.github/workflows/validate.yml` with an `eval` job (gated/nightly, not every PR — these are expensive): Ubuntu for Node/Python suites, `macos-latest` for the Swift suite. `report.mjs` emits a JSON scorecard + markdown, diffs against `baselines/<agent_version>.json`, and **gates on regression deltas** (configurable: e.g., fail if resolved% drops >X beyond the `pass^k` CI band). A prompt edit's PR shows the scorecard delta inline — the user's exact "better-or-worse" loop.

**One runner contract:**
```bash
node eval/runner.mjs --suite coding   --fixture fastapi-auth --host claude  --k 5
node eval/runner.mjs --suite review    --fixture fastapi-auth --host copilot --k 5
node eval/runner.mjs --suite scout     --fixture fastapi-auth --host claude  --k 3
node eval/runner.mjs --matrix --agent HEAD --baseline baselines/<sha>.json   # full grid + regression report
```

---

## 8. Prioritization — build order + this-week first step

Build order is dictated by **benchmark maturity = how cheaply you get a trustworthy number.** Coding agents have hard deterministic oracles; BA/PM/scout are rubric-bound and need hand-labeled gold. Build the spine where the oracle is free, then layer the judge-heavy suites.

1. **Spine + coding suite (js-dev/python-dev).** Deterministic FAIL_TO_PASS/PASS_TO_PASS oracle = zero judge dependency, immediate signal. Proves `runner.mjs`, `deterministic.mjs`, `passk.mjs`, `matrix.mjs`, and host-install plumbing. Everything else reuses this.
2. **tech-lead review (§3a) + PM merge-gate (§4b).** Both *reuse the §1 seeded faults as PRs* — near-zero new fixtures, strong deterministic/behavioral oracles (c-CRAB-style + confusion matrix). Highest signal-per-effort after coding.
3. **scout (§5).** Fact-recall needs a hand-labeled `facts.json` per fixture (moderate labeling cost) but the downstream-utility check reuses the coding suite. Doubles as a regression test for the `seeding-a-project` skill.
4. **RCA (§3c) + decomposition (§3b).** Localization is deterministic (cheap); decomposition needs gold reference plans (judge-heavy, expensive labeling).
5. **personal-assistant (§6).** Needs a bespoke mock layer for M365/Obsidian — self-contained, parallelizable, but no fixture reuse.
6. **ba (§4a) + ios-dev (§2).** ba is pure rubric + human gold (most labeling, least deterministic signal — do it once the judge plumbing is battle-tested on cheaper roles). ios-dev needs the macOS runner + hand-seeded Swift faults; valuable but isolated, and the public-benchmark gap means it's all bespoke regardless of when it's built.

### First step THIS WEEK (dev/core side)

Stand up the spine end-to-end on **one** fixture, one role, one host — a vertical slice that proves the loop, not breadth:

1. `mkdir eval/{spine,suites,fixtures,baselines}` and write a stub `eval/runner.mjs` (plain ESM, stdlib-only) with `--suite coding --fixture <id> --host claude --k <n>`.
2. Pick **one Python fixture** in our gap-domain: a single **FastAPI endpoint bug** (real, recent, post-cutoff) → `fixtures/fastapi-auth/` with `repo/` (pinned commit), `tasks/issue.md`, and `faults/<f>/oracle/` containing the FAIL_TO_PASS pytest + the PASS_TO_PASS set. Coordinate with the QA effort so this *is* one of their seeded-fault apps (shared from day one, not retrofitted).
3. Implement `spine/deterministic.mjs` with just the **pytest adapter** (parse junit-xml → FAIL_TO_PASS/PASS_TO_PASS verdict) and `spine/passk.mjs` (run `k=5`, report pass@1 + pass^k).
4. Have `runner.mjs` shell out to `node bin/init.mjs init --target claude` to install python-dev into a throwaway clone of the fixture, run the agent on `issue.md`, apply the patch, run the oracle, emit a JSON scorecard.
5. Record it as `baselines/<current-sha>.json`. Then make a trivial edit to `agents/python-dev/SOUL.md`, re-run, and confirm the scorecard shows a delta. **That delta loop is the whole product** — once it works for one Python fixture on Claude, every other suite/host/role is fan-out on the same spine.

---

**Key honesty flags carried throughout (per the research):** SWE-bench Verified is saturated/contaminated — not a headline; React/Next.js, FastAPI/FastMCP, Teams, and Obsidian have **no public benchmark** (mandatory bespoke fixtures); Swift repo-level eval is a near-total gap (fixture-only); decomposition, story-quality, merge-gate, and routing have **no leaderboard** and are rubric + custom-process-metric by necessity; TDD-as-process is unmeasured publicly and is instrumented custom (test-first against before/after states); and `pass^k` + held-out/time-windowed fixtures are the non-negotiable contamination/variance defenses so prompt edits move *real* signal, not memorized or noisy numbers.

Relevant existing repo files this design wires into (all absolute): `bin/init.mjs` (host-install plumbing the matrix reuses), `.github/workflows/validate.yml` (CI to extend with the `eval` job), `agents/{js-dev,python-dev,ios-dev,tech-lead,ba,project-manager,scout,personal-assistant}/AGENT.md` (agents-under-test), and `skills/seeding-a-project/` (scout suite doubles as its regression test). Proposed new tree: `eval/`.
