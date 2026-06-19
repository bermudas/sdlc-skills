# Visual Inspection — the six passes

Reference for the `ui-bug-hunting` skill. Read once per run, apply to **every
screenshot** taken during any web UI test, on any application. This is the
pixel layer of the hunt — SKILL.md governs the method around it.

---

## The core rule

Never trust a tool's return value as evidence.
After every screenshot: **read the saved image file** and base every assertion
on what you can actually see in it. A screenshot you have not read is not evidence
— it is a file path.

---

## After every screenshot, run these six passes in order.

---

### Pass 1 — Did the page render?

Look at the screenshot as a whole before checking anything specific.

- Is the page styled? If you see unstyled black-on-white text with no layout, CSS
  failed to load. Flag it immediately — nothing else on the page can be trusted.
- Is there any debug content visible to a real user? Anything that reads
  `undefined`, `null`, `[object Object]`, a raw JSON blob, a stack trace, or a
  `TODO` label is a defect — flag it regardless of whether it relates to the
  current test step.
- Does any visible user-facing text look like it belongs to a development or
  test environment rather than a real product? This is a separate question from
  whether the text rendered correctly. Look for:
  — strings containing programming syntax in a context where a user would never
    expect it: method-call notation (`renderAll()`, `doSomething()`),
    dot-notation chains (`item.allProperties`), array literals, camelCase or
    snake_case identifiers used as product names, labels, or headings
  — obvious placeholder or filler text: "Lorem ipsum", "Test Product", "Sample
    Item", "Foo", "Bar", "Baz", "Item 1 / Item 2 / Item 3", "User Name"
  — data values that look seeded rather than real: prices of exactly $0.00 or
    $1.00, dates of 1970-01-01 or 2000-01-01, email addresses like
    `test@test.com` or `user1@example.com`, sequential IDs used as display names
  — names or titles that follow an internal naming convention rather than a
    human-readable label (e.g. `TC_LOGIN_001`, `QA_DATA_USER`, `MOCK_RESPONSE`)
  Grade these **⚠️ WARN** — they may be intentional in a demo or staging
  environment, but they must be surfaced for a human to confirm. Do not silently
  pass content that a real user would find confusing or that looks like it leaked
  from a test harness.
- Is there an error state on the page that this step did not cause? A red banner,
  a warning badge, a session-expired modal, a 404 message — if it is present and
  the step did not trigger it, flag it.
- Is there a blank or frozen region where content should be? A white rectangle,
  a grey skeleton that never resolved, a spinner still running — flag it.
- Is anything from a previous screen still visible? A ghost of a previous modal,
  a sidebar that should have closed, text from a prior page bleeding through —
  flag it.

If any of the above fire, state them before continuing. They do not block the
remaining passes — keep going — but they must be on record.

---

### Pass 2 — Is the layout intact?

Check the spatial structure of the page.

- **Overflow and clipping.** Can you see the full content of every element that
  is supposed to be visible? Look for text cut off at the right or bottom edge of
  its container, buttons half-hidden by a sibling, icons cropped by a border.
- **Unintended overlap.** Is any element sitting on top of another element it
  should not be covering? A banner over a button, a dropdown over a form field,
  an icon obscuring text inside a field, a toast blocking a call-to-action.
- **Separation.** Do adjacent elements that are meant to be distinct have visible
  whitespace between them? Form fields that have merged, list items that have run
  together, a label fused to its input — all flag-worthy.
- **Layout shift.** Compare this screenshot to the one from the previous step.
  Did any element move unexpectedly? A button that jumped, a heading that
  reflowed, a field that shifted sideways.
- **Horizontal scroll.** Is a horizontal scrollbar present, or does any content
  extend beyond the right edge of the viewport? That means something broke the
  responsive layout.
- **Alignment.** Do elements that belong to the same group share a consistent
  axis? One card wider than its siblings, a button off-centre in its container,
  a label misaligned from its field — note it.
- **Z-order.** Is the element that should be visually on top actually on top?
  A modal whose background content shows through, a sidebar rendering over the
  main content, a dropdown opening *behind* the element below it — all defects.
- **Uniformity by measurement, not by eye.** When the page shows a repeated
  component pattern — cards in a grid, rows in a list, tiles, menu items — do
  NOT rely on eyeballing the screenshot to confirm they are geometrically
  consistent. Deviations of a line-wrap or ~20px are routinely invisible in a
  downscaled screenshot; your eye will confirm uniformity that does not exist.
  Measure instead: query the live DOM for the bounding boxes of the repeated
  elements and their key children (image, title, description, price/action
  row) and compare heights, widths, and vertical offsets across all siblings.
  Any sibling deviating by more than ~8px or half a line of text → ⚠️ with the
  actual numbers in the report. The screenshot proves what the page looks
  like; the measurements prove what it is.

