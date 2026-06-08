# Eval Harness Design — Efficiency & Cost Axis

Fleshes out the "track cost/latency/tokens as first-class" line from
[`qa-bundles-eval.md`](qa-bundles-eval.md) §7 and
[`dev-core-roles-eval.md`](dev-core-roles-eval.md) §1d into a real **efficiency
axis**, plus **multi-model comparison** and **ccusage** session accounting.

## 0. The reframe — quality and cost are one chart

Quality and cost are **two axes of one chart**. Neither number means anything
alone: a prompt edit that lifts bug-recall 5pts but triples spend is a
*trade-off*, not a win. The deliverable is the **quality/cost frontier** — for
each model and agent-version, where does it sit on "outcome vs $ spent," and does
a change move it **up-and-left** (better) or just **up-and-right** (more
expensive)?

- **ccusage** owns the *cost* half (session / daily / block / per-model rollups).
- **The harness** owns the *join*: cost ⨝ quality outcome **per task**. ccusage
  knows a session cost $0.40; only the harness knows that $0.40 found 3 of 4 bugs.
  That join is what makes cost-per-bug and the frontier computable.

Every result already carries a quality vector (recall, defect-fail-rate, mutation
kill, …). This axis attaches a **usage record** alongside it, joined by
`(task, model, fixture, run)`.

---

## 1. Efficiency metrics — per task and per series

### Raw (captured per run)
`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`, `cost_usd`, `duration_ms` (wall-clock), `num_turns`,
`tool_calls`, `model`, `session_id`.

### Derived (where the insight lives)
| Metric | Definition | Why it matters |
|---|---|---|
| **Cost-per-resolved-issue** | Σ cost / # fixtures resolved | `test-automation`'s headline economic number |
| **Cost-per-true-bug-found** | Σ cost / # true detections (precision-weighted) | `web-qa` / Quinn economics; punishes cry-wolf spend |
| **$ / quality-point** | Δcost / Δ(headline metric) vs baseline | "is this prompt edit worth the extra spend?" |
| **Reliability-adjusted cost** | per-attempt cost ÷ pass^k | a cheap-but-flaky model isn't actually cheap |
| **Cache-hit rate** | cache_read / (input + cache_read + cache_creation) | biggest cost lever; agents that re-read context cheaply win |
| **Output-token share** | output / (output + total_input) | output dominates cost; bloated reports surface here |
| **Steps / tool-calls / turns-to-find** | from the trajectory | process efficiency, not just the bill |

A **series** (a full bundle run, or "all of Quinn's a11y tasks") is these
aggregated, keeping the per-task distribution (median + IQR) — same variance
discipline as `pass^k` in the quality design, never a bare point estimate.

---

## 2. Different-model comparison

Add a **model axis** to the existing matrix:

```
(agent_version × model × fixture@version × host)
```

Hold task + fixture + N-runs fixed; vary only the model. On the canonical Claude
host the runner dispatches headless and reads cost straight back:

```bash
claude -p "<charter>" --model claude-opus-4-8   --output-format json
claude -p "<charter>" --model claude-sonnet-4-6 --output-format json
claude -p "<charter>" --model claude-haiku-4-5  --output-format json
```

`--output-format json` returns `{ result, total_cost_usd, usage{…}, num_turns,
duration_ms, session_id }`, and `total_cost_usd` **already includes subagent /
workflow cost** — so it is the per-task attribution source of truth (no log
parsing needed).

### Per-model scorecard (the output)
```
test-automation · fixture=realworld · n=5
model     resolved%  defect-fail  mask-rate  $/run   $/resolved  pass^3   $·reliable
opus       92%        0.90         0.00      $0.41    $0.45       0.80      $0.51
sonnet     84%        0.82         0.04      $0.12    $0.14       0.60      $0.20   ← best $/quality
haiku      61%        0.58         0.11      $0.03    $0.05       0.20      $0.15
```
Quality + host held constant, so the delta is **purely the model**. Sonnet is the
frontier pick here; Haiku's low `$/run` is a mirage once adjusted for `pass^3`.
Emit a **quality-vs-$ Pareto** plot per suite alongside the table.

> **Keep model comparison on the Claude host.** Cost/usage attribution is clean
> and uniform there. Copilot / Cursor / Codex have their own logging and pricing —
> fold them in later as *parity*, not economic comparison (matches the
> "quality on one host, host axis = parity smoke" decision in the quality design).

---

## 3. ccusage integration — session / filtered accounting

