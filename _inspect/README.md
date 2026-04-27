# `_inspect/`

Read-only working area for studying external Claude Code plugins, skills,
or projects whose shape might inform sdlc-skills design. Content here is
**not installed** by `bin/init.mjs` (the installer reads `skills/` and
`agents/` only) and is **not shipped** through any plugin manifest.

## Current contents

- `claude-code-setup/` — Anthropic's official `claude-code-setup` plugin
  (cloned from `anthropics/claude-plugins-official`,
  `plugins/claude-code-setup/`). Single-skill plugin
  (`claude-automation-recommender`) that scans a codebase and recommends
  hooks / skills / MCP servers / subagents / slash commands. Read-only
  by design. Useful as a reference for progressive-disclosure structure
  on Anthropic-authored skills.

When the inspection is done — either lift learnings into our own skills
and delete the copy, or formalize it as a real external skill via
`skills.json`.
