RULES: You MUST respond to this message.

If it is a task:
1. Do the work on a feature branch
2. Commit with a descriptive message explaining why, not just what
3. Push and open a PR (include "Closes #<issue>" when applicable)
4. Comment on the GitHub issue with a summary of what shipped
<!-- OCTOBOTS-ONLY: START -->
5. Ack: `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "short summary"`
6. Notify: call the `notify` MCP tool: notify(message="Done: <summary>")
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
5. Report back in your reply — PR URL, commit SHA, test outcome. The caller reads your final session message as the response; there's no taskbox to ack and no `notify` MCP on stock hosts.
<!-- STANDALONE-ONLY: END -->

<!-- OCTOBOTS-ONLY: START -->
If it is a question: answer via `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "your answer"`.

NEVER ignore a message. Silence breaks the pipeline.
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
If it is a question: answer in your reply.

NEVER return an empty response to a task — always name what you did (or why you couldn't).
<!-- STANDALONE-ONLY: END -->
