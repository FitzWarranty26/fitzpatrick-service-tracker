// Regression test for deleteServiceCall (server C3).
//
// The old implementation deleted a call's invoices with a raw statement that
// bypassed deleteInvoice(), orphaning every invoice_items row; the whole
// sequence was also non-transactional. This proves the fix: after deleting a
// call, NO child row survives in any related table (invoice_items included) and
// the orphan audit is clean.
//
// Self-contained: points DB_PATH at a throwaway temp SQLite file BEFORE
// importing storage (storage.ts opens the DB and builds tables at module init),
// so no real/production data is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "fst-delete-test-")), "test.db");

const { storage, sqlite } = await import("./storage.ts");
const { auditOrphans, hasOrphans } = await import("./orphan-audit.ts");

test("deleteServiceCall removes all children including invoice_items — no orphans", () => {
  const call = storage.createServiceCall({
    callDate: "2026-01-01",
    manufacturer: "Acme",
    issueDescription: "Water heater leaking",
  } as any);

  const now = new Date().toISOString();
  // Invoice + line items (the orphan hazard).
  const inv = sqlite
    .prepare(
      `INSERT INTO invoices (invoice_number, service_call_id, bill_to_name, issue_date, subtotal, total, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get("INV-TEST-1", call.id, "Test Customer", "2026-01-01", "100.00", "100.00", now, now) as { id: number };
  sqlite.prepare(
    `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount) VALUES (?, ?, ?, ?, ?)`
  ).run(inv.id, "Labor", "1", "100.00", "100.00");
  sqlite.prepare(
    `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount) VALUES (?, ?, ?, ?, ?)`
  ).run(inv.id, "Part", "2", "0.00", "0.00");

  // The other related tables.
  sqlite.prepare(`INSERT INTO photos (service_call_id, photo_url) VALUES (?, ?)`).run(call.id, "data:image/x");
  sqlite.prepare(
    `INSERT INTO parts_used (service_call_id, part_number, part_description) VALUES (?, ?, ?)`
  ).run(call.id, "PN-1", "Thermocouple");
  sqlite.prepare(`INSERT INTO activity_log (service_call_id, note, created_at) VALUES (?, ?, ?)`).run(call.id, "note", now);
  sqlite.prepare(
    `INSERT INTO service_call_visits (service_call_id, visit_number, visit_date, created_at, updated_at) VALUES (?, 1, ?, ?, ?)`
  ).run(call.id, "2026-01-02", now, now);
  sqlite.prepare(
    `INSERT INTO scheduled_appointments (call_id, scheduled_date, status) VALUES (?, ?, 'active')`
  ).run(call.id, "2026-01-03");

  // Sanity: children exist before the delete.
  const itemCountBefore = (sqlite.prepare(`SELECT COUNT(*) AS n FROM invoice_items WHERE invoice_id = ?`).get(inv.id) as { n: number }).n;
  assert.equal(itemCountBefore, 2);

  storage.deleteServiceCall(call.id);

  const count = (table: string, col: string, val: number) =>
    (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(val) as { n: number }).n;

  assert.equal(count("service_calls", "id", call.id), 0, "service_call row remains");
  assert.equal(count("invoices", "service_call_id", call.id), 0, "invoice remains");
  assert.equal(count("invoice_items", "invoice_id", inv.id), 0, "invoice_items orphaned (the C3 bug)");
  assert.equal(count("photos", "service_call_id", call.id), 0, "photos remain");
  assert.equal(count("parts_used", "service_call_id", call.id), 0, "parts remain");
  assert.equal(count("activity_log", "service_call_id", call.id), 0, "activity remains");
  assert.equal(count("service_call_visits", "service_call_id", call.id), 0, "visits remain");
  assert.equal(count("scheduled_appointments", "call_id", call.id), 0, "appointments remain");
  assert.equal(count("service_call_products", "service_call_id", call.id), 0, "products remain");

  // Whole-DB integrity: nothing orphaned anywhere.
  assert.equal(hasOrphans(auditOrphans(sqlite)), false);
});
