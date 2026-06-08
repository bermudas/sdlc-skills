# Testing — TodoMVC fixture

- **Framework:** Playwright.
- **Install:** `npm install`.
- **Run tests:** `npx playwright test`.
- **Page objects:** none yet (greenfield); add under `tests/` with `data-testid` locators.
- **Locators:** elements expose `data-testid` (`new-todo`, `todo-list`, `todo-item`, `toggle`). Prefer `getByTestId` over CSS/XPath.
- **No sleeps:** use auto-waiting locators; no `waitForTimeout`.
