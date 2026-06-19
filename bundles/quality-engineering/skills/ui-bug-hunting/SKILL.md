---
name: ui-bug-hunting
description: Bug-hunting discipline for UI test execution — find bugs, don't just pass tests. Use whenever executing test cases against a web UI, verifying pages or screenshots, doing exploratory or visual testing, or judging whether a build "looks right". Covers the hunt method (Job A/Job B, the four questions after every action, oracle challenges, findings ledger, pre-PASS reflection) plus a six-pass visual inspection for every screenshot (layout by measurement, image–text coherence, test-data leaks, passive page health, evidence quality). Load for any browser-driven test execution, manual case run, UI verification, fix verification, or "check this page" request — even when the task only asks for a pass/fail verdict.
license: Apache-2.0
metadata:
  authors:
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.1.0"
---

# UI Bug-Hunting

This skill governs *how you test*, not *what you test* — the test case supplies
the what. Application-agnostic: it works on any web UI, any product, any
test-management process.

It exists because of a documented failure mode: agents that execute test cases
faithfully, verify every expected result, produce green verdicts — and walk
straight past bugs that were visible in their own screenshots. A passed test
and a missed bug are not opposites; they routinely co-occur. This skill is
designed to break that.

**How to use it:** follow the method below for the whole run. Before taking
your first screenshot, read `references/visual-inspection.md` — the six-pass
inspection you will apply to every screenshot. Apply both for every case you
execute.

---

## 0 — The prime directive

**Your deliverable is findings. The verdict is a by-product.**

A test case is a tour route through the application — the steps tell you where
to walk, not what you're allowed to see. You are graded on what you noticed
along the way, not on how efficiently you confirmed the expected results.

Corollaries:

- A PASS with zero observations on a non-trivial page is a **weak deliverable**
  and should make you suspicious of yourself, not proud of the application.
- A bug found outside the test's scope is worth *more* than the scripted
  verification, because nobody else was going to look there.
- You are never penalized for reporting too much. You are silently failing when
  you report too little. When unsure whether something is a finding — it is.

---

## 1 — Every step has two jobs

For each test step, do both, always, in this order:

**Job A — Verify.** Did the expected result happen? This is the scripted
assertion. Confirm it against real evidence (snapshot, screenshot you have
actually read, network response — never the automation tool's return value
alone).

**Job B — Hunt.** Job A looked at one element. Job B looks at everything else.
The expected result happening does NOT answer Job B — that is the confirmation
tunnel, and it is how bugs survive green runs.

Never let Job A's success close Job B early. They are independent
investigations that happen to share a screenshot.

---

## 2 — The four questions after every action

Every action transforms page state. Interrogate the transformation:

1. **What did I expect to change — did it?** (Job A.)
2. **What changed that I did not expect?** New element, moved element, new
   console line, new network call, changed URL, changed title, new cookie
   banner, scroll jump. Anything.
3. **What should have changed but didn't?** Submitted a form — did the button
   show a pressed/loading state? Added an item — did the counter increment?
   Navigated — did the page title update, not just the body?
4. **What stayed the same that deserves a second look?** State that persists
   across steps is where contamination hides: a cart badge that should be
   empty, a username field that should have cleared, a session that should
   have ended.

Questions 2–4 are where bugs live. Question 1 alone is what "just passing
tests" looks like.

---

## 3 — Challenge the oracle

The expected result in the test case is itself an artifact that can be wrong,
stale, or underspecified. Meeting it is not the end of judgement.

- **Expected result met, but the outcome is still wrong.** The error message
  matches the spec character-for-character — and it overlaps the button below
  it. The page "is displayed" — with an item named in method-call syntax like
  `Item.renderAll()`. Verify the letter, then judge the spirit. A met
  expectation that produces a bad user outcome is a finding.
- **Expected result is underspecified.** "Page is displayed" — displayed
  *correctly*? "Error is shown" — *which* error, *where*, styled *how*? When
  the oracle is vague, verify the strictest reasonable interpretation and
  record what interpretation you used.
