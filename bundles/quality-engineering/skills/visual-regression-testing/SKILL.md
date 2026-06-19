---
name: visual-regression-testing
description: >-
  Use this whenever an AI agent drives a browser to run a UI test more than once and needs to catch
  VISUAL changes between runs — pixel/screenshot regression, baseline capture-and-compare, visual
  checkpoints, "snapshot this state and compare it next run", "did the UI change since last time",
  toHaveScreenshot-style golden images, or stabilizing flaky screenshot tests with masks/thresholds.
  Trigger it even when the user only says "test this page", "run the same test again", "compare
  screenshots", "visual diff", "regression test the checkout", "make sure the layout didn't change",
  or "set up a baseline" — anything where the agent navigates with Playwright MCP / Playwright CLI /
  chrome-devtools MCP / browser-verify and then wants a deterministic visual verdict on the live page.
  This skill adds a visual_check capability the other browser skills lack: it screenshots the page the
  agent is ALREADY on (over the shared CDP browser, no re-navigation) and creates-or-compares a
  baseline with pixelmatch.
compatibility: >-
  Node 18+. Connects to a Chromium already running with --remote-debugging-port (default :9222) — the
  same shared browser used by Playwright MCP, chrome-devtools MCP, and browser-verify. Run
  `npm install` once in this skill's directory (playwright-core, pixelmatch, pngjs).
license: Apache-2.0
metadata:
  authors:
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.1.0"
---

# Visual Regression Testing (agent-as-runner)

You are the test runner on **every** run. There is no compiled spec replaying in CI — you navigate the
app yourself each time and, at each checkpoint, call **one tool** against the page you are already on.
That tool, `visual-check`, decides what to do from whether a baseline exists:

- **No baseline yet** → it captures one (`status: created`) and you eyeball it. *Created is not a pass.*
- **Baseline exists** → it compares the live page to the baseline with pixelmatch (`pass` / `fail`).
- **Explicit `update`** → it writes a *candidate* to `pending/` for a human to approve. Never autonomous.

Your call is **identical on every run** — you don't track "is this run 1 or run 5". The tool figures out
the mode. This is the `toHaveScreenshot` lifecycle (create once, compare thereafter), but as a live CLI,
because *you* are the runner and the browser is already at the right state.

> **Why a separate tool at all?** The other browser skills (`playwright-cli`, `chrome-devtools`,
> `browser-verify`) can take a screenshot, but they can't tell you *"these pixels changed since last run"*.
> `visual-check` adds the missing piece: a persistent, platform-namespaced baseline plus a deterministic
> pixel diff — without ever launching its own browser or re-navigating. It attaches to the browser you're
> already driving over CDP.

---

> **In the quality-engineering bundle.** This skill is the **visual** half of re-execution: it catches
> *did-it-still-look-right* drift the functional case never asserts. The `test-runner` authors baselines +
> a `scenario.json` on a case's first green run, and replays them cheaply on regression / bugfix-verify
> re-runs (the functional half — *does-it-still-work* — is the codified Playwright spec; see the runner's
> MODE REPLAY). Two rules for QE: (1) the bundle's drivers are **Playwright MCP** (primary) and
> **`browser-verify`** (CDP fallback) — both attach to the shared Chrome below, so you do **not** need
> chrome-devtools MCP; (2) **`--test` is the TC id** (`TC-031`, or the TMS key the project assigns) so a
> baseline is namespaced to the case and run N reuses run 1's name by construction. Default to **`aria`**
> snapshots (platform-independent, low-flake, cheap) and add a scoped pixel `check` only where exact
> appearance matters.

## 0. One-time setup

**Shared browser.** Everything talks to ONE Chrome on a CDP port (default `:9222`): Playwright MCP,
chrome-devtools MCP, browser-verify, and visual-check. That shared session is what lets visual-check
screenshot the exact page you navigated to — no second browser, no re-navigation. Start it **first**,
before any browser tool:

