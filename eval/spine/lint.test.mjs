// eval/spine/lint.test.mjs — stdlib-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lintTestCode } from "./lint.mjs";

const GOOD = `
import { test, expect } from "@playwright/test";
test("complete a todo", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-todo").fill("buy milk");
  await page.getByTestId("new-todo").press("Enter");
  await page.getByTestId("toggle").check();
  await expect(page.getByTestId("todo-item")).toHaveClass(/completed/);
});`;

test("a clean test lints clean", () => {
  const r = lintTestCode(GOOD);
  assert.equal(r.maskingHits, 0);
  assert.equal(r.sleepHits, 0);
  assert.equal(r.clean, true);
});

test("masking patterns are caught", () => {
  assert.equal(lintTestCode(GOOD + "\ntest.fail();").maskingHits, 1);
  assert.ok(lintTestCode('it.skip("x", () => {})').maskingHits >= 1);
  assert.equal(lintTestCode("expect(true).toBe(true)").clean, false);
});

test("sleeps are caught", () => {
  const r = lintTestCode(GOOD.replace("await page.goto", "await page.waitForTimeout(1000);\n  await page.goto"));
  assert.equal(r.sleepHits, 1);
  assert.equal(r.clean, false);
});

test("brittle locators are advisory, not a hard fail", () => {
  const r = lintTestCode(GOOD + '\nawait page.locator("li:nth-child(2)").click();');
  assert.equal(r.brittleLocatorHits, 1);
  assert.equal(r.clean, true); // still "clean" — brittle is informational
});
