// Tests for the read-only legacy → product1 divergence report (Issue #64 prep).
//
// The report tells Kevin exactly what a legacy → product1 reconciliation would
// change BEFORE any write happens. These tests build a throwaway SQLite DB with
// a minimal slice of the real schema (service_calls legacy columns +
// service_call_products) and prove the four cases the report must distinguish:
// clean, diverged, the "possible deliberate clear" review flag, and a call with
// no Product 1 row. Pure functions only — no files, no writes, no prod data.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
// The script is plain Node (.mjs); its comparison helpers are exported so the
// CLI and this test share one implementation.
import {
  auditLegacyDivergence,
  formatDivergenceReport,
  LEGACY_FIELDS,
  norm,
} from "../scripts/audit-legacy-divergence.mjs";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE service_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_date TEXT,
      manufacturer TEXT, manufacturer_other TEXT, product_model TEXT,
      product_serial TEXT, product_type TEXT, installation_date TEXT,
      issue_description TEXT, diagnosis TEXT, resolution TEXT,
      claim_status TEXT, claim_number TEXT, claim_notes TEXT,
      parts_cost TEXT, labor_cost TEXT, other_cost TEXT, claim_amount TEXT,
      updated_at TEXT
    );
    CREATE TABLE service_call_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_call_id INTEGER NOT NULL,
      product_index INTEGER NOT NULL DEFAULT 1,
      voided INTEGER NOT NULL DEFAULT 0,
      manufacturer TEXT, manufacturer_other TEXT, product_model TEXT,
      product_serial TEXT, product_type TEXT, installation_date TEXT,
      issue_description TEXT, diagnosis TEXT, resolution TEXT,
      claim_status TEXT, claim_number TEXT, claim_notes TEXT,
      parts_cost TEXT, labor_cost TEXT, other_cost TEXT, claim_amount TEXT,
      updated_at TEXT
    );
  `);
  return db;
}

// Insert a service_calls row; unspecified legacy fields are NULL.
function insertCall(db: Database.Database, id: number, fields: Record<string, unknown>) {
  const cols = ["id", "call_date", "updated_at", ...LEGACY_FIELDS];
  const vals = cols.map((c) => (c in fields ? fields[c] : c === "id" ? id : null));
  vals[0] = id;
  db.prepare(`INSERT INTO service_calls (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals);
}

