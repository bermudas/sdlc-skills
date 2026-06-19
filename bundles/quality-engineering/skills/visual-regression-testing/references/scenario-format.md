# Scenario artifact

The recorded test case. **Authored on run 1, replayed on rails on runs 2..N.** Without it, later runs reach
slightly different states and the visual diff is comparing apples to oranges. One file per flow:
`visual-tests/scenarios/<id>.json`.

## Shape

```jsonc
{
  "id": "C12345",                       // HARD test id from your system of record (TestRail/Xray/Jira/
                                        // spec path). Passed as --test on every check; namespaces all
                                        // baselines. Must be identical every run — set once, never re-mint.
  "source": "testrail",                 // OPTIONAL: where the id comes from (testrail|xray|jira|file|adhoc)
  "title": "Checkout — happy path",     // OPTIONAL: human label (free to change; NOT part of identity)
  "version": 1,
  "authoredBy": { "model": "claude-opus-4-8", "date": "2026-06-05T12:00:00Z" },
  "baseUrl": "https://app.example.com",
  "viewport": { "width": 1280, "height": 800 },   // pinned for every run -> stable dimensions
  "device": null,                        // or a Playwright device preset name
  "storageState": "auth/user.json",      // restored before step 1 so run 2 isn't logged out
  "clock": { "fixedTime": "2026-01-01T00:00:00Z" },  // freeze time BEFORE navigating (see note)

  "steps": [
    { "n": 1, "action": "goto",  "target": "/" },
    { "n": 2, "action": "click", "selector": "role=button[name=/cart/i]", "intent": "open the cart" },

    { "n": 3, "checkpoint": {
        "name": "cart-populated",
        "locator": "#cart-panel",
        "mask": [".cart-timestamp", ".session-id"],
        "viewport": { "width": 1280, "height": 800 },
        "threshold": 0.2,
        "maxDiffPixelRatio": 0.01
    }},

    { "n": 4, "action": "click", "selector": "role=button[name=/checkout/i]", "intent": "proceed to checkout" },
    { "n": 5, "checkpoint": { "name": "checkout-step-1", "locator": "main" } }
  ],

  "policy": {
    "heal":   ["locator-drift", "cosmetic-text", "minor-layout"],
    "report": ["functional-failure", "missing-element", "error-state"],
    "neverWorkaround": true
  }
}
```

## The two kinds of step

- **`action` steps** describe *how to reach* a state. Express selectors **semantically** (roles, accessible
  names, labels) — `role=button[name=/checkout/i]`, not `#btn-7fa3`. Semantic selectors let the execution
  agent heal small drift (a renamed id, a reworded label) without breaking the run. Include an `intent` so a
  later agent understands the goal when the literal selector has moved.
- **`checkpoint` steps** mark where `visual-check check <name>` fires and with exactly what params. These
  params are the same ones persisted to the baseline sidecar on run 1, so the scenario and the sidecar agree.

## How each leg uses it

- **Authoring (run 1)** *emits* this file as it explores: every navigation becomes an `action`, every
  baseline it captures becomes a `checkpoint` with the params it used. See `agent-contracts/authoring.md`.
- **Execution (runs 2..N)** *consumes* it and does not re-explore: walk `steps` in order, run each `action`
  with your driver, and at each `checkpoint` call `visual-check check <name> --locator … --mask … --scenario
  <id>` with the recorded params. See `agent-contracts/execution.md`.

## Determinism notes

- **Clock must be frozen before the state is reached.** `page.clock.install()` / `setFixedTime` only affect
  time-dependent rendering if installed *before* the page reads the clock. Do it right after creating the
  page / before `goto`, using your driver — not at the checkpoint. Record the chosen time here so every run
  freezes identically. (visual-check captures whatever is on screen; it can't retroactively freeze time.)
- **storageState before step 1.** Restore auth at the very start so the path doesn't diverge to a login page.
- **viewport** lives both at the scenario top level and (optionally) per checkpoint; keep them consistent so
  baseline dimensions never drift between runs.
- **Keep `name`s stable.** The checkpoint `name` is the baseline's identity across runs — renaming it orphans
  the baseline and forces a fresh `created`. Run `node "$VC" list` before adding new checkpoints.
