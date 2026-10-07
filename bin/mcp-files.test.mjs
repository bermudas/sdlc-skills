// Which MCP config files each host gets, and what goes in them.
//
// Field incident (ta-bench, 2026-09-26): `init --target copilot --mcp playwright`
// wrote `.vscode/mcp.json` + `.copilot/mcp-config.json` — and Copilot CLI 1.0.88
// reads NEITHER from a workspace (it reads `.mcp.json` / `.github/mcp.json`, and
// dropped `.vscode/mcp.json` with a migration notice). ~60 benchmark runs had no
// browser MCP at all, silently. The repo-root `.mcp.json` is now written for the
// Copilot target too — unless Claude is installed alongside, whose copy of that
// same file already serves the CLI and carries Claude's own auth shape.
//
// Second incident, same day: a `browser_evaluate` carrying an event-promise that
// never resolved sat for 30 minutes (the host's idle default) and took the build
// slot with it. The Playwright entry now carries a per-call `timeout`, emitted
// only on hosts that honour the key (Claude Code, Copilot CLI) — never into
// `.vscode/mcp.json`, whose schema does not know it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCP_CATALOG, MCP_COPILOT, MCP_JSON_HOSTS, copilotMcpFiles, mcpConfigFor } from './init.mjs';

const playwright = MCP_CATALOG.find((m) => m.id === 'playwright');
const CLAUDE = { id: 'claude', dir: '.claude' };
const COPILOT = { id: 'copilot', dir: '.github' };

test('a Copilot-only install writes the repo-root .mcp.json the CLI actually reads', () => {
  const rels = copilotMcpFiles([COPILOT]).map((h) => h.rel);
  assert.ok(rels.includes('.mcp.json'), `.mcp.json missing from ${rels}`);
  assert.ok(rels.includes('.vscode/mcp.json'), 'the VS Code extension file stays');
  assert.ok(rels.includes('.copilot/mcp-config.json'), 'the COPILOT_HOME file stays');
});

test('with Claude installed alongside, Copilot leaves .mcp.json to the Claude target', () => {
  const rels = copilotMcpFiles([CLAUDE, COPILOT]).map((h) => h.rel);
  assert.ok(!rels.includes('.mcp.json'), 'Claude owns the shared file');
  assert.deepEqual(rels, ['.vscode/mcp.json', '.copilot/mcp-config.json']);
  assert.equal(MCP_JSON_HOSTS.claude.rel, '.mcp.json', 'and Claude does write it');
});

test('the Playwright server carries a per-call timeout on hosts that honour it', () => {
  assert.equal(playwright.timeout, 120000);
  const claude = mcpConfigFor(playwright, MCP_JSON_HOSTS.claude.auth, false, MCP_JSON_HOSTS.claude.timeout);
  assert.equal(claude.timeout, 120000);
  assert.equal(claude.type, undefined, 'Claude gets no explicit stdio type');
  const cli = MCP_COPILOT.find((h) => h.rel === '.mcp.json');
  const copilot = mcpConfigFor(playwright, cli.auth, cli.stdioType, cli.timeout);
  assert.equal(copilot.timeout, 120000);
  assert.equal(copilot.type, 'stdio');
  assert.deepEqual(copilot.args, ['-y', '@playwright/mcp@latest']);
});

test('.vscode/mcp.json never gets the timeout key its schema does not know', () => {
  const vscode = MCP_COPILOT.find((h) => h.rel === '.vscode/mcp.json');
  assert.ok(!vscode.timeout);
  const out = mcpConfigFor(playwright, vscode.auth, vscode.stdioType, vscode.timeout);
  assert.equal(out.timeout, undefined);
  assert.equal(out.type, 'stdio');
});

test('servers without a catalog timeout emit none even where the host honours it', () => {
  const plain = { id: 'x', cfg: { command: 'x', args: [] } };
  assert.equal(mcpConfigFor(plain, 'literal', true, true).timeout, undefined);
});