---

### Pass 3 — Is the content correct?

Check that text and images say what they should.

- **Text completeness.** Is every visible string fully rendered? Look for
  truncation with `…` where the full string is needed, or text broken mid-word
  at a container edge. If you see it, quote what is visible and note what is cut.
- **Right value in the right field.** Filled inputs should show the entered
  value, not a placeholder. Empty inputs should show placeholder text, not a
  stale previous value. If both are visible simultaneously, flag it.
- **No stale content.** Is any text or element from a prior interaction still
  showing underneath or alongside the current state?
- **Images load.** Are all images rendered as real visual content? A
  broken-image icon, a grey placeholder box, or alt-text where a photo should
  be is a load failure. Flag it.
- **Image–text semantic coherence.** For every image paired with a text label
  — a product card, a profile tile, a content card, a carousel slide, an avatar,
  a button with an icon — do this:
  1. **Describe what the image actually shows** in one sentence, from your own
     visual inspection of the pixel content. Do not read the alt text. Do not
     infer from the label. Look at the image and say what is in it.
  2. **Read the paired text** — the product name, the card title, the button
     label, the user name.
  3. **Assert coherence.** Does the subject you described in step 1 match what
     the text in step 2 says? A backpack photo next to a label naming a
     backpack is coherent. A t-shirt photo next to a label naming a backpack
     is not. A generic office lifestyle photo next to "Enterprise Plan" is
     ambiguous.
  
  Grade: **FAIL** if the image clearly depicts a different product, person, or
  object than the text names. **WARN** if the image is an abstract or lifestyle
  representation where the connection to the label is plausible but not literal.
  **PASS** only after completing all three steps above.

  This check cannot be done by reading DOM attributes — it requires looking at
  the image. Do not skip it on any page that has content cards, product grids,
  profile tiles, avatars, or icon-labelled buttons.
- **Text contrast.** Can you read all visible text against its background? Look
  specifically at white-on-light, dark-on-dark, and any coloured-background
  sections.
- **Character encoding.** Do all characters render as intended? Look for
  replacement boxes `□`, question-mark glyphs `?`, or escaped HTML entities
  like `&amp;` or `â€™` appearing as literal text.

---

### Pass 4 — Are interactive elements in the right state?

Check that controls reflect the current moment in the interaction.

- **Focus indicator.** The element the user just interacted with should show a
  visible active state — an underline, a border change, a highlight. If it looks
  identical to an un-focused element, the interaction may not have registered.
- **Error state completeness.** If the current step triggered a validation
  failure: every expected error indicator should be present — border colour,
  icon, message text. And they should only appear on the fields that actually
  errored, not on untouched siblings.
- **No cross-contamination.** Fields or components that were not part of the
  current action should look exactly as they did before the action.
- **Transient states resolved.** If the step triggered a loading state, a
  spinner, or an animation — the screenshot should show the settled result, not
  the in-progress state. If you see an unresolved spinner, the screenshot was
  taken too early; note it and consider retaking.
- **One instance.** Banners, modals, tooltips, and toasts that are expected to
  appear exactly once — count them. Two stacked error banners, a modal on top of
  itself, a tooltip shown twice — all defects.
- **No contradictory states.** A success confirmation and an error message should
  not be visible at the same time. If they are, one of them is wrong.
- **Affordance.** Is every actionable element visually identifiable as
  interactive — readable label, distinct colour or border, not blending into
  the page background? A submit button the same colour as the page, or link
  text indistinguishable from body copy, is a defect even though it "works."

---

### Pass 5 — Passive health (always — independent of the current test step)

This pass is not about whether the step passed or failed. It runs regardless.
It catches things that are wrong with the page but not part of what you are
currently testing.

Scan the full screenshot and ask:

- Is there anything visible on this page that a real user would find confusing,
  broken, or alarming — even if it has nothing to do with the action this step
  performed?
- Is the scroll position where you expect it to be? Did the page auto-scroll to
  an error anchor, a focused field, or the bottom of the page in a way that was
  not intended?
- Is any browser chrome — a notification bar, a permission prompt, a download
  bar, an autofill dropdown — overlaying application content?
- Does the overall layout feel complete? Is there a section of the page that
  looks structurally absent, as if a component never mounted?

Flag anything that fires. Do not dismiss a passive finding because it is "not
part of this test case" — that is exactly the point.

