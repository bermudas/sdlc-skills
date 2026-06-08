# Project briefing — test-automation-engineer (TodoMVC fixture)

- Framework: **Playwright**; run with `npx playwright test`.
- Locators: use `data-testid` (`new-todo`, `todo-item`, `toggle`). No CSS/XPath, no sleeps.
- Greenfield: create the first spec + page object under `tests/`.
- Never mask product defects — a real bug means a natural fail + a filed ticket.
