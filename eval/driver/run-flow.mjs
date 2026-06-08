#!/usr/bin/env node
// eval/driver/run-flow.mjs
// ---------------------------------------------------------------------------
// The two-stage E2E flow, as a real run STARTS:
//   Stage 0 — SEED: scout seeds the project → hooks inject the artifacts →
//             score the seeding (artifacts · facts · injection).
//   Stage 1 — RUN:  hand Tal the case → capture the trajectory → score
//             conformance + outcome (dual-run).
//
// Stage 0 runs FOR REAL here, offline: it uses the fixture's golden `seeded/`
// tree as scout's output and executes the real hooks. (Replacing the golden tree
// with a live scout dispatch is the only SDK-gated part of Stage 0.)
// Stage 1 needs the Agent SDK + auth + the team/fixture wiring (see run-e2e.mjs).
//
//   node eval/driver/run-flow.mjs --stage 0 --fixture todomvc --role test-automation-engineer
// ---------------------------------------------------------------------------
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentStart, parseInjection } from "./run-hooks.mjs";
import { scoreSeeding } from "../spine/seeding.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const stage = arg("--stage", "0");
const fixture = arg("--fixture", "todomvc");
const role = arg("--role", "test-automation-engineer");

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

function stage0(fixtureDir) {
  const seeded = join(fixtureDir, "seeded");
  if (!existsSync(seeded)) { console.error(`No seeded/ tree in ${fixtureDir} (run scout first).`); process.exit(1); }

  const present = walk(seeded);
  const roles = present
    .filter((p) => /\.agents\/memory\/[^/]+\/MEMORY\.md$/.test(p))
    .map((p) => p.split("/")[2]);
  const doc = present.filter((p) => p.endsWith(".md")).map((p) => readFileSync(join(seeded, p), "utf8")).join("\n\n");
  const { facts } = JSON.parse(readFileSync(join(fixtureDir, "facts", "facts.json"), "utf8"));

  // Real hook execution = the injection check.
  let injection = { shared: [], memory: false };
  try {
    injection = parseInjection(runAgentStart(REPO, seeded, role));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    console.warn("(bash unavailable — injection check skipped)");
  }

  const s = scoreSeeding({ present, roles, facts, doc, injection });
  console.log(`\n=== Stage 0 · SEED · fixture=${fixture} role=${role} ===`);
  console.log(`artifacts:   ${s.artifacts.presentCount}/${s.artifacts.requiredTotal} required present (coverage ${s.artifacts.coverage})${s.artifacts.missing.length ? " · MISSING: " + s.artifacts.missing.join(", ") : ""}`);
  console.log(`facts:       recall ${s.facts.recall}${s.facts.dangerousErrors.length ? " · DANGEROUS WRONG: " + s.facts.dangerousErrors.join(", ") : " · no dangerous fabrications"}`);
  console.log(`injection:   shared=[${injection.shared.join(", ")}] memory=${injection.memory} → ${s.injection.ok ? "OK" : "INCOMPLETE"}`);
  console.log(`SEEDING USABLE: ${s.usable ? "YES ✓" : "NO ✗"}  (good enough to build the pipeline on)`);
  return s;
}

const fixtureDir = join(HERE, "..", "fixtures", fixture);
stage0(fixtureDir);

if (stage !== "0") {
  console.log(`\n=== Stage 1 · RUN ===`);
  console.log("Needs the Agent SDK + auth + team wiring. Run:  node eval/driver/run-e2e.mjs --case complete-todo");
  console.log("(dispatch Tal → capture trajectory → extract-trace → conformance + dual-run outcome)");
}