---

### Pass 6 — Is this screenshot valid evidence?

Before filing the screenshot as evidence for this step:

- Was the screenshot taken after the page finished rendering? If there is a
  spinner still running, an animation mid-frame, or a skeleton loader not yet
  resolved, the screenshot does not reflect the settled state. Retake it.
- Is the element you are asserting visible in the frame? If the relevant content
  is scrolled out of view or hidden behind a modal, this screenshot cannot prove
  anything about that element.
- Can you read all text that is critical to the assertion? If the text is too
  small or low-contrast to read in the saved file, the screenshot is not
  usable as evidence. Crop to the relevant area or increase the viewport.
- Does the screenshot reflect *this step's* action, not a prior or future state?
- Does the saved file actually exist at the path the test case or session plan
  specified, with the specified name? Confirm with a filesystem check — the
  screenshot tool's acknowledgement is not proof the file landed. A verdict
  whose evidence path points at nothing is a verdict with no evidence.
- Is the page denser than one screenshot can carry? A full-page capture of a
  long or dense page (grids, tables, many cards) is read at reduced scale —
  small defects vanish into the downscaling. When the content is taller than
  the viewport or visually dense, take sectioned screenshots (header / content
  regions / footer) so every element you must judge retains enough pixels to
  be judged. One unreadable full-page shot is not a substitute for three
  readable ones.

If any of these fail, retake before continuing.

---

## How to grade and report

Use three grades — apply them consistently:

| Grade | Meaning |
|-------|---------|
| ✅ | Checked and clean — state what you saw |
| ⚠️ WARN | Anomaly present; does not block the functional result; describe it exactly |
| ❌ FAIL | Defect that invalidates or directly contradicts the step's assertion |

**An ❌ on any check escalates the step to FAIL**, regardless of what the
functional assertion returned.

**A ⚠️ does not change the step verdict** but must appear in your output — it is
a finding for the person reading the results to judge. One exception: when the
anomaly obscures the very evidence needed to verify the step's assertion (a
banner fully covering the asserted element, the asserted text unreadable), it
is not a ⚠️ — it is an ❌, because the step can no longer be proven.

**Always state what you saw**, not just the grade. "✅" alone is not a report.
"✅ — login form with empty Username and Password fields, green Login button,
no error state, no overlays" is a report.

Report each pass in sequence. If a pass is entirely clean, one line is enough:
`Pass 2 — Layout: clean`. If a pass has findings, list each one on its own line
with grade and description.

---

## What ❌ looks like vs ⚠️ — concrete examples

| Observation | Grade | Why |
|-------------|-------|-----|
| Image shows a t-shirt; card title names a backpack | ❌ | Semantic coherence failure — wrong image |
| Image shows a generic lifestyle office photo; heading says "Enterprise Plan" | ⚠️ | Ambiguous — plausible abstract match |
| Error banner fully covers the Login button; button label unreadable | ❌ | Asserted element obscured |
| Error banner clips ~8px of the Login button top; label still readable | ⚠️ | Cosmetic overlap, no functional impact |
| `undefined` rendered as a visible field label | ❌ | Debug artifact in production UI |
| Footer text 2px misaligned from the column grid | ⚠️ | Minor cosmetic; note and move on |
| Screenshot taken while spinner is still running | ❌ | Invalid evidence — retake |
| Products page loaded but last row scrolled out of frame | ⚠️ | Scroll position; note, scroll and retake if the row is asserted |
| Session-expired modal visible at the start of a fresh step | ❌ | Passive scan caught an unexpected error state |
| Cart badge shows "1" on a page entered with an empty cart | ❌ | Passive scan caught a stale state contamination |
| Product name contains method-call syntax, e.g. `Item.renderAll() Lamp` | ⚠️ | Pass 1 — programming syntax in a user-facing label; looks like leaked test/dev data; flag for human confirmation even if image matches and text renders correctly |
| Product name reads "Lorem ipsum dolor sit amet" | ⚠️ | Pass 1 — placeholder filler text in a production-facing label |
| Price shows "$0.00" on a purchasable item | ⚠️ | Pass 1 — value looks seeded; flag for human confirmation |
| Products named "Item 1", "Item 2", "Item 3" in sequence | ⚠️ | Pass 1 — sequential test-data naming pattern visible to end users |
| One card in a 6-card grid measures 20px taller in its description block than every sibling (DOM bounding boxes) | ⚠️ | Pass 2 — uniformity by measurement; invisible in the downscaled screenshot, real in the DOM; report the numbers |
