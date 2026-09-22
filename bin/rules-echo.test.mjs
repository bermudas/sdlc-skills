import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rulesEchoViolations, RULES_ECHO_OPT_IN } from './validate-factories.mjs';

// RULES.md is delivered to dispatched agents by the hooks and to nothing else
// (never the top-level agent, and on Copilot only once the installer copies it
// beside SOUL.md). So it must never be the only home of a rule: an opted-in
// RULES.md is a verbatim echo of AGENT.md, and this is the check that keeps it
// one when either file is edited.

const AGENT = `---
name: x
---
# X

## Host rules

1. **Nothing wakes you.** No host sends a notification when a job finishes.
2. **One unit per dispatch.** Anything else is context.

Retry budget: **≤ 2 reruns** against the same root cause.
`;

test('a faithful echo passes, comments and the RULES: preamble are skipped', () => {
  const rules = `<!-- echo: every line is ${RULES_ECHO_OPT_IN} -->
RULES: You MUST respond to this message.

- **Nothing wakes you.** No host sends a notification when a job finishes.
- **One unit per dispatch.**
`;
  assert.deepEqual(rulesEchoViolations(AGENT, rules), []);
});

test('a rule that exists only in RULES.md is reported', () => {
  const rules = `<!-- ${RULES_ECHO_OPT_IN} -->
- **One unit per dispatch.**
- **Only MCP, never Python.**
`;
  assert.deepEqual(rulesEchoViolations(AGENT, rules), ['- **Only MCP, never Python.**']);
});

test('whitespace differences are tolerated, wording differences are not', () => {
  const rules = `<!-- ${RULES_ECHO_OPT_IN} -->
- Retry budget:   **≤ 2 reruns** against   the same root cause.
- Retry budget: **≤ 3 reruns** against the same root cause.
`;
  const bad = rulesEchoViolations(AGENT, rules);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /≤ 3/);
});

test('a RULES.md that did not opt in is left alone', () => {
  assert.deepEqual(rulesEchoViolations(AGENT, '- anything goes here\n'), []);
});

test('every opted-in RULES.md in the repo is a faithful echo of its AGENT.md', () => {
  const root = fileURLToPath(new URL('../bundles', import.meta.url));
  for (const f of readdirSync(root)) {
    const agentsDir = join(root, f, 'agents');
    if (!existsSync(agentsDir)) continue;
    for (const a of readdirSync(agentsDir)) {
      const ap = join(agentsDir, a, 'AGENT.md');
      const rp = join(agentsDir, a, 'RULES.md');
      if (!existsSync(ap) || !existsSync(rp)) continue;
      const bad = rulesEchoViolations(readFileSync(ap, 'utf8'), readFileSync(rp, 'utf8'));
      assert.deepEqual(bad, [], `${f}/agents/${a}/RULES.md drifted from AGENT.md`);
    }
  }
});
