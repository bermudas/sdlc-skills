# Failure & Success Modes of AI-Based Testing

Rationale doc for the harness. Each eval metric exists to **catch** a specific way
AI testing fails; each maps to an **agent rule** that should **prevent** it. Read
this as the "why" behind [`design/qa-bundles-eval.md`](design/qa-bundles-eval.md)
and [`design/efficiency-and-cost.md`](design/efficiency-and-cost.md).

## The one principle

> AI testing **succeeds** in proportion to how *verifiable* the correct answer is,
> and **fails** in proportion to how much *judgment, intent, novelty, or
> long-range state* deciding "is this right?" requires. When something else holds
> the oracle (a spec, a deterministic checker, a fail→pass test), AI is a force
> multiplier. When the AI must *be* the oracle, it's unreliable.

Layered on top: **AI tends to *confirm* rather than *challenge*** — it wants to
make things pass — whereas good testing is adversarial. Most of the insidious
failures below are this bias in disguise.

---

## Where AI-based testing SUCCEEDS

Point the agents here confidently; the eval should *confirm* these stay strong.

| Case | Why it works | Bundle |
|---|---|---|
| Oracle-rich tasks (spec, API contract, reference impl, known fail→pass) | answer is checkable → verify, don't trust | `test-automation`, `web-qa` vs spec |
| Breadth / edge-case enumeration | LLMs recall the long tail humans forget | `web-qa` authoring |
| Pattern-dense domains (auth, CRUD, REST, common React/forms) | abundant training data → high baseline | js/python-dev, `web-qa` |
| Deterministic-tool orchestration (axe, headers, links, CWV, contrast) | truth comes from the tool; AI drives + interprets | `quality-engineering`/Quinn |
| Reproduction from a described symptom | the bug report *is* the oracle | `reproducing-issues` |
| Manual case → automation translation | intent already pinned in the case | `test-automation` |
| Triage / dedup / summarization | language task, low stakes, human reviews | `test-reporter`, `issue-tracking` |
| Regression detection vs a baseline | "different from known-good" = cheap oracle | the version axis |

---

## Where AI-based testing FAILS

✗✗ = **insidious** (fails while looking like success — the dangerous kind).

| Failure mode | Mechanism | Metric that catches it | Agent rule that prevents it |
|---|---|---|---|
| **✗✗ Defect masking** | asserts the buggy behavior; weakens/removes assertions; try/catch swallows the failure | **defect-masking rate** (passes on a build it must fail) + AST lint | "never mask product defects"; assert intended behavior, not observed |
| **✗✗ Coverage theater** | executes code without meaningful assertions (~98% coverage, ~19% mutation kill) | **mutation kill rate** (not coverage) | assertions must distinguish correct from incorrect output |
| **✗✗ Hallucinated / cry-wolf findings** | reports non-bugs, fabricates evidence, inflates severity | **precision / false-alarm rate**, **evidence-discipline score**, **p0/p1 precision** | "if you can't prove it, lower confidence; never fabricate evidence" |
| **✗✗ Contamination / memorization** | recalls the answer instead of finding it; aces eval, fails on novel apps | **held-out + time-windowed + mutation-perturbed** fixtures; canonical-vs-perturbed delta | fixtures stay private; rotate quarterly |
| No oracle / ambiguous correctness | can't judge intent → tests the implementation | (out of scope — flag for human) | escalate when correctness needs business judgment |
| Unstated / drifted requirements | requirement unwritten → confirms whatever exists | **requirement-coverage / traceability** completeness | test against the spec, not the current behavior; surface gaps |
| Brittle locators / DOM over-fit | fragile selectors break on refactor | **locator-robustness across versions** | locator ladder; no nth-child / absolute XPath |
| Nondeterminism & flakiness | temp-0 not reproducible; sleeps; races | **`pass^k`** + no-sleep AST lint | no `sleep`/`waitForTimeout`; deterministic waits |
| Deep-state / long-horizon bugs | multi-step, concurrency, timing, data-dependent | **steps-to-find**, charter coverage; report misses honestly | don't claim coverage of paths not exercised |
| Negative-space security | needs "what shouldn't be possible" reasoning | per-dimension **security recall** vs seeded faults | drive real checkers; don't assert "secure" from a happy path |
| Visual / experiential correctness | "renders but looks wrong"; subtle shifts | seeded **responsive/visual** faults; vision + baseline | flag low confidence on visual claims |
| True non-functional behavior | perf under load, soak, real concurrency | mark out-of-scope; don't fake a number | never report a perf number not actually measured |
| Environmental coupling | auth/data/3rd-party blocks the agent | **BLOCKED** vs **FAIL** distinction in coverage | classify & escalate blockers; don't fake around them |
| Judge unreliability (for the eval itself) | LLM-judge bias, position bias, self-preference | calibrate vs human subset; pairwise + order-swap; "Unknown" escape hatch | (harness rule, not agent) |
| Maintenance burden | unreadable suites that rot | review-gate; readability rubric | tests read like the surrounding suite |

---

## How to use this doc

- **Building the harness?** Every metric in the design traces to a row here — if a
  metric doesn't map to a failure mode, question whether it earns its cost.
- **Editing an agent/skill?** The "agent rule" column is the behavior the prompt
  should encode; a regression in the paired metric means the rule weakened.
- **Reading a green result?** Check the ✗✗ rows first — those are the ones that
  pass while being wrong (masking, coverage theater, cry-wolf, contamination).