```bash
SKILLS=".claude/skills"
bash "$SKILLS/browser-verify/scripts/chrome-launcher.sh" start            # headed
# bash "$SKILLS/browser-verify/scripts/chrome-launcher.sh" start --headless  # CI / no display
```

If your `.mcp.json` still has Playwright MCP launching its own browser, point it at the shared endpoint
instead. The full topology, port-switching, and the exact `.mcp.json` are in
**`references/topology-setup.md`** — read it the first time you set this up, or if visual-check and your
navigation tool seem to be on different pages.

**Install deps** (once per machine):

```bash
( cd "$SKILLS/visual-regression-testing" && npm install )   # playwright-core, pixelmatch, pngjs
```

**Path to the CLI** (use it verbatim below):

```bash
VC=".claude/skills/visual-regression-testing/scripts/visual-check.mjs"
```

---

## 1. The everyday loop

For each state you want to lock down (a "checkpoint"):

1. **Navigate to the state** with your normal driver — Playwright MCP, `playwright-cli`, or
   chrome-devtools MCP. Reach the *exact* visual state you want to compare (cart populated, modal open…).
2. **Call visual-check** on the live page:

   ```bash
   node "$VC" check <name> --locator '<region>' [--mask '<dynamic>'] [--viewport WxH]
   ```

