---
name: atlassian-content
description: Create well-formatted Jira issues/comments (ADF, API v3) and Confluence pages (storage format) with accountId-backed mentions and mandatory post-creation re-fetch + repair. Load for "file a bug", "review comment on JIRA-123", "write up a decision page", or any authored Atlassian content.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.1.0"
---

# Atlassian content — Jira + Confluence, done right

Atlassian's two content surfaces have **two completely different
formats**, and markdown is not either of them. Content submitted in
the wrong format renders as a wall of asterisks, broken tables,
orphan `@username` strings, and code blocks that display as plain
paragraphs. This skill is the rulebook for getting it right the
first time and verifying it after.

**Core principle:** *Format-match the surface, resolve identities
before you post, and always re-fetch what you wrote.*

## When to load this skill

Load when the task involves authoring content inside Atlassian
products:

- Filing a Jira issue (story, bug, task, subtask)
- Leaving a Jira comment (review findings, clarifications, updates)
- Updating a Jira field that accepts rich text (description, custom
  text fields)
- Creating or editing a Confluence page (decisions, runbooks,
  writeups, reviews)
- Mentioning a human in either surface

Do NOT load for: read-only Jira/Confluence operations (search,
field reads, user lookups) — those don't need formatting rules.

## Absolute boundaries

- **Never post markdown into Jira or Confluence.** Jira Cloud API v3
  expects **ADF** (Atlassian Document Format — a structured JSON
  document). Confluence REST expects **storage format** (XHTML-ish
  markup with `<ac:*>` / `<ri:*>` macros). Neither surface
  interprets markdown natively via the API.
- **Never mention by `@username`.** Both surfaces mention by
  **`accountId`** (Cloud). A free-text `@Alexander` string posts as
  a literal `@Alexander` — no notification, no link, no profile
  card.
- **Never declare a post "done" without re-fetching it.** The only
  ground truth is what the server returns after creation. Run the
  verification pass (see `references/verification.md`) on every
  issue, comment, or page you create.
- **Never update without first fetching the raw current body.**
  For any edit / append on an existing issue description, comment,
  or Confluence page, fetch the current content in its **raw
  structured view** first (ADF doc for Jira, storage format string
  for Confluence) — not the rendered HTML. Reading the raw body is
  how you see the existing macros, custom nodes, versioned
  structure, and formatting conventions the page already uses.
  Edit *into* that structure; don't overwrite it with a fresh body
  that discards the author's layout. **Applies regardless of
  transport** — raw Jira / Confluence REST API, MCP tools
  (`Elitea_Dev`, `JiraIntegration`, `mcp-atlassian`), or any
  Atlassian-connected integration the project ships. Pick the read
  tool that returns the raw ADF / storage string, not a
  pre-rendered / human-readable summary. See
  `references/verification.md` § "Before you update: raw-fetch
  first".
- **Never paste API tokens into the content.** If a snippet
  illustrates an API call, redact credentials. This skill writes
  user-facing content; credentials belong in `.env` / auth_env, not
  in descriptions.

## Transport — MCP preferred, curl fallback, browser last resort

Priority: **MCP** (Atlassian MCP server like `Elitea_Dev`,
`JiraIntegration`, `mcp-atlassian` — secrets stay out of agent
context) → **curl / HTTP** (using `JIRA_BASE_URL` + auth env from
`.agents/profile.md` § Project systems; if that file isn't present
yet — project not seeded — ask the operator for the base URL and
auth env var before falling back to HTTP) → **browser** (last
resort; note explicitly that verification was visual-only).
Transport does **not** change the body format — ADF over MCP is the
same ADF as ADF over curl.

## The authoring loop (every post, every time)

```
0. If updating an existing resource:
   Raw-fetch first  → GET the current body in its structured form
                      (ADF for Jira, storage format for Confluence),
                      read it, and merge your change into it —
                      don't regenerate from scratch.
1. Detect surface      → Jira issue, Jira comment, or Confluence page?
2. Resolve identities  → mentions by accountId; project/space keys; issue keys
3. Assemble body       → ADF (Jira) or storage format (Confluence)
4. Submit              → MCP tool or REST endpoint
5. Re-fetch            → GET the resource back, don't trust the POST response alone
6. Validate            → run the checklist in references/verification.md
7. Repair              → if ugly, PUT/PATCH a fix; don't leave garbage
```

Each phase is cheap. Skipping any of them is how ugly tickets get
filed.

### 1. Detect surface

Three surfaces, three format rules:

| Surface | Format | Endpoint (Cloud) |
|---|---|---|
| Jira issue create / update | **ADF** under `fields.description` (+ other rich-text custom fields) | `POST /rest/api/3/issue`, `PUT /rest/api/3/issue/{key}` |
| Jira comment | **ADF** under `body` | `POST /rest/api/3/issue/{key}/comment` |
| Confluence page create / update | **storage format** (string) under `body.storage.value`, `representation: "storage"` | `POST /wiki/rest/api/content`, `PUT /wiki/rest/api/content/{id}` |

If you're unsure which surface you're targeting: a Jira issue key
(`PROJ-123`) → Jira. A Confluence space key + page title → Confluence.

### 2. Resolve identities

Before assembling the body, collect every identity you'll reference:

