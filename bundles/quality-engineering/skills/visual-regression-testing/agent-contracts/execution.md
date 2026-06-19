# Contract: execution (runs 2..N)

A scenario and baselines already exist. Your job is **fidelity, not creativity**: reproduce run 1's path
exactly, fire the same checkpoints, and surface what changed. This leg is deliberately easy — following
rails is far cheaper than exploring, which is why a smaller/faster model can do it.

## Do
0. **Use the scenario's `id` as the test id — verbatim.** You are *given* the scenario; never invent,
   re-derive, or "tidy" its id. It is ideally a **hard id from a system of record** (TestRail `C12345`,
   Xray/Zephyr `PROJ-T123`, a Jira key, or the test spec's file path) — exactly so it's the same every run.
   The id namespaces every baseline name, so a changed id orphans all of them. Pass it as
   `--test <scenario.id>` on every call. If `suggest`/`check` warn that the page is baselined under a
   *different* test id (`crossTestMatches`), you used the wrong one — switch to the canonical id; don't fork.
1. **Start the shared Chrome** (`chrome-launcher.sh start`), and **restore auth/storageState and freeze the
   clock from the scenario before step 1** — otherwise the path diverges and every diff is noise.
2. **Walk `steps` in order.** Run each `action` with your driver, using the recorded semantic selector.
3. **At each `checkpoint`, make the identical call:**
   ```bash
   node "$VC" check <name> --locator '<recorded>' --mask '<recorded>' --viewport <recorded> --scenario <id>
   ```
   (visual-check replays the sidecar's params anyway, so the comparison stays valid even if you omit some.)
4. **Read every result's `status`** and report **two signals** per checkpoint — the pixelDiff verdict *and*
   your eyeball judgment of the screenshot. Neither overrides the other (a `fail` is a fail even if it looks
   fine; an anomaly is worth reporting even on `pass`).
5. **Heal trivial drift and continue:** a renamed selector, a reworded button, a one-pixel nudge. Adapt using
   the `intent`, reach the state, move on. Note what you healed.
6. **On any `fail`, switch to triage** (`agent-contracts/triage.md`): read the diff PNG and classify it
   (regression / intended change / flake). Don't update baselines here.

## Don't
- **Don't re-explore.** If the scenario says click "Checkout", find today's "Checkout" and click it — don't
  go discover a new flow.
- **Don't route around a functional break.** If checkout errors, an element is missing, or you hit an
  error/empty state, **stop and report it** — that's very likely the bug this run exists to catch. Working
  around it (taking a different path to still get a green) hides the failure.
- **Don't `update` or `approve` a baseline** to make a red go away. Updates are gated and human-approved.
- **Don't treat `created` as success.** If a checkpoint comes back `created`, the baseline was missing
  (renamed? wrong platform? deleted?). That's a setup problem to report, not a green run.

## Healed vs reported — the line
- **Heal** (adapt, keep going): selector moved/renamed, label reworded, cosmetic text change you can map to
  the same `intent`, sub-pixel layout shift.
- **Report** (stop, surface): missing/!visible element, error or empty state, a flow that no longer works,
  any `fail` you can't confidently attribute to intended cosmetic change.

## Done when
Every checkpoint in the scenario ran in order, each has a two-signal result, fails are triaged with diff
PNGs, and your report cleanly separates: passed, failed (with classification), healed (what + why), and any
checkpoints that came back `created` (a setup gap). If you emit a benchmark record (`--benchmark`), the run's
model/tokens/time and pass/heal/report counts complete the efficiency picture.
