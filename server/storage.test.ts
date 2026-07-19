// Regression tests for the non-destructive legacy sync (Option 1 hardening).
//
// Root cause of the original bug (#85/#86): creating a service call through the
// multi-product `products[]` path where Product 1 omitted the narrative fields
// caused syncLegacyFromProduct() to overwrite service_calls.issue_description
// (and diagnosis/resolution/claim_*) with NULL, wiping the value the user just
// entered. These tests prove the sync is now "fill-only / merge, never clobber".
//
// Self-contained: points DB_PATH at a throwaway temp SQLite file BEFORE importing
// storage (storage.ts opens the DB and creates tables at module init), so no
// real/production data is ever touched. Fake placeholder data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "fst-storage-test-")), "test.db");

const { storage } = await import("./storage.ts");

async function newCall(overrides: Record<string, unknown> = {}) {
  return await storage.createServiceCall({
    callDate: "2026-01-01",
    manufacturer: "Acme",
    issueDescription: "Water heater leaking from the base",
    ...overrides,
  } as any);
}

// The original bug: Product 1 arrives WITHOUT issue_description (identity-only,
// as the New Service Call form / offline replay sends it). The parent value must
// survive.
test("create via products[] path: Product 1 without issue_description preserves parent", async () => {
  const call = await newCall();
  assert.equal(call.issueDescription, "Water heater leaking from the base");

  await storage.createServiceCallProduct({
    serviceCallId: call.id,
    productIndex: 1,
    manufacturer: "Acme",
    productModel: "WH-40",
    productSerial: "SN-123",
    // NOTE: no issueDescription/diagnosis/resolution — the crux of the bug.
  } as any);

  const after = await storage.getServiceCallById(call.id);
  assert.equal(after?.issueDescription, "Water heater leaking from the base");
});

// A genuine non-empty edit on Product 1 must still propagate to the parent.
test("genuine non-empty product value still overwrites the parent", async () => {
  const call = await newCall({ issueDescription: "original text" });

  const product = await storage.createServiceCallProduct({
    serviceCallId: call.id,
    productIndex: 1,
    manufacturer: "Acme",
    issueDescription: "original text",
  } as any);

  await storage.updateServiceCallProduct(product.id, {
    issueDescription: "updated diagnosis: replaced thermocouple",
  } as any);

  const after = await storage.getServiceCallById(call.id);
  assert.equal(after?.issueDescription, "updated diagnosis: replaced thermocouple");
});

// An already-populated parent field must NOT be clobbered by a later sync that
// carries an empty/whitespace-only value.
test("subsequent sync with empty/whitespace value does not clobber populated parent", async () => {
  const call = await newCall({ issueDescription: "populated description", diagnosis: "bad valve" });

  const product = await storage.createServiceCallProduct({
    serviceCallId: call.id,
    productIndex: 1,
    manufacturer: "Acme",
    issueDescription: "populated description",
    diagnosis: "bad valve",
  } as any);

  // Simulate a sync driven by a product row whose narrative fields are blanked:
  // empty string for one field, whitespace-only for another.
  await storage.updateServiceCallProduct(product.id, {
    issueDescription: "",
    diagnosis: "   ",
  } as any);

  const after = await storage.getServiceCallById(call.id);
  assert.equal(after?.issueDescription, "populated description");
  assert.equal(after?.diagnosis, "bad valve");
});

// Multi-field guard applies uniformly across all synced narrative/claim fields.
test("fill-only guard applies to all synced narrative/claim fields", async () => {
  const call = await newCall({
    issueDescription: "desc",
    diagnosis: "diag",
    resolution: "res",
    claimNumber: "CLM-1",
    claimNotes: "notes",
    partsCost: "10.00",
    laborCost: "20.00",
    otherCost: "5.00",
    claimAmount: "35.00",
  });

  await storage.createServiceCallProduct({
    serviceCallId: call.id,
    productIndex: 1,
    manufacturer: "Acme",
    productModel: "WH-40",
    // all narrative/claim fields intentionally omitted
  } as any);

  const after = await storage.getServiceCallById(call.id);
  assert.equal(after?.issueDescription, "desc");
  assert.equal(after?.diagnosis, "diag");
  assert.equal(after?.resolution, "res");
  assert.equal(after?.claimNumber, "CLM-1");
  assert.equal(after?.claimNotes, "notes");
  assert.equal(after?.partsCost, "10.00");
  assert.equal(after?.laborCost, "20.00");
  assert.equal(after?.otherCost, "5.00");
  assert.equal(after?.claimAmount, "35.00");
  // A real identity value that WAS provided should still mirror through.
  assert.equal(after?.productModel, "WH-40");
});

// ─── Regression: photo-upload body-limit skip predicate (#413 fix) ──────────────
// The global 1mb express.json parser in server/index.ts must SKIP the photo
// upload route so the route-level 20mb parser in routes.ts actually runs.
// isPhotoUploadRequest is the predicate that decides which requests to skip.
import { isPhotoUploadRequest } from "./photo-upload-path.ts";

test("isPhotoUploadRequest: matches POST photo upload route only", () => {
  assert.equal(isPhotoUploadRequest("POST", "/api/service-calls/123/photos"), true);
  assert.equal(isPhotoUploadRequest("POST", "/api/service-calls/abc/photos"), true);
});

test("isPhotoUploadRequest: ignores other methods and routes", () => {
  // GET on the same path must still use the global parser
  assert.equal(isPhotoUploadRequest("GET", "/api/service-calls/123/photos"), false);
  // reorder / nested paths are not the upload route
  assert.equal(isPhotoUploadRequest("POST", "/api/service-calls/123/photos/reorder"), false);
  assert.equal(isPhotoUploadRequest("DELETE", "/api/photos/5"), false);
  assert.equal(isPhotoUploadRequest("POST", "/api/service-calls/123"), false);
  assert.equal(isPhotoUploadRequest("POST", "/api/service-calls"), false);
});
