// A2 step 1 — write-through regression tests.
//
// The detail-page edit path (PATCH /api/service-calls/:id → updateServiceCall)
// historically wrote only the legacy service_calls columns, leaving the
// product_index=1 row stale (the divergence that blocked #64). These tests prove
// the write-through: a legacy-field edit now also lands on Product 1, a missing
// Product 1 row is created, the product-form path still mirrors product→legacy,
// and replayed/offline PATCHes are idempotent.
//
// Self-contained: points DB_PATH at a throwaway temp SQLite file BEFORE importing
// storage (storage.ts opens the DB + runs migrations at module init). Fake data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "fst-writethrough-test-")), "test.db");

const { storage, sqlite } = await import("./storage.ts");

function product1(callId: number) {
  return sqlite
    .prepare(
      `SELECT * FROM service_call_products WHERE service_call_id = ? AND product_index = 1 AND voided = 0 ORDER BY id LIMIT 1`,
    )
    .get(callId) as any;
}

async function newCall(overrides: Record<string, unknown> = {}) {
  return await storage.createServiceCall({
    callDate: "2026-01-01",
    manufacturer: "Acme",
    issueDescription: "Water heater leaking from the base",
    ...overrides,
  } as any);
}

test("edit via updateServiceCall mirrors legacy fields onto Product 1", async () => {
  const call = await newCall({ diagnosis: "orig diag" });
  // Seed a matching Product 1 (the New Service Call form path).
  await storage.createServiceCallProduct({
    serviceCallId: call.id,
    productIndex: 1,
    manufacturer: "Acme",
    issueDescription: "Water heater leaking from the base",
    diagnosis: "orig diag",
  } as any);

  await storage.updateServiceCall(call.id, {
    issueDescription: "EDITED: replaced under warranty",
    diagnosis: "EDITED: cracked heat exchanger",
  } as any);

  const p1 = product1(call.id);
  assert.equal(p1.issue_description, "EDITED: replaced under warranty");
  assert.equal(p1.diagnosis, "EDITED: cracked heat exchanger");
  // The parent (legacy) copy matches too — the two sources now converge.
  const parent = await storage.getServiceCallById(call.id);
  assert.equal(parent?.issueDescription, "EDITED: replaced under warranty");
  assert.equal(parent?.diagnosis, "EDITED: cracked heat exchanger");
});

test("edit when NO Product 1 row exists creates one (backfilled from legacy)", async () => {
  const call = await newCall({
    manufacturer: "Beta",
    diagnosis: "d0",
    resolution: "r0",
    claimNumber: "CLM-9",
  });
  // No product rows at all for this call.
  assert.equal(product1(call.id), undefined);

  await storage.updateServiceCall(call.id, {
    diagnosis: "d1",
  } as any);

  const p1 = product1(call.id);
  assert.ok(p1, "Product 1 row should have been created");
  assert.equal(p1.product_index, 1);
  assert.equal(p1.voided, 0);
  // The changed field applied, and the rest backfilled from the legacy columns.
  assert.equal(p1.diagnosis, "d1");
  assert.equal(p1.manufacturer, "Beta");
  assert.equal(p1.resolution, "r0");
  assert.equal(p1.claim_number, "CLM-9");
  assert.equal(p1.issue_description, "Water heater leaking from the base");
});

test("intentional clear on the parent path clears Product 1 too", async () => {
  const call = await newCall({ claimNumber: "CLM-1" });
  await storage.createServiceCallProduct({
    serviceCallId: call.id,
    productIndex: 1,
    manufacturer: "Acme",
    claimNumber: "CLM-1",
  } as any);

  await storage.updateServiceCall(call.id, { claimNumber: "" } as any);

  const p1 = product1(call.id);
  assert.equal(p1.claim_number, "");
});

test("edits that touch NO legacy field do not create or modify Product 1", async () => {
  const call = await newCall();
  // Only a non-legacy field (status) changes — no Product 1 should appear.
  await storage.updateServiceCall(call.id, { status: "In Progress" } as any);
  assert.equal(product1(call.id), undefined);
});

test("product-form path still mirrors product → legacy (unchanged)", async () => {
  const call = await newCall();
  const product = await storage.createServiceCallProduct({
    serviceCallId: call.id,
    productIndex: 1,
    manufacturer: "Acme",
    issueDescription: "Water heater leaking from the base",
  } as any);

  await storage.updateServiceCallProduct(product.id, {
    issueDescription: "product-form edit: flue blockage",
  } as any);

  const parent = await storage.getServiceCallById(call.id);
  assert.equal(parent?.issueDescription, "product-form edit: flue blockage");
});

test("offline replay: repeating the same PATCH is idempotent", async () => {
  const call = await newCall();
  await storage.createServiceCallProduct({
    serviceCallId: call.id,
    productIndex: 1,
    manufacturer: "Acme",
    issueDescription: "Water heater leaking from the base",
  } as any);

  const patch = { issueDescription: "replayed value", diagnosis: "replayed diag" } as any;
  await storage.updateServiceCall(call.id, patch);
  await storage.updateServiceCall(call.id, patch);
  await storage.updateServiceCall(call.id, patch);

  // Exactly one Product 1 row, holding the replayed values.
  const rows = sqlite
    .prepare(`SELECT * FROM service_call_products WHERE service_call_id = ? AND product_index = 1`)
    .all(call.id) as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].issue_description, "replayed value");
  assert.equal(rows[0].diagnosis, "replayed diag");
});
