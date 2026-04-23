# Post-creation verification — re-fetch, validate, repair

The POST returned 201. That proves the server accepted your JSON.
It does NOT prove the content renders correctly. This page is the
checklist for turning "accepted" into "good".

Run this every time. No exceptions. Ugly tickets are evidence of
skipped verification.

> **If `.agents/profile.md` isn't populated yet** (project not
> seeded, or seeded without the `Project systems` block), ask the
> operator for the Jira base URL, auth env var, and — for
> Confluence — the space key before running the curl-fallback
> verification steps below. MCP transport sidesteps this since the
> server carries its own config.

## Before you update: raw-fetch first

Verification covers the **after**. This section covers the
**before**: when you're editing (not creating) a Jira issue,
comment, or Confluence page, always fetch the current body in its
**raw structured view** before writing the update.

"Raw" means the body as the API stores it — the ADF JSON for Jira,
the storage-format XHTML string for Confluence. NOT the rendered
HTML (`renderedFields.description` / `body.view.value`) which is
output-only and loses macros, custom nodes, and structural hints.

### Why

- The existing body has structure (sections, macros, panels,
  custom fields) authored by a human or a prior agent pass. An
  update built from scratch usually erases that structure.
- Confluence pages embed macros (`<ac:structured-macro>`) that
  only appear verbatim in the storage view. Regenerating a page
  from the rendered HTML drops them silently.
- Jira ADF documents may contain nodes newer than this skill
  knows about. Reading them raw lets you preserve what you don't
  recognize, instead of discarding it.
- For Confluence specifically, you also need the current
  `version.number` for the update payload — which only comes on
  a raw fetch.

### Fetch endpoints (raw)

The same rule applies on **every transport** — raw REST, MCP
tools, or any Atlassian-connected integration wired into the
project. Pick the variant that returns the raw ADF / storage
string, not a pre-rendered / human-readable summary.

```
# --- Raw REST API ---

# Jira issue description (and other rich-text fields)
GET /rest/api/3/issue/{key}?fields=description,comment
→ fields.description is the ADF document you'll edit

# Jira comment
GET /rest/api/3/issue/{key}/comment/{id}
→ body is the ADF document

# Confluence page
GET /wiki/rest/api/content/{id}?expand=body.storage,version
→ body.storage.value is the XHTML you'll edit;
  version.number is the number you must increment in the PUT
```

```
# --- MCP / Atlassian connectors ---

# Most MCP servers expose both a "rich" read and a "raw" read.
# Pick the raw variant. Examples (exact names vary by server):

#   mcp-atlassian:
#     jira_get_issue         → includes fields.description (ADF)
#     confluence_get_page    → pass include_raw=true / body_format=storage
#                              to get body.storage.value rather than body.view

#   Elitea_Dev / JiraIntegration:
#     JiraIntegration.get_issue_details   → returns ADF under description
#     JiraIntegration.get_comments        → returns ADF bodies
#     ConfluenceIntegration.get_page_raw  → storage-format XHTML

# If a tool only returns rendered HTML / markdown-ified text,
# that's the wrong tool for a pre-update fetch. Find the raw
# equivalent, add one, or fall back to REST with the project's
# configured auth_env.
```

Do NOT pass `expand=renderedFields` / `body.view` for this step —
those are for the post-update verification pass, not for reading
the source of truth before an edit.

### Merge strategy

- **Append** (add a new section, new comment paragraph, new table
  row) → parse the raw body, add your block nodes at the end (or
  at the right anchor), serialize back, PUT.
- **Replace a section** → find the heading node that anchors the
  section, replace the following block nodes up to the next
  heading of equal/greater level, keep the rest.
- **Fix a typo** → find the specific text node, edit the `text`
  value, leave everything else untouched.
- **Full rewrite** (rare, and only when the operator asks) → even
  then, screenshot / archive the raw body first so the old
  structure isn't lost.

If the raw body contains nodes / elements you don't recognize
(new ADF node types, custom macros), **preserve them byte-for-byte
in your output**. Dropping an unknown node silently is the
same class of bug as dropping a known one.

### When skipping is OK

Only when you're writing a **net-new** resource — first-time
issue-create, first comment, brand-new page. There's no existing
body to preserve. This is the only exception.

## Why re-fetch

Three classes of issue only surface on read-back:

1. **Structural errors the server tolerated** — e.g. unsupported
   ADF node silently dropped; storage-format element parsed to
   empty. Server returns 201; content is partially missing.
2. **Semantic errors that serialize fine** — mention `id` that
   doesn't exist in the tenant renders as a grey "unknown user"
   badge; link `href` with a typo becomes a dead link.
3. **Renderer quirks** — paragraph without content renders as a
   weird vertical gap; table without a `<tbody>` renders with
   broken borders in some themes.

The only reliable check is: fetch the resource, look at both the
source you submitted and the rendered output, compare.

## Re-fetch endpoints

