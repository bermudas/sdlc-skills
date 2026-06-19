# Topology: one shared browser for all four tools

visual-check's whole value depends on screenshotting the **same page** the agent navigated — not a fresh
browser at the wrong state. That only works if every browser tool shares **one** Chrome over a single CDP
endpoint. This file is the setup, the `.mcp.json`, and the failure modes.

## The shared session

```
                       ┌─────────────────────────────────────┐
   chrome-launcher.sh  │   ONE Chrome  --remote-debugging-port=9222   │
   START THIS FIRST ──▶│      (one user-data-dir, one set of tabs)    │
                       └───▲────────▲────────▲───────────▲────────────┘
                           │        │        │           │
          Playwright MCP ──┘        │        │           └── visual-check
        (--cdp-endpoint)   chrome-devtools MCP   browser-verify
                            (--browser-url)      (cdp.mjs, same port)
```

One Chrome. Four clients attach to it over CDP. Whoever navigates (Playwright MCP / chrome-devtools MCP /
browser-verify) moves the shared page; visual-check then screenshots that exact page. No tool launches a
second browser.

## Step 0, every session: start the shared Chrome

The MCP servers connect *lazily* (on first browser tool call), so as long as Chrome is up before the first
navigation, ordering is fine. Make starting it the first thing you do:

```bash
SKILLS=".claude/skills"
bash "$SKILLS/browser-verify/scripts/chrome-launcher.sh" start            # headed, port 9222
bash "$SKILLS/browser-verify/scripts/chrome-launcher.sh" start --headless # CI / no display
bash "$SKILLS/browser-verify/scripts/chrome-launcher.sh" status           # {"status":"running",...}
bash "$SKILLS/browser-verify/scripts/chrome-launcher.sh" stop             # when done
```

This launches Chrome with `--remote-debugging-port=9222` and a fixed profile (`/tmp/chrome-cdp-profile`).
A different port: `--port 9333` on the launcher, and pass `--cdp http://127.0.0.1:9333` to visual-check
(or set `VISUAL_CDP_URL`) and matching endpoints on the MCPs.

## `.mcp.json` — point Playwright MCP at the shared endpoint

By default `@playwright/mcp` launches *its own* browser, which visual-check can't see. Change it to attach
to the shared one. chrome-devtools MCP is already correct (`--browser-url=http://127.0.0.1:9222`).

```jsonc
{
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      // attach to the shared Chrome instead of launching a new one:
      "args": ["@playwright/mcp@latest", "--cdp-endpoint", "http://127.0.0.1:9222"]
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest", "--browser-url=http://127.0.0.1:9222", "-y"]
    }
  }
}
```

> Editing `.mcp.json` takes effect only on a **new session** (MCP servers start at session launch). After
> editing, restart, then run chrome-launcher `start` before your first navigation. If Playwright MCP is set
> to `--cdp-endpoint` and no Chrome is on 9222 when you first call it, it will error — start Chrome first.

### Don't want to touch Playwright MCP?
Two other ways to keep one shared browser:
- **Drive with browser-verify + visual-check only.** `browser-verify`'s `cdp.mjs` already uses port 9222;
  navigate/click with it and call visual-check — no Playwright MCP involved.
- **Drive with chrome-devtools MCP** (already on 9222) and call visual-check. Also fully shared.

Playwright MCP is only one of several drivers; the invariant is *single Chrome on the CDP port*, not *which*
tool moves it.

## Picking the right tab

With multiple tabs open, visual-check screenshots the **foreground/visible** tab. Override when needed:

```bash
node "$VC" check checkout --url-contains '/checkout' --locator 'main'
node "$VC" check checkout --page-index 1 --locator 'main'
```

`node "$VC" list` and the `pageUrl` field in every result tell you which page it acted on — check it if a
result looks wrong.

## Auth / persisted state (the run-2-logged-out trap)

A fixed profile (chrome-launcher uses `/tmp/chrome-cdp-profile`) persists cookies between runs, so a login in
run 1 usually survives. For clean, reproducible auth instead of relying on a warm profile, restore a
`storageState` at the start of each run (recorded in the scenario, see `scenario-format.md`) using your
driver, *before* navigating to the first checkpoint. If run 2 lands on a login page, the path has diverged
and any baseline captured is meaningless — fix auth before trusting results.

## Rendering consistency across runs

Screenshots depend on fonts, OS, and GPU, so baselines are stored per platform
(`<name>__chromium-<os>.png`). A baseline captured on macOS must not be compared on Linux. For stable run-1
vs run-N rendering — especially in CI — run everything inside the official Playwright image
(`mcr.microsoft.com/playwright`) so the render environment is identical every time, and let visual-check
manage the `chromium-linux` baselines there.

## Quick health check

```bash
curl -s http://127.0.0.1:9222/json/version | head -c 200   # is Chrome's CDP up?
node "$VC" list                                            # does visual-check see the data root?
# navigate somewhere with any driver, then:
node "$VC" check smoke --allow-full-page                   # should return status: created
```
