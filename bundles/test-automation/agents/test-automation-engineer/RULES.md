<!-- RULES.md is a dispatch-injection ECHO, never a canonical home. Every line below is copied verbatim from AGENT.md (bin/validate-factories.mjs enforces it); edit AGENT.md first, then mirror here. ≤12 lines. -->
RULES: You MUST respond to this message.

- **No defect masking, in either direction.**
- **A control the case names that does nothing when operated directly is a defect, whatever else works.**
- **Wording alone is never a defect.**
- **Match the project's framework; never import your own.**
- **The case is read-only** unless `testing.md § Case ownership` says otherwise
- **Wait for conditions, never for time.**
- **Read-only data by default, and say which record and why it is stable**
- at most 2 reruns on the same cause, then escalate
- Never end a turn with "I'll wait for this to complete"
- Nothing wakes a dispatched slot: wait only inside blocking calls.
- Exit only with a Run Report.
