# Playwright Patterns

POM, fixture strategy, and framework-specific selectors for Playwright
projects. Read when the project's framework is Playwright and its own
conventions (`.agents/testing.md` + three neighbouring tests — always the
first authority) leave a pattern question open. Every example here obeys the
engineer's Hard Rules: semantic handles first, no hardcoded values, no
sleeps or load-state waits where an auto-waiting assertion does the job,
read-only data by default. Framework-specific pattern material belongs in
skills like this one, never in the agent body; other frameworks get their own
as the factory or the project adds them.

## Contents

- [Page Object Model](#page-object-model)
- [Fixture Strategy](#fixture-strategy)
- [Framework-Specific Selectors](#framework-specific-selectors)
- [Hybrid API + UI Testing](#hybrid-api-ui-testing)
- [Screenshot Convention](#screenshot-convention)
- [Common Gotchas](#common-gotchas)

## Page Object Model

Encapsulate page interactions in reusable classes; handles live here and
nowhere else (Hard Rule 3), resolved by role and label before anything else
(Hard Rule 6):

```python
from playwright.sync_api import Page, expect

class LoginPage:
    def __init__(self, page: Page):
        self.page = page
        self.email = page.get_by_label("Email")
        self.password = page.get_by_label("Password")
        self.submit = page.get_by_role("button", name="Sign in")

    def navigate(self, base_url: str):
        self.page.goto(f"{base_url}/login")
        expect(self.submit).to_be_visible()          # auto-waits; no networkidle

    def login(self, email: str, password: str):
        self.email.fill(email)
        self.password.fill(password)
        self.submit.click()
        expect(self.page).to_have_url("**/dashboard")
```

## Fixture Strategy

Credentials and URLs come from the project's existing env loader (Hard Rule
4) — never literals in a fixture.

### Session-Level (shared across all tests)
```python
import os
import pytest

@pytest.fixture(scope="session")
def browser():
    from playwright.sync_api import sync_playwright
    pw = sync_playwright().start()
    browser = pw.chromium.launch()
    yield browser
    browser.close()
    pw.stop()

@pytest.fixture(scope="session")
def auth_state(browser):
    context = browser.new_context()
    page = context.new_page()
    login = LoginPage(page)
    login.navigate(os.environ["BASE_URL"])
    login.login(os.environ["TEST_USER"], os.environ["TEST_PASSWORD"])
    state = context.storage_state()
    context.close()
    return state
```

### Per-Test (fresh isolation)
```python
@pytest.fixture
def context(browser, auth_state):
    ctx = browser.new_context(
        viewport={"width": 1920, "height": 1080},
        storage_state=auth_state,
    )
    yield ctx
    ctx.close()

@pytest.fixture
def page(context):
    page = context.new_page()
    yield page
    page.close()
```

## Framework-Specific Selectors

Component libraries often defeat `get_by_role` / `get_by_label`. The
patterns below are the **last tier of the handle ladder** — reach for them
only after the semantic tiers fail, put them in the page object, and leave a
one-line comment saying why (Hard Rule 6).

### MUI (Material-UI)
```python
# Prefer: page.get_by_label("Priority")  — MUI Select often lacks label-for, hence:
page.locator("div:has(label:has-text('Priority')) >> .MuiSelect-root")
page.get_by_role("option", name="High").click()

page.locator(".MuiChip-root:has-text('draft')")          # chips carry no role
page.get_by_role("dialog")
page.get_by_role("combobox", name="Search").fill("search")  # Autocomplete input
page.get_by_role("option", name="result").click()
```

### shadcn/ui
```python
page.locator("[cmdk-input]").fill("search")               # Command/Combobox — no accessible name
page.locator("[cmdk-item]:has-text('result')").click()
page.get_by_role("dialog")
page.get_by_role("combobox").click()                       # Select trigger
page.get_by_role("option", name="value").click()
page.locator("[data-sonner-toast]")                        # toast region has no role
```

### Ant Design
```python
page.locator(".ant-select-selector").click()               # Select — no role on the trigger
page.get_by_role("option", name="value").click()
page.get_by_role("dialog")                                 # Modal
page.get_by_role("row").nth(0)                             # table row
```

## Hybrid API + UI Testing

Read-only by default (Hard Rule 10): assert on stable existing data when the
observable allows it. When it genuinely needs fresh state, seed minimally via
the API and clean up loudly:

```python
def test_created_item_visible_in_ui(api_client, page, base_url):
    item = api_client.post("/api/items", json={"name": "Test"}).json()   # fresh state required
    try:
        page.goto(f"{base_url}/items/{item['id']}")
        expect(page.get_by_role("heading", level=1)).to_have_text("Test")   # auto-waits
    finally:
        api_client.delete(f"/api/items/{item['id']}")                    # cleanup, always
```

## Screenshot Convention

Screenshots go to disk and are cited by path — never read back into context
by default (host rule 3). Name them `{context}-{state}`:

```python
page.screenshot(path="reports/screenshots/login-error-invalid-password.png")
page.screenshot(path="reports/screenshots/dashboard-loaded.png", full_page=True)
```

## Common Gotchas

| Problem | Cause | Fix |
|---------|-------|-----|
| Element not found | Asserting before the app rendered | Assert on the element with `expect(locator).to_be_visible()` — it auto-waits; never `wait_for_timeout` |
| Click does nothing | Wrong element, or an overlay on top | Re-resolve by role/name; close the overlay first |
| Flaky test | Race between navigation and assertion | Assert the observable outcome (`to_have_url`, `to_have_text`) instead of adding a sleep; if a real animation window exists, comment why the wait is there |
| Auth expires | Session-level fixture stale | Refresh `auth_state` |
| Dialog blocks interaction | Modal overlay | Close the dialog first or interact within `get_by_role("dialog")` |
| Dropdown not visible | Needs scrolling | `locator.scroll_into_view_if_needed()` |