- **Users** → `accountId`. Look up via `GET /rest/api/3/user/search?query=<email-or-name>`
  (Jira) or `GET /wiki/rest/api/user?username=...` (Confluence) if
  you only know a name/email. **Cache per session** — the same
  person has the same `accountId` across both surfaces in a given
  Atlassian tenant.
- **Jira project key** → usually known from the task
  (`.agents/profile.md` § Project systems). If not, `GET /rest/api/3/project`.
- **Confluence space key** → likewise from profile; otherwise
  `GET /wiki/rest/api/space`.
- **Linked issues** → the issue keys themselves; ADF `inlineCard`
  or `mention`-style cards render them.

If you cannot resolve a user, **do not invent a mention**. Fall
back to plain text (`"Hi Alexander, "`) or ask the operator.

### 3. Assemble body

- **Jira** → build an ADF document. See `references/jira-adf.md`
  for the complete node/mark reference and working examples.
- **Confluence** → build a storage-format XHTML string. See
  `references/confluence-storage.md`.
- **Mentions** (both surfaces) → see `references/mentions.md`.

### 4. Submit

MCP call, or `POST` / `PUT` via HTTP. No format-layer logic here —
the body you assembled in step 3 is the body you send.

### 5. Re-fetch

Read back what you just wrote:

- `GET /rest/api/3/issue/{key}?expand=renderedFields` — compare
  ADF in `fields.description` and the rendered HTML in
  `renderedFields.description`. If the rendered HTML is empty,
  malformed, or missing expected elements, your ADF is wrong.
- `GET /rest/api/3/issue/{key}/comment/{id}?expand=renderedBody`
- `GET /wiki/rest/api/content/{id}?expand=body.storage,body.view` —
  compare `body.storage` (what you submitted) with `body.view` (how
  Confluence renders it).

### 6. Validate

Run the post-creation checklist in `references/verification.md`.
Non-negotiable items:

- Every `@mention` became an actual mention node (not a plain text
  `@name`)
- Code blocks render as monospace code (not inline backticks in
  prose)
- Tables render as tables (not pipe-separated text)
- Headings render as headings (not bold paragraphs)
- Links are clickable (not bare URLs in text)
- No literal `**bold**` / `# heading` markdown artefacts

### 7. Repair

If verification fails, build a corrected body and `PUT` it back.
Don't file a follow-up ticket "to fix formatting later". The
content you just filed is evidence of your care; leaving it broken
is a broken window.

## Quick decision tree

```
Task: "file a bug for case X"
  └─ surface = Jira issue
     └─ format = ADF under fields.description
        └─ mentions of reporter / assignee → accountId nodes
           └─ submit → re-fetch → validate → (repair if needed)

Task: "add a review comment on JIRA-123"
  └─ surface = Jira comment
     └─ format = ADF under body
        └─ submit → re-fetch renderedBody → validate

Task: "document the migration plan on the Engineering space"
  └─ surface = Confluence page
     └─ format = storage format under body.storage.value
        └─ submit → re-fetch body.view → validate
```

## Anti-patterns (things that look fine but aren't)

- **"The markdown renders in the preview"** — Atlassian's *web UI*
  accepts markdown-like shortcuts and transforms them during
  editing. The API does not. What you POST is what persists.
- **"I'll just paste the description as plain text"** — plain text
  through the API is valid ADF-wrapped plain text, but loses
  headings, code blocks, lists, and mentions. Acceptable only for
  one-line comments.
- **"The POST returned 201, so it worked"** — 201 means the server
  accepted the JSON structure. It does NOT mean the content
  renders. Always re-fetch.
- **"I mentioned the user with `@firstname`"** — Atlassian Cloud
  does not accept username mentions via API. Only accountId-backed
  mention nodes. Username strings are literal text.
- **"I copy-pasted the ADF from the web UI's source"** — the web
  UI sometimes emits extra fields (`marks: []` vs no `marks`,
  `version: 1` on nested docs). Use the minimal, documented form
  in `references/jira-adf.md`.
- **"I used `<br>` for a line break"** — Confluence storage
  format tolerates `<br/>` but prefers paragraph boundaries for
  prose. ADF has no `<br>` — use paragraph splits or `hardBreak`
  nodes.

## Escalation — when to ask the operator

- The project's `.agents/profile.md` § Project systems doesn't
  specify an issue tracker or the tracker is on-prem Jira Server
  (which uses wiki markup, not ADF — different API version).
- Credentials aren't configured and MCP isn't online.
- A mention target can't be resolved to an accountId (user left
  the company, ambiguous name).
- The space / project requires fields you don't have values for
  (custom required fields on a specific issue type).

## References

- `references/jira-adf.md` — ADF node/mark catalogue, the JIRA
  SYNTAX REFERENCE, working examples (story with headings, lists,
  tables, panels, code blocks, mentions)
- `references/confluence-storage.md` — storage format primer,
  common macros (`<ac:structured-macro>`), page creation examples
- `references/mentions.md` — accountId lookup + mention nodes for
  both surfaces
- `references/verification.md` — post-creation checklist and
  repair recipes

External:

- https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
- https://developer.atlassian.com/cloud/confluence/rest/v1/intro/
- https://github.com/sooperset/mcp-atlassian/tree/main/docs/guides
  (working MCP-server example with ADF + storage-format recipes)
