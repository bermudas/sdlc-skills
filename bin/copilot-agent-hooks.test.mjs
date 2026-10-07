// A factory's hooks-copilot-agents.json names hooks that belong to ONE agent in
// VS Code Copilot Chat. The only agent-scoped lever there is the flat
// .agent.md's frontmatter `hooks:` (a subagent runs the workspace hooks plus its
// own file's — verified in Chat 0.65's runSubagent), so the installer splices the
// entries into that file, next to the SessionStart hook every Copilot agent
// already gets. These tests pin the splice: shape, placement, idempotency, and
// that a file with author-defined hooks or no frontmatter is left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectCopilotAgentHooks } from './init.mjs';

const GUARD = {
  PreToolUse: [{
    type: 'command',
    bash: '"./.github/hooks/test-automation/run-hook.cmd" lead-guard pretooluse',
    powershell: '& "./.github/hooks/test-automation/run-hook.cmd" lead-guard pretooluse',
    env: { SDLC_VSCODE: '1', SDLC_HOOK_ROLE: 'test-automation-lead' },
    timeout: 10,
  }],
};

const WITH_SESSION_START = `---
name: test-automation-lead
description: lead
hooks:
  SessionStart:
    - type: command
      bash: '"./.github/hooks/sdlc-skills/run-hook.cmd" agent-start test-automation-lead'
      env:
        SDLC_VSCODE: "1"
      timeout: 10
---
# Tal
body
`;

test('appends the event under the existing hooks: block, as YAML the VS Code loader reads', () => {
  const out = injectCopilotAgentHooks(WITH_SESSION_START, GUARD);
  const fm = out.match(/^---\n([\s\S]*?)\n---\n/)[1];
  assert.equal((fm.match(/^hooks:/gm) || []).length, 1, 'one hooks: key');
  assert.match(fm, /^  SessionStart:\n/m);
  assert.match(fm, /^  PreToolUse:\n    - type: command\n      bash: '"\.\/\.github\/hooks\/test-automation\/run-hook\.cmd" lead-guard pretooluse'\n      powershell: '& "\.\/\.github\/hooks\/test-automation\/run-hook\.cmd" lead-guard pretooluse'\n      env:\n        SDLC_VSCODE: "1"\n        SDLC_HOOK_ROLE: "test-automation-lead"\n      timeout: 10$/m);
  assert.ok(fm.indexOf('  SessionStart:') < fm.indexOf('  PreToolUse:'));
  assert.ok(out.endsWith('---\n# Tal\nbody\n'), 'body untouched');
});

test('idempotent: a second splice adds nothing', () => {
  const once = injectCopilotAgentHooks(WITH_SESSION_START, GUARD);
  assert.equal(injectCopilotAgentHooks(once, GUARD), once);
});

test('a hooks: block that is not the last key gets the event inserted before the next top-level key', () => {
  const text = `---\nname: x\nhooks:\n  SessionStart:\n    - type: command\n      bash: 'a'\nmodel: sonnet\n---\nbody\n`;
  const fm = injectCopilotAgentHooks(text, GUARD).match(/^---\n([\s\S]*?)\n---\n/)[1];
  const lines = fm.split('\n');
  assert.ok(lines.indexOf('  PreToolUse:') > lines.indexOf('  SessionStart:'));
  assert.ok(lines.indexOf('  PreToolUse:') < lines.indexOf('model: sonnet'));
});

test('no hooks: key yet → a new block; no frontmatter or empty spec → unchanged', () => {
  const out = injectCopilotAgentHooks('---\nname: x\n---\nbody\n', GUARD);
  assert.match(out, /^---\nname: x\nhooks:\n  PreToolUse:\n/);
  assert.equal(injectCopilotAgentHooks('# no frontmatter\n', GUARD), '# no frontmatter\n');
  assert.equal(injectCopilotAgentHooks(WITH_SESSION_START, {}), WITH_SESSION_START);
  assert.equal(injectCopilotAgentHooks(WITH_SESSION_START, { PreToolUse: 'not a list' }), WITH_SESSION_START);
});

test("single quotes in a command are doubled, so the YAML stays valid", () => {
  const out = injectCopilotAgentHooks('---\nname: x\n---\n', { Stop: [{ bash: "echo 'hi'" }] });
  assert.match(out, /bash: 'echo ''hi'''/);
});