- **Expected result looks wrong.** If the expected result contradicts the
  requirement, the page's own behavior, or common sense — do not silently
  comply and do not silently "fix" it. Execute, record actual behavior, and
  flag the contradiction as a question. You don't own the requirement; you do
  own the duty to challenge it.

---

## 4 — Rotate perspectives on every settled state

After each step settles, look at the page as four different people. Each
perspective catches a class of bug the others are blind to:

| Perspective | Ask | Catches |
|---|---|---|
| **First-time user** | What would confuse me if I'd never seen this page? | Unclear labels, ambiguous icons, surprising layout, missing guidance |
| **Paying customer** | What feels broken, cheap, or untrustworthy? | Misaligned elements, lorem ipsum, $0.00 prices, clipped text, ugly overlap |
| **Product owner** | Does this state deliver what the story intended? | Intent gaps — technically correct, functionally pointless |
| **Developer** | What looks like leaked internals or a half-finished integration? | Test data in prod UI (method-call names, `MOCK_` prefixes, seeded emails), placeholder tokens in URLs, debug output, console noise |

You don't need a section per perspective in the report — you need the *looks*.
One sentence per perspective is enough when clean.

---

## 5 — Look beneath the pixels

The screenshot is one evidence layer. Bugs hide in the layers a screenshot
cannot show. After every step, sweep:

- **Console** — errors AND warning patterns. New entries since the last step
  matter more than the total. An error appearing exactly when you performed
  the action is correlated with the action until proven otherwise.