// Insert a Product 1 row for a call.
function insertProduct(db: Database.Database, callId: number, fields: Record<string, unknown>) {
  const cols = ["service_call_id", "product_index", "voided", "updated_at", ...LEGACY_FIELDS];
  const vals = cols.map((c) => {
    if (c === "service_call_id") return callId;
    if (c === "product_index") return fields.product_index ?? 1;
    if (c === "voided") return fields.voided ?? 0;
    return c in fields ? fields[c] : null;
  });
  db.prepare(`INSERT INTO service_call_products (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals);
}

test("norm treats NULL, empty, and whitespace as equal", () => {
  assert.equal(norm(null), "");
  assert.equal(norm("   "), "");
  assert.equal(norm(" hi "), "hi");
});

test("clean call: product1 matches legacy → not diverged", () => {
  const db = freshDb();
  insertCall(db, 1, { manufacturer: "Acme", issue_description: "leaking", updated_at: "2026-01-01T00:00:00Z" });
  insertProduct(db, 1, { manufacturer: "Acme", issue_description: "leaking", updated_at: "2026-01-01T00:00:00Z" });

  const report = auditLegacyDivergence(db);
  assert.equal(report.scanned, 1);
  assert.equal(report.diverged.length, 0);
  assert.equal(report.reviewCount, 0);
  assert.equal(report.noProduct.count, 0);
  assert.match(formatDivergenceReport(report), /No divergence found/);
  db.close();
});

test("diverged call: legacy edited, product1 stale → reported field-by-field", () => {
  const db = freshDb();
  insertCall(db, 1, {
    manufacturer: "Acme",
    issue_description: "EDITED: replaced under warranty",
    diagnosis: "EDITED: cracked heat exchanger",
    updated_at: "2026-02-01T00:00:00Z",
  });
  insertProduct(db, 1, {
    manufacturer: "Acme",
    issue_description: "ORIGINAL: unit leaking",
    diagnosis: "ORIGINAL: bad valve",
    updated_at: "2026-01-01T00:00:00Z",
  });

  const report = auditLegacyDivergence(db);
  assert.equal(report.scanned, 1);
  assert.equal(report.diverged.length, 1);
  assert.equal(report.diverged[0].id, 1);
  const changed = report.diverged[0].fields.map((f: any) => f.field).sort();
  assert.deepEqual(changed, ["diagnosis", "issue_description"]);
  assert.equal(report.fieldCounts.issue_description, 1);
  assert.equal(report.fieldCounts.diagnosis, 1);
  // These are stale-not-cleared, so NOT review-flagged.
  assert.equal(report.reviewCount, 0);

  const out = formatDivergenceReport(report);
  assert.match(out, /Call #1/);
  assert.match(out, /LEGACY   \(would be kept\/copied\):  "EDITED: replaced under warranty"/);
  assert.match(out, /PRODUCT1 \(would be overwritten\):  "ORIGINAL: unit leaking"/);
  db.close();
});

test("review flag: product1 blanked more recently than the call was edited", () => {
  const db = freshDb();
  // Legacy still populated; product1 empty; product updated AFTER the call.
  insertCall(db, 1, { manufacturer: "Acme", claim_number: "WC-123", updated_at: "2026-01-01T00:00:00Z" });
  insertProduct(db, 1, { manufacturer: "Acme", claim_number: null, updated_at: "2026-03-01T00:00:00Z" });

  const report = auditLegacyDivergence(db);
  assert.equal(report.diverged.length, 1);
  const claimField = report.diverged[0].fields.find((f: any) => f.field === "claim_number");
  assert.equal(claimField.review, true);
  assert.equal(report.reviewCount, 1);
  assert.match(formatDivergenceReport(report), /REVIEW: possible deliberate clear/);
  db.close();
});

test("stale-empty product1 with OLDER product timestamp is NOT review-flagged", () => {
  const db = freshDb();
  insertCall(db, 1, { manufacturer: "Acme", claim_number: "WC-123", updated_at: "2026-03-01T00:00:00Z" });
  insertProduct(db, 1, { manufacturer: "Acme", claim_number: null, updated_at: "2026-01-01T00:00:00Z" });

  const report = auditLegacyDivergence(db);
  assert.equal(report.diverged.length, 1);
  assert.equal(report.reviewCount, 0);
  db.close();
});

test("call with no Product 1 row is counted separately, not scanned", () => {
  const db = freshDb();
  insertCall(db, 1, { manufacturer: "Acme", issue_description: "leaking" });
  // Only a voided Product 1 and a Product 2 exist — neither is a valid target.
  insertProduct(db, 1, { manufacturer: "Acme", voided: 1 });
  insertProduct(db, 1, { manufacturer: "Acme", product_index: 2 });

  const report = auditLegacyDivergence(db);
  assert.equal(report.scanned, 0);
  assert.equal(report.noProduct.count, 1);
  assert.deepEqual(report.noProduct.ids, [1]);
  assert.match(formatDivergenceReport(report), /Calls with NO Product 1 row.*: 1/);
  db.close();
});

test("mixed dataset: summary counts add up", () => {
  const db = freshDb();
  // #1 clean, #2 diverged (2 fields), #3 review-flag, #4 no product row.
  insertCall(db, 1, { manufacturer: "Acme", issue_description: "x", updated_at: "2026-01-01T00:00:00Z" });
  insertProduct(db, 1, { manufacturer: "Acme", issue_description: "x", updated_at: "2026-01-01T00:00:00Z" });

  insertCall(db, 2, { manufacturer: "Beta", issue_description: "new", diagnosis: "new", updated_at: "2026-02-01T00:00:00Z" });
  insertProduct(db, 2, { manufacturer: "Beta", issue_description: "old", diagnosis: "old", updated_at: "2026-01-01T00:00:00Z" });

  insertCall(db, 3, { manufacturer: "Gamma", resolution: "kept", updated_at: "2026-01-01T00:00:00Z" });
  insertProduct(db, 3, { manufacturer: "Gamma", resolution: null, updated_at: "2026-03-01T00:00:00Z" });

  insertCall(db, 4, { manufacturer: "Delta" });

  const report = auditLegacyDivergence(db);
  assert.equal(report.totalCalls, 4);
  assert.equal(report.scanned, 3); // #1, #2, #3 have product1; #4 does not
  assert.equal(report.diverged.length, 2); // #2 and #3
  assert.equal(report.reviewCount, 1); // #3 resolution clear
  assert.equal(report.noProduct.count, 1);
  assert.deepEqual(report.noProduct.ids, [4]);
  assert.equal(report.fieldCounts.issue_description, 1);
  assert.equal(report.fieldCounts.diagnosis, 1);
  assert.equal(report.fieldCounts.resolution, 1);
  db.close();
});