[ccusage](https://github.com/ryoppippi/ccusage) reads Claude Code's local JSONL
transcripts (`~/.claude/projects/<cwd>/<session-id>.jsonl`, honoring
`CLAUDE_CONFIG_DIR`) and rolls up tokens + cost (LiteLLM pricing). Two roles:

### (a) The session / filtered dashboard
```bash
npx ccusage@latest session --json --breakdown               # per-session, per-model token+cost
npx ccusage@latest daily   --since 20260604 --until 20260604 --breakdown
npx ccusage@latest blocks  --live                           # live 5-hour-block burn during a run
npx ccusage@latest monthly --project sdlc-skills-eval       # filter to the eval project
```
Flags used: `--since/--until` (YYYYMMDD), `--json`, `--breakdown` (per-model),
`--project`, `--mode auto|calculate|display`, `--offline` (bundled pricing).

### (b) Clean filtering trick — isolate eval sessions
Run the harness under a dedicated config dir so eval usage never mixes with normal
Claude work, then ccusage over that dir is trivially eval-only:
```bash
CLAUDE_CONFIG_DIR="$(pwd)/eval/.usage" node eval/runner.mjs --suite test-automation ...
CLAUDE_CONFIG_DIR="$(pwd)/eval/.usage" npx ccusage daily --json     # eval-only cost
```

### ccusage vs harness — who answers what
| Question | Source |
|---|---|
| "What did this session / day / block / model cost?" (filtered) | **ccusage** |
| "Is my pricing right?" (cross-check) | **ccusage** (LiteLLM) vs harness |
| "What did it cost to find *this bug* / resolve *this issue*?" | **harness** (cost ⨝ quality) |
| "Where's the quality/cost frontier across models?" | **harness** |

---

## 4. Data sources & attribution

Priority order for the per-run usage record:

1. **`claude -p --output-format json` result** — authoritative; `total_cost_usd` +
   `usage` scoped to exactly this run, subagents included. Preferred.
2. **Transcript JSONL parse** (fallback for non-headless paths) — sum the `usage`
   objects across the run's transcript **and its subagent transcripts**; compute
   cost from a pricing table only if no logged cost is present.
3. **ccusage `--json`** — cross-check / dashboards, never the per-task join.

`spine/usage.mjs` implements (1) and (2) and a best-effort ccusage cross-check;
it is **stdlib-only** so it unit-tests under root `node --test` (see
`usage.test.mjs`). The pricing fallback table is clearly marked "verify/override —
`total_cost_usd` and ccusage are the authorities."

---

## 5. Harness changes

```
eval/spine/
  usage.mjs       # per-run usage record from `claude -p --output-format json`
                  #   fallback: JSONL parse (+subagents); cross-check: ccusage --json
  report.mjs      # EXTEND: efficiency columns + quality/cost Pareto + per-model scorecard
```
- **Schema:** add `usage{model,input,output,cacheRead,cacheCreation,costUsd,wallMs,turns,toolCalls}`
  to every scored result, joined to the quality vector by `(task, model, fixture, run)`.
- **`report.mjs`:** every prompt-edit PR shows **both** deltas — quality Δ *and*
  cost Δ — so "better" is never reported without its price; plus the per-model
  scorecard and the frontier.
- **Gating:** add an optional **cost-regression guard** (fail if `$/resolved`
  jumps > X beyond baseline band) next to the quality guard — catches a prompt
  edit that quietly balloons token use even when quality holds.

---

## 6. Per-task usage record (example)

```json
{
  "task": "automate-todo-toggle",
  "fixture": "realworld@v-bug-001",
  "model": "claude-sonnet-4-6",
  "host": "claude",
  "run": 3,
  "quality": { "resolved": true, "defectFail": true, "maskRate": 0.0, "noSleep": true },
  "usage": {
    "model": "claude-sonnet-4-6",
    "input": 18234, "output": 4120,
    "cacheRead": 142880, "cacheCreation": 20110,
    "costUsd": 0.1361, "wallMs": 47210, "turns": 9, "toolCalls": 23
  },
  "derived": { "cacheHitRate": 0.79, "outputShare": 0.18 }
}
```

This rides next to the quality vector through the same `pass^k` aggregation and the
same `report.mjs` pipeline — the efficiency axis is additive, not a separate run.

---

*Cross-refs: quality metrics & fixtures → [`qa-bundles-eval.md`](qa-bundles-eval.md);
dev/core role suites & the shared matrix → [`dev-core-roles-eval.md`](dev-core-roles-eval.md);
failure modes each metric defends against → [`../FAILURE-MODES.md`](../FAILURE-MODES.md).*
