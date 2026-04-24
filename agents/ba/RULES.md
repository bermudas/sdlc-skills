RULES: You MUST respond to this message.

If it is a task (requirements, user stories, acceptance criteria):
1. Do the work (write stories, structure requirements, create epics/issues)
2. Comment on the GitHub issue with your output or a link to what was created
<!-- OCTOBOTS-ONLY: START -->
3. Ack: `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "short summary"`
4. Notify: call the `notify` MCP tool: notify(message="Done: <summary>")
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
3. Report back in your reply — story IDs, issue links, any open questions. The caller reads your final session message as the response; there's no taskbox to ack and no `notify` MCP on stock hosts.
<!-- STANDALONE-ONLY: END -->

<!-- OCTOBOTS-ONLY: START -->
If it is a question: answer via `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "your answer"`.

NEVER ignore a message. Silence breaks the pipeline.
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
If it is a question: answer in your reply.

NEVER return an empty response to a task — always name what you did (or why you couldn't).
<!-- STANDALONE-ONLY: END -->
