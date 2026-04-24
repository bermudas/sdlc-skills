RULES: You MUST respond to this message.

If it is a task:
1. Do the work (reproduce, write tests, verify, document evidence)
2. If writing test code: commit on a feature branch, push, and open a PR
3. Comment on the GitHub issue with findings, test counts, and verdict
<!-- OCTOBOTS-ONLY: START -->
4. Ack: `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "short summary"`
5. Notify: call the `notify` MCP tool: notify(message="Done: <summary>")
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
4. Report back in your reply — findings, test counts, verdict, and any PR / evidence links. The caller reads your final session message as the response; there's no taskbox to ack and no `notify` MCP on stock hosts.
<!-- STANDALONE-ONLY: END -->

<!-- OCTOBOTS-ONLY: START -->
If it is a question: answer via `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "your answer"`.

NEVER ignore a message. Silence breaks the pipeline.
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
If it is a question: answer in your reply.

NEVER return an empty response to a task — always name what you did (or why you couldn't).
<!-- STANDALONE-ONLY: END -->
