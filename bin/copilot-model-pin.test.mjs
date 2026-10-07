// Copilot has no "latest Sonnet" alias (verified 2026-10-07: `model: sonnet`
// in a .agent.md makes CLI 1.0.88 fall back to the user's default model with a
// warning; VS Code maps the Claude alias to a frozen older Sonnet). The
// installer therefore resolves the authored tier at install time to Copilot's
// display names, newest first, as a list — in-order fallback on VS Code, the
// first entry on today's CLI. These tests pin that table's shape so a bump is
// deliberate and the flatten path keeps emitting what both hosts resolve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPILOT_MODEL_NAMES, copilotModelValue } from './init.mjs';

test('every alias maps to display names, newest first, Sonnet and Opus with an older sibling behind them', () => {
  for (const [alias, names] of Object.entries(COPILOT_MODEL_NAMES)) {
    assert.ok(Array.isArray(names) && names.length >= 1, alias);
    for (const n of names) assert.match(n, /^Claude (Sonnet|Opus|Haiku) \d+(\.\d+)?$/, `${alias}: ${n} is a display name, not an id or alias`);
  }
  const ver = (n) => parseFloat(n.replace(/^Claude \w+ /, ''));
  for (const alias of ['sonnet', 'opus']) {
    const names = COPILOT_MODEL_NAMES[alias];
    assert.ok(names.length >= 2, `${alias} carries a fallback`);
    for (let i = 1; i < names.length; i++) assert.ok(ver(names[i - 1]) > ver(names[i]), `${alias}: newest first`);
  }
});

test('the frontmatter value is a YAML flow list for several names and a bare name for one; unknown aliases are left alone', () => {
  assert.equal(copilotModelValue('sonnet'), `[${COPILOT_MODEL_NAMES.sonnet.join(', ')}]`);
  assert.equal(copilotModelValue('haiku'), 'Claude Haiku 4.5');
  assert.equal(copilotModelValue('gpt'), null);
});
