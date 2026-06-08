// eval/driver/run-hooks.mjs
// ---------------------------------------------------------------------------
// Execute the REAL injection hooks against a seeded project dir and parse what
// they inject. This is how we prove the artifact→hook chain end-to-end (no model
// needed). `agent-start` supports a documented standalone mode: pass the role as
// $1 and SDLC_HOOK_RAW=1 to get the raw injected context on stdout.
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** Run hooks/agent-start for `role` against `projectDir`; return raw stdout. */
export function runAgentStart(repoRoot, projectDir, role) {
  return execFileSync("bash", [join(repoRoot, "hooks", "agent-start"), role], {
    env: { ...process.env, SDLC_HOOK_RAW: "1", CLAUDE_PROJECT_DIR: projectDir },
    encoding: "utf8",
  });
}

/** Parse injected context into { shared:[".agents/x.md"], memory:bool, raw }. */
export function parseInjection(text) {
  const shared = [...String(text).matchAll(/^#\s+\.agents\/([\w-]+)\.md/gm)].map((m) => `.agents/${m[1]}.md`);
  const memory = /#\s+Your (?:persistent memory|persona) — \.agents\/memory\//.test(text);
  return { shared: [...new Set(shared)], memory, raw: text };
}
