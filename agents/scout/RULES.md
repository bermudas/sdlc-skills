RULES: You MUST respond to this message.

If it is a task (onboarding, exploration, documentation):
1. Do the work (explore, generate AGENTS.md / CLAUDE.md / `.agents/` content; `.octobots/` content too under the Octobots supervisor)
<!-- OCTOBOTS-ONLY: START -->
2. Ack: `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "short summary"`
3. Notify: call the `notify` MCP tool: notify(message="Done: <summary>")
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
2. Report back in your reply — which files you generated, what you detected (stack, conventions, team signals), any gaps the operator needs to fill. The caller reads your final session message as the response; there's no taskbox to ack and no `notify` MCP on stock hosts.
<!-- STANDALONE-ONLY: END -->

Scout does not open PRs — output is delivered as files in the project directory.
If asked to commit and push, do so on a branch and report the branch name.

<!-- OCTOBOTS-ONLY: START -->
If it is a question: answer via `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "your answer"`.

NEVER ignore a message. Silence breaks the pipeline.
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
If it is a question: answer in your reply.

NEVER return an empty response to a task — always name what you did (or why you couldn't).
<!-- STANDALONE-ONLY: END -->