- **Network** — three distinct sweeps:
  - *Failures:* any 4xx/5xx/aborted call. A clean UI over a failed request is
    a defect, not a pass — the UI is lying.
  - *Suspicious destinations:* calls to localhost, dev/staging hosts, or URLs
    containing placeholder literals (`YOUR_KEY`, `INSERT_TOKEN`, `CHANGEME`,
    `example.com`, or an SDK's documented dummy values) — misconfigured
    integrations ship silently.
  - *Missing calls:* did the action that should have produced a request
    produce one? A "saved" toast with no PUT/POST behind it is a mock leaking
    into reality.
- **URL & title** — does the address bar agree with what the body shows? Query
  params leaking internal IDs or tokens? Title still showing the previous
  page's name?
- **Timing** — note anything that took noticeably long, flashed multiple
  repaints, or settled twice. Grade as observation, not defect, unless the
  case asserts performance.
- **State continuity** — across steps and cases: cookies, badges, field
  values, login state. Anything inherited that should have been reset is a
  finding even when it doesn't block the current step.

For the **pixel layer itself**, apply the six-pass visual inspection from
`references/visual-inspection.md` (render → layout → content → interactive
state → passive health → evidence quality), including image–text semantic
coherence, test-data-leak detection, and geometric uniformity by DOM
measurement. Read that file before your first screenshot if you have not
already.

---

## 6 — The findings ledger

Maintain one ledger for the whole run. Every deviation goes in at the moment
you see it — graded later, dropped never.

Classify each entry:

| Class | Definition | Example |
|---|---|---|
| **Functional failure** | Expected result not met | Login succeeds with wrong password |
| **Visual defect** | Renders wrong: overlap, clipping, broken layout | Banner covers button |
| **Content defect** | Wrong/leaked/incoherent content | Method-call syntax as an item name; image depicting a different product than its label |
| **Behavioral oddity** | Works, but oddly | Double render, focus jump, needs two clicks |
| **Under-the-surface** | Invisible in UI, visible in console/network | 401s to placeholder telemetry; missing POST behind "saved" |
| **Question / intent gap** | Spec met but outcome doubtful; oracle suspect | Error message technically correct but user-hostile |
| **Exploration candidate** | Untested path one step away, worth a future case | "What happens if I dismiss the error banner — does state reset?" |

Grading stays simple: ✅ verified clean (say what you saw) · ⚠️ anomaly,
doesn't block the functional result, described exactly · ❌ invalidates or
contradicts the step. An ❌ anywhere fails the step regardless of the scripted
assertion's outcome. A ⚠️ never silently disappears — it rides to the report.

**No self-issued waivers.** You may call something "known noise" only when the
dispatch or a prior recorded run explicitly says so — and you still log its
occurrence with a count. Noise that nobody re-examines is how real failures
learn to hide. The moment "known noise" changes shape — new endpoint, new
frequency, new error code — it is no longer known. Report it fresh.

---

## 7 — Before you mark any case PASS

Complete this reflection, in writing, in your output:

1. **"The most suspicious thing I saw during this case was ______."**
   You must fill the blank. If after genuine reflection nothing qualifies,
   write what you actively ruled out and how — "nothing suspicious" is only
   credible next to the list of places you looked.
2. **"If a bug ships from this page next week, it will most likely be ______."**
   Forced prediction. It costs one sentence and it surfaces the doubt you were
   about to swallow.
3. **Ledger check** — is every deviation you noticed anywhere in this run
   recorded with a class and a grade? Anything you remember seeing but didn't
   write down goes in now.

These three lines are the antidote to green bias. A reviewer reading only them
should still learn something true about the page.

---

## 8 — Scope discipline

Hunting is not wandering. The boundary:

- **Observe freely, execute scripted.** Notice everything; perform only the
  case's steps. The "what if I click that?" impulse becomes an **exploration
  candidate** in the ledger — one line, not an excursion.
- **One detour ration.** If something looks seriously wrong *adjacent* to your
  path (a dead link in the nav you're using, a second error banner behind the
  first), you may spend ONE action examining it — then back to the script,
  evidence in the ledger either way.
- **Never "fix" the journey.** Wrong test data, broken precondition, missing
  account — that's a BLOCKED verdict with a finding, not an improvisation.

---

## 9 — Anti-patterns — name them to avoid them

| Anti-pattern | What it looks like | The tell |
|---|---|---|
| **Confirmation tunnel** | Only ever looking at the element being asserted | Report mentions nothing outside the locator's bounding box |
| **Green bias** | Treating PASS as the goal and findings as friction | Zero ⚠️ across a whole run on a real application |
| **Scope shield** | Dismissing an anomaly as "not part of this step" | "Out of scope" appearing where a ledger entry should be |
| **Noise blindness** | Auto-waiving recurring errors without recording | "Same as before" with no count, no check that it *is* the same |
| **Oracle worship** | Following a wrong expected result into a wrong verdict | Spec met, user harmed, nothing flagged |
| **Tool trust** | Citing the automation tool's return value as evidence | "Click succeeded" with no post-state verification |

---

## 10 — Worked contrast: passing vs hunting

Same page, same step — "Click Sign in → the catalogue page is displayed":

**Test-passer output:**
> Step 4 PASS — URL is /catalogue, heading shows "Catalogue".

**Bug-hunter output:**
> Step 4 PASS (Job A) — URL /catalogue, "Catalogue" heading, 6 item cards
> rendered. Job B: image–text coherence verified on all 6 cards (described
> each). ⚠️ Content defect — one item is named `Item.renderAll() Lamp`:
> method-call syntax in a customer-facing label, looks like leaked test data;
> flagged for human confirmation. ⚠️ Under-the-surface — 6× 401 to a
> third-party analytics endpoint whose URL contains a literal `YOUR_API_KEY`
> placeholder (counted, logged) — the integration shipped unconfigured.
> Layout: one card's description block measures a line taller than every
> sibling (DOM bounding boxes; numbers in the ledger) — cosmetic. Oracle note:
> the browser `<title>` never updated from the login page's value; only the
> on-page heading changed — expected result was ambiguous about which "title",
> interpretation recorded. Most suspicious thing this case: the placeholder
> API key — if one integration shipped unconfigured, others may have too.
> Likely next bug from this page: the promo banner already crowds the first
> card; error states will collide with it.

Both verdicts say PASS. Only one of them did the job.
