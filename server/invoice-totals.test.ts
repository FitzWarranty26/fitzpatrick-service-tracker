// Golden-value tests for server-side invoice totals (client C1 / S9).
//
// These lock the server math to the client's to the cent. If the client's
// calcAmount / subtotal reduction ever changes, these must change in lockstep.
// The odd-looking rounding cases (0.005 → 0.01, 2.005 → 2.00) are JS toFixed /
// IEEE-754 artifacts that the client already produces; the server MUST match
// them exactly, so they are asserted as-is rather than "corrected".
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLineAmount, computeInvoiceTotals } from "./invoice-totals.ts";

// ─── Line amount ─────────────────────────────────────────────────────────────

test("computeLineAmount: whole qty × price", () => {
  assert.equal(computeLineAmount("1", "100.00"), "100.00");
});

test("computeLineAmount: fractional quantity", () => {
  assert.equal(computeLineAmount("2.5", "10.00"), "25.00");
});

test("computeLineAmount: rounds to the cent (3 × 33.33 = 99.99)", () => {
  assert.equal(computeLineAmount("3", "33.33"), "99.99");
});

test("computeLineAmount: strips $ and commas like the client", () => {
  assert.equal(computeLineAmount("$1,200", "2"), "2400.00");
});

test("computeLineAmount: JS rounding artifact 1 × 0.005 = 0.01 (mirrors client)", () => {
  assert.equal(computeLineAmount("1", "0.005"), "0.01");
});

test("computeLineAmount: JS rounding artifact 1 × 2.005 = 2.00 (mirrors client)", () => {
  assert.equal(computeLineAmount("1", "2.005"), "2.00");
});

test("computeLineAmount: null/empty inputs → 0.00", () => {
  assert.equal(computeLineAmount(null, "10"), "0.00");
  assert.equal(computeLineAmount("", ""), "0.00");
  assert.equal(computeLineAmount(undefined, undefined), "0.00");
});

// ─── Invoice totals ──────────────────────────────────────────────────────────

test("computeInvoiceTotals: empty line list → 0.00 subtotal and total", () => {
  const r = computeInvoiceTotals([]);
  assert.equal(r.subtotal, "0.00");
  assert.equal(r.total, "0.00");
  assert.deepEqual(r.items, []);
});

test("computeInvoiceTotals: null/undefined items → 0.00", () => {
  assert.equal(computeInvoiceTotals(undefined).subtotal, "0.00");
  assert.equal(computeInvoiceTotals(null).total, "0.00");
});

test("computeInvoiceTotals: sums rounded line amounts, total == subtotal (no tax)", () => {
  const r = computeInvoiceTotals([
    { quantity: "1", unitPrice: "100.00" },
    { quantity: "2.5", unitPrice: "10.00" },
    { quantity: "3", unitPrice: "33.33" },
  ]);
  assert.deepEqual(r.items.map((i) => i.amount), ["100.00", "25.00", "99.99"]);
  assert.equal(r.subtotal, "224.99");
  assert.equal(r.total, "224.99");
});

test("computeInvoiceTotals: recomputes amount and IGNORES any client-supplied amount", () => {
  const r = computeInvoiceTotals([
    // Client claims this line is $1.00; real math is 4 × 25.00 = 100.00.
    { quantity: "4", unitPrice: "25.00", amount: "1.00" },
  ]);
  assert.equal(r.items[0].amount, "100.00");
  assert.equal(r.subtotal, "100.00");
  assert.equal(r.total, "100.00");
});

test("computeInvoiceTotals: preserves other line fields while overwriting amount", () => {
  const r = computeInvoiceTotals([
    { quantity: "2", unitPrice: "5.00", type: "labor", description: "Diagnostic", visitNumber: 3 },
  ]);
  assert.equal(r.items[0].amount, "10.00");
  assert.equal(r.items[0].type, "labor");
  assert.equal(r.items[0].description, "Diagnostic");
  assert.equal(r.items[0].visitNumber, 3);
});

test("computeInvoiceTotals: rounding is per-line-then-sum (0.335 twice)", () => {
  // Each line rounds first, then the rounded amounts are summed — matches the
  // client's reduce over parseMoney(item.amount).
  const r = computeInvoiceTotals([
    { quantity: "1", unitPrice: "0.335" },
    { quantity: "1", unitPrice: "0.335" },
  ]);
  const per = computeLineAmount("1", "0.335");
  const expected = (parseFloat(per) * 2).toFixed(2);
  assert.equal(r.items[0].amount, per);
  assert.equal(r.subtotal, expected);
});
