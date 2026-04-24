# Mentions — the correct way, on both surfaces

Atlassian Cloud mentions are backed by an **accountId** — an
opaque string per user within a tenant (e.g.
`61e1a042e67ea2006b5b2157`). `@username` / `@email` strings are
**not mentions** when posted through the API — they render as
literal text, no notification, no profile card, no link.

The same `accountId` works across Jira and Confluence in the same
tenant.

## 1. Look up the accountId

### From an email

```
GET /rest/api/3/user/search?query=alexander@example.com
→ [ { "accountId": "61e1a042e67ea2006b5b2157",
      "displayName": "Alexander Bychinskiy",
      "emailAddress": "alexander@example.com", ... } ]
```

### From a display name (fuzzier — may return multiples)

```
GET /rest/api/3/user/search?query=Alexander Bychinskiy
```

Verify: the `displayName` you get back matches what you searched
for. If multiple users match, don't guess — ask the operator or
fall back to plain text.

### From the current authenticated user (myself)

```
GET /rest/api/3/myself
→ { "accountId": "...", "displayName": "...", ... }
```

### Caching

Cache accountIds per session, keyed by email or normalized
display-name. Resolving the same user twice in one run is wasted
calls; resolving them five times is a bug.

Caching across sessions belongs in `.agents/memory/` or the
project's profile, not in this skill.

## 2. Use it in a Jira mention (ADF)

Inside any inline-node context (paragraph, table cell, list item):

```json
{ "type": "mention",
  "attrs": { "id": "61e1a042e67ea2006b5b2157",
             "text": "@Alexander Bychinskiy" } }
```

- `id` → the accountId.
- `text` → the **display fallback**, shown only when the mention
  fails to render. Match the user's display name verbatim with a
  leading `@` (e.g. `"@Alexander Bychinskiy"`); modern Atlassian
  UIs render spaces fine.

Full paragraph example:

```json
{ "type": "paragraph",
  "content": [
    { "type": "text", "text": "Hi " },
    { "type": "mention",
      "attrs": { "id": "61e1a042e67ea2006b5b2157",
                 "text": "@Alexander Bychinskiy" } },
    { "type": "text", "text": ", can you review this?" }
  ] }
```

## 3. Use it in a Confluence mention (storage format)

Inside any body content (paragraph, table cell, list item):

```html
<ac:link>
  <ri:user ri:account-id="61e1a042e67ea2006b5b2157" />
</ac:link>
```

Full paragraph example:

```html
<p>
  Hi
  <ac:link>
    <ri:user ri:account-id="61e1a042e67ea2006b5b2157" />
  </ac:link>,
  please review.
</p>
```

Confluence's renderer substitutes the user's current display name
inside the anchor — you don't provide a fallback text node.

## 4. Mentioning multiple users

Fine — concatenate inline nodes separated by text:

```json
{ "type": "paragraph",
  "content": [
    { "type": "text", "text": "FYI " },
    { "type": "mention",
      "attrs": { "id": "ACCOUNTID-A", "text": "@Anna" } },
    { "type": "text", "text": " and " },
    { "type": "mention",
      "attrs": { "id": "ACCOUNTID-B", "text": "@Bob" } },
    { "type": "text", "text": ": please review." }
  ] }
```

Confluence:

```html
<p>
  FYI
  <ac:link><ri:user ri:account-id="ACCOUNTID-A" /></ac:link>
  and
  <ac:link><ri:user ri:account-id="ACCOUNTID-B" /></ac:link>:
  please review.
</p>
```

## 5. Failure modes

- **User search returns empty** → the user doesn't exist in this
  tenant (may have left the company, may be a different tenant, or
  the search term is too broad/narrow). Do not invent a mention;
  fall back to plain text (`"Hi Alexander, "`).
- **Multiple matches** → if you can't narrow down via email, ask
  the operator which accountId to use.
- **Deactivated user** → mention still posts, but shows as greyed
  out. Decide whether that's useful (historical record) or
  misleading (expecting a response) — often better to use plain
  text with the name.
- **Group mentions** → Jira supports `groupId`-based mention-like
  behavior via **team mentions** (not covered here). Confluence
  does not have built-in group mention in storage format. For
  "the platform team", mention the team lead individually or add
  a `@label` convention agreed with the team.

## 6. Privacy note

`accountId` is safe to log / persist internally — it's not PII by
itself. Email addresses ARE PII — if you cache an email → accountId
lookup, respect the project's data-handling policy.
