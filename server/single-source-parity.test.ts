// A2 step 3 — single-source-of-truth parity tests (Issue #64).
//
// After repointing every reader to the Product 1 row (product_index=1,
// voided=0) and removing syncLegacyFromProduct, these tests prove:
//   1. On RECONCILED data (product1 == legacy) every reader returns the same
//      values it returned before the repoint (parity).
//   2. Product 1 is authoritative: when product1 differs from the legacy column,
//      readers return the product1 value — proving the repoint is real.
//   3. When a call has NO product1 row, readers fall back to the legacy column
//      (the reconcile eliminates this case in production).
//   4. syncLegacyFromProduct is gone: a product-form edit no longer mutates the
//      legacy service_calls columns, yet the detail payload still reflects it
//      (because the reader now sources from product1).
//
// Self-contained: points DB_PATH at a throwaway temp SQLite file BEFORE
// importing storage. Fake data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "fst-parity-test-")), "test.db");

const { storage, sqlite } = await import("./storage.ts");

async function newCall(overrides: Record<string, unknown> = {}) {
  return await storage.createServiceCall({
    callDate: "2026-01-01",
    manufacturer: "Acme",
    issueDescription: "legacy issue text",
    diagnosis: "legacy diagnosis",
    claimNumber: "LEG-1",
    ...overrides,
  } as any);
}

// Seed a Product 1 row that matches the legacy columns (reconciled state).
async function seedMatchingProduct1(call: any) {
  return await storage.createServiceCallProduct({
    serviceCallId: call.id,
    productIndex: 1,
    manufacturer: call.manufacturer,
    issueDescription: call.issueDescription,
    diagnosis: call.diagnosis,
    claimNumber: call.claimNumber,
  } as any);
}

function setProduct1(callId: number, col: string, value: string | null) {
  sqlite
    .prepare(
      `UPDATE service_call_products SET ${col} = ? WHERE service_call_id = ? AND product_index = 1 AND voided = 0`,
    )
    .run(value, callId);
}

function setLegacy(callId: number, col: string, value: string | null) {
  sqlite.prepare(`UPDATE service_calls SET ${col} = ? WHERE id = ?`).run(value, callId);
}

async function fromList(callId: number) {
  return (await storage.getAllServiceCalls()).find((c) => c.id === callId)!;
}

test("parity: reconciled data reads identically across list + detail", async () => {
  const call = await newCall();
  await seedMatchingProduct1(call);

  const list = await fromList(call.id);
  const detail = await storage.getServiceCallById(call.id);

  for (const view of [list, detail]) {
    assert.equal(view!.issueDescription, "legacy issue text");
    assert.equal(view!.diagnosis, "legacy diagnosis");
    assert.equal(view!.claimNumber, "LEG-1");
    assert.equal(view!.manufacturer, "Acme");
  }
});

test("Product 1 is authoritative: readers return product1 when it differs from legacy", async () => {
  const call = await newCall();
  await seedMatchingProduct1(call);

  // Simulate post-reconcile state where Product 1 carries the fresh value and the
  // legacy column is stale (e.g. a product-form edit under the new single write path).
  setProduct1(call.id, "issue_description", "PRODUCT1 fresh value");
  setLegacy(call.id, "issue_description", "LEGACY stale value");

  assert.equal((await fromList(call.id)).issueDescription, "PRODUCT1 fresh value");
  assert.equal((await storage.getServiceCallById(call.id))!.issueDescription, "PRODUCT1 fresh value");
});

test("fallback: empty product1 field falls back to the legacy column", async () => {
  const call = await newCall();
  await seedMatchingProduct1(call);

  // Product 1 field blanked, legacy still populated → reader shows legacy.
  setProduct1(call.id, "diagnosis", "");
  setLegacy(call.id, "diagnosis", "legacy diagnosis survives");

  assert.equal((await fromList(call.id)).diagnosis, "legacy diagnosis survives");
  assert.equal((await storage.getServiceCallById(call.id))!.diagnosis, "legacy diagnosis survives");
});

test("fallback: a call with NO product1 row reads the legacy columns", async () => {
  const call = await newCall({ issueDescription: "no-product legacy text", diagnosis: "d" });
  // createServiceCall does not create a product row.
  const rows = sqlite
    .prepare(`SELECT COUNT(*) AS c FROM service_call_products WHERE service_call_id = ?`)
    .get(call.id) as any;
  assert.equal(rows.c, 0);

  assert.equal((await fromList(call.id)).issueDescription, "no-product legacy text");
  assert.equal((await storage.getServiceCallById(call.id))!.issueDescription, "no-product legacy text");
});

test("cross-reader consistency: list, detail and recent agree on the product1 value", async () => {
  const call = await newCall();
  await seedMatchingProduct1(call);
  setProduct1(call.id, "manufacturer", "ProdMfg");

  const list = await fromList(call.id);
  const detail = await storage.getServiceCallById(call.id);
  const recent = (await storage.getRecentServiceCalls(50)).find((c) => c.id === call.id);

  assert.equal(list.manufacturer, "ProdMfg");
  assert.equal(detail!.manufacturer, "ProdMfg");
  assert.equal(recent!.manufacturer, "ProdMfg");
});

test("syncLegacyFromProduct removed: product-form edit does not mutate legacy columns", async () => {
  const call = await newCall();
  const product = await seedMatchingProduct1(call);

  await storage.updateServiceCallProduct(product.id, {
    issueDescription: "edited on the product form",
  } as any);

  // The legacy service_calls column is untouched (no product→legacy sync anymore).
  const legacyRow = sqlite
    .prepare(`SELECT issue_description FROM service_calls WHERE id = ?`)
    .get(call.id) as any;
  assert.equal(legacyRow.issue_description, "legacy issue text");

  // But the detail payload still reflects the edit, because the reader now
  // sources the field from Product 1.
  assert.equal((await storage.getServiceCallById(call.id))!.issueDescription, "edited on the product form");
});
