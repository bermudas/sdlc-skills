# Contract: triage (on a `fail`)

A checkpoint failed. Because you're already in the loop with the live page in front of you, classification is
nearly free — and it's the most valuable thing you do. A diff PNG is *evidence*, not a verdict. Your job is
to say **what kind** of failure this is, so the right thing happens.

## First, look
1. **Read the diff PNG** (`diffPath`) — changed pixels are red. Also read `actualPath` (live) and the
   baseline. *Where* did it change, and *what*?
2. **Read the numbers** — `diffPixels` / `diffRatio`. A handful of edge pixels reads very differently from a
   whole region recoloring.
3. **Look at the live page/DOM**, not just the image — is the app actually working, or is something broken?

## Then classify into exactly one bucket

### A) Regression — a real bug
The change is unintended: a control vanished, text overlaps, a panel collapsed, colors/spacing broke, an
error/empty state rendered.
- **Report it.** Include the diff PNG, the live screenshot/DOM, the scenario step that led here, and your
  read of what broke.
- **Do not** update the baseline. The baseline is correct; the app is wrong.

### B) Intended change — the design genuinely moved
The diff matches a real, deliberate UI change (a redesign, copy update, new spacing).
- **Propose** an update — never apply one:
  ```bash
  node "$VC" update <name> --note "intended: cart panel redesign per DES-1234"
  ```
  This writes a *candidate* to `pending/` plus an `update-request` record and leaves the live baseline
  untouched. A human promotes it (`approve`) in review, where the code change and the visual change are seen
  together.
- Never `approve` your own update to clear a red.

### C) Flake — a dynamic region leaked into the shot
The diff is confined to something that legitimately varies (a timestamp, ad, animation frame, randomized
avatar) that wasn't masked or had settled differently.
- **Don't overwrite the baseline** — that bakes the noise in.
- **Recommend a sidecar amendment**: add a `--mask` for the region, tighten a `--clip`, add a `--wait` for a
  stable element, or adjust `threshold`/`maxDiffPixelRatio` if it's sub-visual jitter. Update the scenario
  checkpoint to match so future runs are stable.
- If you mutate the sidecar, re-run the checkpoint to confirm it now `pass`es for the *right* reason (the
  noise is masked, not the signal).

## When you're unsure
Default to **B/regression-reporting over silently updating**. The expensive mistake is laundering a
regression into the golden image; the cheap mistake is asking a human to glance at a diff. If you can't tell
intended from regression, present both readings and let the human decide — don't resolve it by overwriting
the baseline.

## Output per failed checkpoint
- Classification (A/B/C) + one-line rationale.
- Links: diff PNG, actual PNG, baseline.
- The action you took or propose: report / `update`→pending (with note) / sidecar+scenario amendment.
- Never: an autonomous baseline overwrite on a fail.