3. **Read the JSON it prints** and act on `status` (next section). On `created` or `fail` it also writes
   PNGs — **Read those image files** so you actually *see* what happened (that's your second signal).

That's it per checkpoint. The first run creates baselines; later runs compare. Same command every time.

**Concrete example** — checkout cart:

```bash
# (you already clicked the cart open via Playwright MCP)
node "$VC" check cart-populated \
  --locator '#cart-panel' \
  --mask '.cart-timestamp' --mask '.session-id' \
  --viewport 1280x800 \
  --scenario checkout-happy-path
```

- Run 1 → `{"status":"created", "baselinePath":"…", "agentReviewRequired":true}` → Read the PNG, confirm it
  looks right. You're recording the golden image; there's nothing to diff against yet.
- Run 2 with the same UI → `{"status":"pass","diffPixels":0}`.
- Run 2 after a real UI change → `{"status":"fail","diffPath":"…","diffPixels":1423,"diffRatio":0.004}` →
  Read `diffPath` (changed pixels in red) and triage (§4).

### Two kinds of snapshot — pick the right one
`check` compares **pixels**. `aria` compares the **accessibility tree** (roles + names + structure):

```bash
node "$VC" aria checkout-tree --locator '#cart-panel' --aria-redact '\d{2}:\d{2}:\d{2}'
```

- **Pixel (`check`)** — catches anything visual: color, spacing, font, layout. Brittle to cosmetic drift,
  platform-specific (one baseline per OS). Use when *appearance* is what you're protecting.
- **ARIA (`aria`)** — catches structural/content change ("the checkout button disappeared", "the price
  label changed") while **ignoring** color/spacing/font noise. It's **platform-independent** (one baseline
  for every OS), cheaper, far less flaky, and its diff is human-readable text. Mask volatile text with
  `--aria-redact <regex>` (the structural analog of `--mask`). Use it as your **default low-flake
  structural check**, and add a pixel `check` on the few regions where exact appearance truly matters.

Many checkpoints are best with **both**: an `aria` snapshot for structure (won't flake on a font bump) and
a scoped pixel `check` for the part where pixels matter. They're independent baselines under the same name.

---

## 2. Getting a *meaningful* checkpoint (determinism is the whole game)

A visual baseline is only useful if run N captures under the **same conditions** as run 1. visual-check
enforces most of this for you (it disables animations, hides the caret, waits for fonts + network idle,
forces a fresh paint, **retries until two consecutive screenshots are byte-identical** so it never shoots a
mid-animation frame — Playwright's own flake defense — and **replays the baseline's stored params** on every
compare). Your job is to give
it good inputs the first time:

- **Scope to a region, not the full page.** Pass `--locator '#cart-panel'` (or `--clip x,y,w,h`).
  Full-page diffs turn unrelated drift elsewhere on the page into false "regressions". visual-check warns
  if you shoot full-page without `--allow-full-page` — heed it.
- **Mask what legitimately changes every run** — timestamps, session ids, ad slots, randomized avatars:
  `--mask '.cart-timestamp'`. Masked regions are painted a flat color in both images so they can't cause a
  diff. If a mask selector matches **zero** elements visual-check warns loudly — a "pass" then means it
  masked nothing, so fix the selector.
- **Pin the viewport** with `--viewport 1280x800` so a resized window can't shift everything by a pixel.
  A baseline/live **dimension mismatch** is reported as a fail with a clear message — almost always
  viewport drift.
- **Name from identity, not from memory** (see §2.5). Don't invent a name — run `node "$VC" suggest
  --locator '<region>' --state <word>` and use what it returns. That's how run N reuses run 1's name.

These params are persisted to a sidecar (`baselines/<name>.config.json`) on the *create* run and
**replayed automatically** on every compare — so you only specify them once, in run 1 (or in the scenario,
§5). Passing different ones at compare time is ignored with a warning; edit the sidecar or re-baseline to
change them. (Tuning knobs: `--threshold`, `--max-diff-ratio` — defaults 0.2 / 0.01 match Playwright.)

## 2.5 Naming: when to call, and how run N matches run 1's name

The hardest part of agent-as-runner is **identity**: a baseline's `name` must mean the *same checkpoint*
on every run, even after the UI legitimately changes. So identity is **intent-addressed**, never a hash of
the pixels/DOM (a content hash would change the moment the UI changed — orphaning the baseline you wanted to
diff). The convention is four parts, machine-derived → you confirm:

```
name = [<test>.]<route>.<region>[.<state>]    e.g.  checkout-happy.checkout.cart-panel.populated
  test   = the scenario / test-case id (--test or --scenario). NAMESPACES the baseline: the same page in
           two different test cases is two different baselines — they never collide or false-match.
  route  = normalized URL path (dynamic ids → "id"): /order/8123 → "order.id"
  region = the --locator's stable handle: data-testid > non-generated id > role[name]
  state  = YOUR intent word (--state): populated | empty | error | step-1
```

> **The test id must be stable — and it can't be *computed*.** `route`/`region` are derived from the page,
> but the test id is a free label, so if the model re-invents it each run (`checkout-happy` one run,
> `checkout-happy-path` the next) the namespace silently forks and every baseline orphans. Hashing the
> test's steps doesn't help — it just moves the orphaning to every test edit.
>
> **Best practice: anchor the test id to a system of record** — use the *hard id your test stack already
> assigns*, so it's identical every run by construction. Pick whichever you have:
> ```bash
> --test C12345            # TestRail case id
> --test PROJ-T123         # Xray / Zephyr / Jira test key
> --test checkout/happy    # path of the spec/scenario file (stable, versioned with the test)
> ```
> Mint a fresh label only when no external id exists, and the moment you do, **persist it once** in
> `scenarios/<id>.json` — from then on it's read/passed in, never re-derived. On an execution run the agent
> uses the given id **verbatim**. As a backstop, `suggest`/`check`/`aria` cross-check the page across *all*
> test ids: if this exact page is already baselined under a different id, they **warn** (`crossTestMatches`)
> so you reconcile to the canonical id instead of forking.

**Don't invent names — resolve them.** Before a checkpoint, ask the tool (pass the test-case id so the name
is scoped to this test):

```bash
node "$VC" suggest --test checkout-happy --locator '#cart-panel' --state populated
# → { suggestedName, action: "reuse" | "create", matchedExisting }
```

- `action:"create"` → no baseline matches this page → your call will create one.
- `action:"reuse"` → a baseline already covers this state (by exact name, or by route+region/structure under
  a different name) → **use the returned name so you COMPARE**, not spawn `cart-populated-2`.

This is what lets a fresh run match the earlier run's name without remembering it. As a backstop, on
*create* visual-check stores the page's identity (route, region, an ARIA structural hash) in the sidecar and
**warns if you're about to duplicate an existing baseline** under a new name.

**Before authoring, check the test-case registry** — so you reuse an existing test id instead of minting a
variant (`scenarios/index.json`, kept fresh automatically):

```bash
node "$VC" tests                          # all test ids: id / title / source / routes / #baselines
node "$VC" tests --route checkout         # "is there already a test id covering this page?"
```

**Listing baselines** — scope to a test case or a page so you reuse the right key:

```bash
node "$VC" list --test C12345             # baselines for one test case
node "$VC" list --route checkout          # baselines for one page/route (any test case)
node "$VC" list                           # everything, grouped by test case (byScenario)
```

**When to fire a checkpoint:** at each *settled, meaningful* state you want to protect — after a route/page
change, after a modal or panel opens, after data finishes loading, at the end of a user-goal step. With a
scenario (§5) the checkpoints and their names are already recorded, so you just replay them; `suggest` is for
ad-hoc runs and for authoring.

---

## 3. What each status means and what you do

| `status` | Meaning | Your move |
|---|---|---|
| `created` | First capture; baseline saved. **Not a pass.** | Read the baseline PNG. Confirm it's the intended state. If wrong, fix the page/params and re-create. |
| `pass` | Live matches baseline within threshold. | Continue. (Still glance if something else looked off — see two-signal below.) |
| `fail` | Pixel diff exceeded the gate. | Read `diffPath` + `actualPath`. **Triage** (§4). Do not "fix" by updating the baseline reflexively. |
| `update_pending` | A candidate baseline was written to `pending/`. | Tell the human; they run `approve`. You never approve your own update. |
| `error` | Couldn't connect / bad input. | Read `message`. Usually: Chrome not on the CDP port, or no page open — navigate first. |

### Two-signal reporting — keep them separate
Every checkpoint has **two independent signals**, and neither overrides the other:

- **pixelDiff** — the deterministic gate (`pass`/`fail` from pixelmatch). This is the regression verdict.
- **agentReview** — *your* eyeball judgment of the screenshot (`ok` / `anomaly` + a note).

Rules that matter:
- A `fail` is a failure **even if it looks fine to you**. "Looks ok" must not override the diff.
- Report an **anomaly even when pixelDiff `pass`** — a too-aggressive mask or sub-threshold change can let
  a genuinely broken UI slip through the gate. If your eyes say it's broken, say so.
- On `created` there's nothing to diff, so **agentReview is the only signal** — look carefully.

Report both per checkpoint, e.g.: `cart-populated — pixelDiff: fail (1423px, 0.4%); agentReview: anomaly
(price column misaligned). diff: <path>`.

---

## 4. When a checkpoint fails — triage, don't paper over

A `fail` is *information*, and you're already in the loop, so classify it. Read the diff PNG first, then
decide among three buckets:

- **Regression** (a real bug) → report it with the diff PNG, the live DOM/screenshot, and the step that led
  here. **Do not** update the baseline.
- **Intended UI change** (the design genuinely changed) → propose an update via `node "$VC" update <name>
  --note "why"`. That writes a *candidate* to `pending/` for human approval; it never touches the live
  baseline. Promotion happens in review (so the code change and the visual change are seen together).
- **Flake** (a dynamic region leaked into the shot) → don't overwrite the baseline. Recommend a `mask`/
  `clip`/threshold amendment to the sidecar so the noisy region stops causing diffs.

Full decision guidance is in **`agent-contracts/triage.md`** — read it when you hit a fail.

### Self-healing is bounded
While reaching a checkpoint you may **heal** trivial drift — a renamed selector, a reworded button label, a
one-pixel layout nudge — adapt and continue. But you must **report, never route around**, anything
functional: a missing element, an error/empty state, a broken flow. Routing around a broken checkout hides
the very bug the run exists to catch.

---

## 5. Run 1 (author) vs runs 2..N (replay): the scenario artifact

Visual regression only means something if runs 2..N reach the *same* states as run 1. Capture the path once,
replay it on rails after:

- **Run 1 — authoring.** Explore the app, reach each state, capture baselines, and **emit a scenario file**
  (`scenarios/<id>.json`) recording the steps (semantic selectors) and checkpoints (name + locator + mask +
  threshold). Contract: **`agent-contracts/authoring.md`**.
- **Runs 2..N — execution.** *Load the scenario and follow it.* Don't re-explore. At each checkpoint, make
  the identical `visual-check check` call. Heal minor drift, report real breaks. Contract:
  **`agent-contracts/execution.md`**.

Scenario format (steps, checkpoints, storageState/auth, frozen clock, heal/report policy) is documented in
**`references/scenario-format.md`**. A frozen, replayable scenario + pinned baselines is what makes a
cheap/fast model able to follow the rails on later runs while a stronger model did the run-1 exploration.

---

## 6. Gated baseline updates (never silent)

Overwriting a baseline on a `fail` is how a real regression gets laundered into the golden image. So:

- You may **propose** an update (`visual-check update <name>`) → it lands in `pending/` with an
  `update-request` record (old vs candidate, your rationale).
- A **human** promotes it: `node "$VC" approve <name>` moves `pending/ → baseline` and bumps the sidecar.
- You **never** run `approve` yourself to clear your own failing run.

---

## 7. Command reference (the rest via `node "$VC" help`)

```bash
node "$VC" suggest --locator '<sel>' --state <word>   # resolve a stable name; reuse-or-create (call FIRST)
node "$VC" check <name> [opts]    # PIXEL create-or-compare (the everyday call)
node "$VC" aria  <name> [opts]    # ARIA (accessibility-tree) create-or-compare — structure, low-flake
node "$VC" update <name> --note "why"   # gated refresh -> pending/, never overwrites live (+--aria for aria)
node "$VC" approve <name> [--aria]      # human promotes pending -> baseline
node "$VC" list                   # existing baselines (pixel + aria) + their params
```

Most-used options: `--locator <sel>`, `--mask <sel>` (repeatable), `--clip x,y,w,h`, `--viewport WxH`,
`--scale css|device`, `--wait <sel>`, `--threshold <0..1>`, `--max-diff-ratio <0..1>`,
`--max-diff-pixels <n>`, `--scenario <id>`, `--benchmark`, `--root <dir>` (default `./visual-tests`),
`--cdp <url>` (default `http://127.0.0.1:9222`), `--url-contains <s>` / `--page-index <n>` (disambiguate
tabs). ARIA-only: `--aria-redact <regex>` (mask volatile text). Stabilization is on by default
(`--no-stabilize` / `--stabilize-retries <n>` to tune). Full list: `node "$VC" help`.

Artifacts land under `./visual-tests/`: `baselines/` (pixel PNGs + `<name>.config.json`; ARIA
`<name>.aria.yaml` + `<name>.aria.json`), `diffs/`, `actuals/`, `pending/` (+ `requests/`), `scenarios/`,
`benchmark/runs.jsonl`. Pixel baselines are platform-namespaced (`<name>__chromium-<os>.png`) — a baseline
made on one OS must not be compared on another; regenerate per platform, or run everything in the official
Playwright Docker image for identical rendering across run 1 and run N. ARIA baselines are
platform-independent (one file serves every OS).

---

## 8. Gotchas that bite

- **`created` ≠ `pass`.** A run that only created baselines is *not* a green regression run. Surface it
  distinctly; don't report "all passed".
- **Don't let visual-check launch a browser.** It's designed not to — it attaches to the shared CDP session.
  If you see a connection error, you forgot to start Chrome (§0), not that you need a new browser.
- **Logged-out run 2.** MCP browser profiles are often ephemeral. If run 2 starts logged out, your path
  diverges and the baseline is junk. Restore auth via the scenario's `storageState`, or launch Chrome with a
  persistent profile. See `references/topology-setup.md`.
- **A mask that matches nothing** silently masks nothing. Always check the warning line.
- **Two tabs open?** visual-check picks the *foreground* tab by default; if it grabs the wrong one, pass
  `--url-contains` or `--page-index`.
