// eval/spine/passk.test.mjs — stdlib-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pass1, passAtK, passHatK, summarize } from "./passk.mjs";

test("pass1 = success rate", () => {
  assert.equal(pass1([true, true, true, true, false]), 0.8);
  assert.equal(pass1([]), null);
});

test("pass^k = all-of-k reliability (the headline metric)", () => {
  // 4 of 5 pass: pass^3 = C(4,3)/C(5,3) = 4/10 = 0.4  (vs pass1 0.8)
  assert.equal(passHatK([true, true, true, true, false], 3), 0.4);
  // perfect run is perfectly reliable
  assert.equal(passHatK([true, true, true], 3), 1);
  // one failure → never reliably passes 3-in-3 out of 3
  assert.equal(passHatK([true, true, false], 3), 0);
});

test("pass@k = at-least-one-of-k", () => {
  // 4 of 5: pass@3 = 1 - C(1,3)/C(5,3) = 1 - 0 = 1
  assert.equal(passAtK([true, true, true, true, false], 3), 1);
  // 1 of 5: pass@3 = 1 - C(4,3)/C(5,3) = 1 - 4/10 = 0.6
  assert.equal(passAtK([true, false, false, false, false], 3), 0.6);
});

test("summarize reports pass1, pass@k, pass^k", () => {
  const s = summarize([true, true, true, true, false], 3);
  assert.equal(s.n, 5);
  assert.equal(s.c, 4);
  assert.equal(s.pass1, 0.8);
  assert.equal(s["pass^3"], 0.4);
});