### Jira issue

```
GET /rest/api/3/issue/{key}?expand=renderedFields
```

- `fields.description` → the ADF you posted.
- `renderedFields.description` → the HTML Jira renders.

Sanity check: rendered HTML is non-empty and contains the expected
shape (headings, lists, code blocks, mentions as `<a class="user-hover">`).

### Jira comment

```
GET /rest/api/3/issue/{key}/comment/{id}?expand=renderedBody
```

- `body` → the ADF you posted.
- `renderedBody` → the HTML Jira renders.

### Confluence page

```
GET /wiki/rest/api/content/{id}?expand=body.storage,body.view,version
```

- `body.storage.value` → the storage format you submitted.
- `body.view.value` → the rendered HTML users see.
- `version.number` → needed if you're about to submit a PUT repair.

## Validation checklist

For each created resource, confirm ALL of these:

### Mentions
- [ ] Every `@mention` you intended appears as a mention node /
      linked user in the rendered HTML.
- [ ] No literal `@username` strings anywhere you meant to mention.
- [ ] `accountId` resolved to a real display name (not "Unknown
      user" / greyed-out badge).

### Headings
- [ ] Headings render as headings (`<h1>`–`<h6>` in rendered HTML),
      not as bold paragraphs or literal `# heading` text.
- [ ] Heading hierarchy makes sense — no skipping from h1 to h4.

### Lists
- [ ] Bullet lists render as `<ul><li>`, ordered as `<ol><li>`.
- [ ] No literal `- item` / `1. item` hyphen-prefixed text.
- [ ] Nested list items actually nest.

### Code blocks
- [ ] Code blocks render monospaced with (optionally) syntax
      highlighting. No lines of literal backticks.
- [ ] Newlines preserved.
- [ ] No stray HTML entities inside code (`&amp;` where you meant
      `&`).

### Tables
- [ ] Table renders with borders and cells. No pipe-separated
      `col1 | col2 | col3` text.
- [ ] Every cell populated (no "missing content" empty renders
      from a skipped paragraph wrapper).

### Links
- [ ] Links are clickable. No bare URLs in prose.
- [ ] External URLs point where they should (not typo'd).
- [ ] Internal Confluence page links resolve to the intended page
      (check the hover card / href).

### Panels / macros
- [ ] Info / note / warning panels render with the right colour.
- [ ] Code macro language matches the code (no `python` on JSON).

### Typography
- [ ] No literal `**bold**` / `*italic*` / `_italic_` markdown
      artefacts.
- [ ] No half-rendered HTML tags (e.g. `<br>` visible in body).

### Hygiene
- [ ] No API tokens / secrets leaked into body text.
- [ ] No placeholder text left in (`TODO:`, `XXX`, `FIXME` unless
      intentional).
- [ ] Ticket summary / page title isn't empty or placeholder.

## Repair recipes

When the checklist fails, fix it — do not file a "fix formatting
later" ticket. The repair is cheap.

### Jira issue description

```
PUT /rest/api/3/issue/{key}
{
  "fields": {
    "description": { /* corrected ADF doc */ }
  }
}
```

### Jira comment

Jira comments update via:

```
PUT /rest/api/3/issue/{key}/comment/{id}
{
  "body": { /* corrected ADF doc */ }
}
```

If the comment is wrong in a minor way (typo), editing is fine.
If the original is deeply broken and misleading, consider deleting
(`DELETE /.../comment/{id}`) and re-posting, with a short note on
the thread about the repost.

### Confluence page

Page updates require the next version number:

```
PUT /wiki/rest/api/content/{id}
{
  "type": "page",
  "title": "<same or updated>",
  "version": { "number": <current_version_number + 1> },
  "body": {
    "storage": {
      "value": "<corrected storage xhtml>",
      "representation": "storage"
    }
  }
}
```

Read the current `version.number` first, increment by one. A
mismatched version number returns 409 Conflict.

## Visual spot-check — when API-only isn't enough

The rendered HTML from `?expand=renderedFields` / `body.view` is
usually enough. But for pages that rely on spatial layout
(complex tables, side-by-side panels, embedded diagrams), a
visual check catches what HTML comparison misses.

When to open the browser:

- Content with >1 nested macro or custom layout.
- First time filing in a new project / space (template quirks).
- Operator explicitly asked for a "pretty" ticket / page.
- Previous repair attempt was still off.

Skip the visual check for routine comments and simple issue
descriptions — the API validation is sufficient there.

## Logging what you did

For audit / handoff, record (in the agent's reply or memory):

- The created resource URL (`https://site.atlassian.net/browse/{key}`,
  or `https://site.atlassian.net/wiki/spaces/{space}/pages/{id}`)
- Whether verification passed on first post or required repair
- Any accountId lookups that failed (useful for updating the
  project's team roster)

Do not log the full body — that's noise and potentially PII-laden.
The URL is the audit trail.
