#!/usr/bin/env node
// eval/runner.mjs — thin layer-aware entrypoint.
//
//   node eval/runner.mjs --layer 0 --bundle test-automation   # landing/structural (zero-dep, now)
//   node eval/runner.mjs --layer spine                         # shared scorer unit tests (now)
//   node eval/runner.mjs --layer 1 --bundle test-automation   # component evals (needs fixtures+SDK)
//   node eval/runner.mjs --layer 2 --case todo-toggle --perturb mask  # E2E orchestrated (needs SDK)
//
// Layers 0/spine run today with zero deps. Layers 1/2 shell to the driver
// (deps live in eval/package.json; `cd eval && npm install`).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const layer = opt("--layer", "0");
const bundle = opt("--bundle", "test-automation");

function nodeTest(globs) {
  const r = spawnSync(process.execPath, ["--test", ...globs], { cwd: HERE, stdio: "inherit" });
  process.exit(r.status ?? 1);
}

if (layer === "spine") {
  nodeTest(["spine/*.test.mjs"]);
} else if (layer === "scout") {
  // Stage 0 — real seeding eval (artifacts · facts · live hook injection), offline.
  const flow = join(HERE, "driver", "run-flow.mjs");
  const passthru = args.filter((a) => !["--layer", "scout"].includes(a));
  const r = spawnSync(process.execPath, [flow, "--stage", "0", ...passthru], { cwd: HERE, stdio: "inherit" });
  process.exit(r.status ?? 1);
} else if (layer === "0") {
  const glob = `suites/${bundle}/layer0-*.test.mjs`;
  if (!existsSync(join(HERE, "suites", bundle))) { console.error(`No suites for bundle "${bundle}"`); process.exit(1); }
  nodeTest([glob]);
} else if (layer === "1") {
  console.log(`Layer 1 (component evals) for ${bundle}: not yet wired.`);
  console.log("Needs: fixture builds (v-clean/v-bug-NNN) + the live-agent component runner (driver).");
  console.log("Deterministic scorers already exist in spine/ (usage, passk, trajectory, conformance).");
  process.exit(0);
} else if (layer === "2") {
  const driver = join(HERE, "driver", "run-e2e.mjs"); // SDK deep lane (Claude)
  const passthru = args.filter((a) => !["--layer", "2", "--bundle", bundle].includes(a));
  const r = spawnSync(process.execPath, [driver, ...passthru], { cwd: HERE, stdio: "inherit" });
  process.exit(r.status ?? 1);
} else if (layer === "acp") {
  const driver = join(HERE, "driver", "run-e2e-acp.mjs"); // ACP portability lane (any backend)
  const passthru = args.filter((a) => !["--layer", "acp", "--bundle", bundle].includes(a));
  const r = spawnSync(process.execPath, [driver, ...passthru], { cwd: HERE, stdio: "inherit" });
  process.exit(r.status ?? 1);
} else {
  console.error(`Unknown --layer "${layer}". Use: 0 | spine | scout | 1 | 2 | acp`);
  process.exit(1);
}
