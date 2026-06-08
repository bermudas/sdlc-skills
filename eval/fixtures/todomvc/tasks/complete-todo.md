# TC-001 — Complete a todo

**Preconditions:** the app is open at `index.html`.

**Steps:**
1. Type "buy milk" in the new-todo input and press Enter.
2. Tick the new todo's checkbox.

**Expected:** the todo is marked completed (the list item gains the `completed`
class / shows as done).

> This case targets the behavior broken in `v-bug-001`. A correct automated test
> must PASS on `v-clean` and FAIL on `v-bug-001` (the SWT-bench dual-run contract).
