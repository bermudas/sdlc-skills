# Contract: authoring (run 1)

You are establishing the test for the first time. Two deliverables: **trustworthy baselines** and a
**replayable scenario**. Everything later depends on getting this run right — a sloppy baseline becomes a
golden image that hides bugs forever, and a vague scenario makes runs 2..N drift.

## Mindset
Run 1 is the expensive, exploratory leg. You may navigate freely, read the page, try selectors. But as you
go, *record* what worked so a cheaper model can follow the rails next time without exploring.

## Do
1. **Start the shared Chrome first** (`chrome-launcher.sh start`), then navigate with your driver. Confirm
   visual-check and your driver are on the same page (`pageUrl` in visual-check's output).
2. **Reach each intended state deliberately.** Settle the page (data loaded, modal fully open) before the
   checkpoint — you're defining "correct".
3. **Scope every checkpoint** with `--locator` (or `--clip`). Prefer the smallest region that contains what
   you're actually testing. Full-page baselines are brittle; only use them with a deliberate
   `--allow-full-page` and a reason.
4. **Mask the genuinely dynamic** — timestamps, session/order ids, ads, anything that legitimately differs
   run to run. Verify each mask matched (no zero-match warnings). Don't over-mask; a mask hides regressions
   too.
5. **Pin the viewport** (`--viewport WxH`) so dimensions are stable across runs.
6. **Eyeball every `created`.** `created` is not a pass — it's you certifying the golden image. Read the
   baseline PNG the tool wrote. If it shows a spinner, a half-loaded list, an error toast, or the wrong
   state: fix the page and re-create. A bad baseline is worse than none.
7. **Fix the test id from a system of record — once.** Use the hard id your test stack assigns (TestRail
   `C12345`, Xray/Zephyr/Jira `PROJ-T123`, or the spec file's path); only mint a label if none exists. This
   id namespaces every baseline, so it must be identical on every future run — pass it as `--test <id>`
   (optionally `--title` / `--source`) and record it as the scenario `id`. **Before authoring, consult the
   registry**: `node "$VC" tests --route <key>` — if a test id already covers this flow, reuse it; don't
   fork a variant.
8. **Resolve checkpoint names, don't invent them.** At each checkpoint run `node "$VC" suggest --test <id>
   --locator '<region>' --state <word>` and use what it returns (`<id>.<route>.<region>.<state>`). If it says
   `action:"reuse"`, a baseline already covers this state — use that name. Heed any `crossTestMatches` warning
   (the page is baselined under a different id → you picked the wrong test id).
9. **Emit the scenario** (`scenarios/<id>.json`, format in `references/scenario-format.md`): record the hard
   `id` (+ `source`/`title`), each navigation as an `action` with a *semantic* selector + `intent`, each
   baseline as a `checkpoint` with the params you used, plus viewport/storageState/frozen clock. Pass
   `--test <id>` on every check so artifacts are namespaced to this test case.

## Don't
- Don't capture mid-transition (animations still running, fonts swapping, data still arriving). visual-check
  disables animations and waits for fonts/network, but it can't know your app's "ready" — use `--wait <sel>`
  for a stable element if needed.
- Don't record brittle selectors (`#app > div:nth-child(3)`). Use roles/labels so execution can heal drift.
- Don't leave a dynamic region unmasked "for now" — it will fail every future run and train everyone to
  ignore reds.

## Done when
- Every intended state has a baseline you've visually confirmed.
- No zero-match mask warnings remain.
- `scenarios/<id>.json` lists every action (semantic) and every checkpoint (with params), enough that a
  different, cheaper model could reach the same states tomorrow without exploring.
- You report what you created: the list of baseline names, their scope/masks, and any state you couldn't
  reach (and why).
