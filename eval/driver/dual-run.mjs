#!/usr/bin/env node
// eval/driver/dual-run.mjs
// ---------------------------------------------------------------------------
// Execute a test against BOTH fixture builds in a real browser and return the
// {passedOnClean, failedOnBug} that spine/dual-run.classifyDualRun consumes —
// the OUTCOME oracle. Static serving is stdlib (http+fs); the browser is
// Playwright (a dep). Resolves an installed chromium headless-shell from the
// ms-playwright cache (no fresh download).
//
//   node eval/driver/dual-run.mjs --fixture todomvc          # golden complete-todo test
// ---------------------------------------------------------------------------
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyDualRun } from "../spine/dual-run.mjs";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

/** Serve a directory on an ephemeral port; returns { url, close }. */
export async function serveDir(dir) {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]);
    const file = join(dir, rel === "/" ? "index.html" : rel);
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

/** Find an installed chromium headless-shell so we don't download one. */
export function resolveChromium() {
  if (process.env.PLAYWRIGHT_EXECUTABLE && existsSync(process.env.PLAYWRIGHT_EXECUTABLE)) return process.env.PLAYWRIGHT_EXECUTABLE;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return undefined;
  const builds = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const b of builds) {
    for (const arch of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64", "chrome-headless-shell-linux64"]) {
      const p = join(cache, b, arch, "chrome-headless-shell");
      if (existsSync(p)) return p;
    }
  }
  return undefined; // fall back to Playwright's default resolution
}

/** Golden test for the complete-todo case: returns true iff the todo gets marked completed. */
export async function goldenCompleteTodo(page, url) {
  await page.goto(url);
  await page.getByTestId("new-todo").fill("buy milk");
  await page.getByTestId("new-todo").press("Enter");
  await page.getByTestId("toggle").check();
  return page.locator('[data-testid="todo-item"]').evaluate((el) => el.classList.contains("completed"));
}

async function runOnce(ctx, url, test) {
  const page = await ctx.newPage();
  try { return !!(await test(page, url)); } catch { return false; } finally { await page.close(); }
}

/** Run `test` against clean + bug builds → {passedOnClean, failedOnBug}. */
export async function dualRun({ cleanDir, bugDir, test = goldenCompleteTodo }) {
  const { chromium } = await import("playwright");
  const exe = resolveChromium();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const clean = await serveDir(cleanDir), bug = await serveDir(bugDir);
  try {
    const ctx = await browser.newContext();
    const passedOnClean = await runOnce(ctx, clean.url, test);
    const passedOnBug = await runOnce(ctx, bug.url, test);
    return { passedOnClean, failedOnBug: !passedOnBug };
  } finally { await browser.close(); await clean.close(); await bug.close(); }
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const a = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const base = join(HERE, "..", "fixtures", a("--fixture", "todomvc"));
  const r = await dualRun({ cleanDir: join(base, "v-clean"), bugDir: join(base, "v-bug-001") });
  const cls = classifyDualRun(r);
  console.log("dual-run:", JSON.stringify(r), "→", cls.category, cls.real ? "(REAL ✓ — passes clean, catches the bug)" : `(${cls.note})`);
}
