// Tests for the read-only FK orphan audit (server C4).
//
// The audit is the gate that decides whether the app enables
// `PRAGMA foreign_keys = ON` at boot: a clean DB enables enforcement, a DB with
// pre-existing orphans blocks it (fail-open). These tests build a throwaway
// SQLite DB with the relevant relationships and prove both directions. They open
// their own better-sqlite3 handle (foreign_keys OFF by default) so orphans can
// be created deliberately; no real/production data is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { auditOrphans, hasOrphans, formatOrphanReport } from "./orphan-audit.ts";

function freshDb() {
  const db = new Database(":memory:");
  // Minimal slice of the real schema: parents + a declared-FK child and an
  // undeclared-FK child, matching server/storage.ts DDL.
  db.exec(`
    CREATE TABLE service_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, service_call_id INTEGER);
    CREATE TABLE invoice_items (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL);
    CREATE TABLE photos (id INTEGER PRIMARY KEY AUTOINCREMENT, service_call_id INTEGER NOT NULL);
    CREATE TABLE service_call_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_call_id INTEGER NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE
    );
    CREATE TABLE scheduled_appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
      created_by_id INTEGER
    );
  `);
  return db;
}

test("clean DB: audit reports zero orphans → FK enforcement allowed", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO service_calls (id, created_at) VALUES (1, '2026-01-01')`).run();
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'admin')`).run();
  db.prepare(`INSERT INTO invoices (id, service_call_id) VALUES (1, 1)`).run();
  db.prepare(`INSERT INTO invoice_items (invoice_id) VALUES (1)`).run();
  db.prepare(`INSERT INTO photos (service_call_id) VALUES (1)`).run();
  db.prepare(`INSERT INTO service_call_products (service_call_id) VALUES (1)`).run();
  db.prepare(`INSERT INTO scheduled_appointments (call_id, created_by_id) VALUES (1, 1)`).run();
  // A NULL FK is legitimately unlinked and must NOT count as an orphan.
  db.prepare(`INSERT INTO invoices (id, service_call_id) VALUES (2, NULL)`).run();

  const results = auditOrphans(db);
  assert.equal(hasOrphans(results), false);
  assert.equal(formatOrphanReport(results), "");
  db.close();
});

test("orphaned child row: audit detects it → FK enforcement blocked", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO service_calls (id, created_at) VALUES (1, '2026-01-01')`).run();
  db.prepare(`INSERT INTO photos (service_call_id) VALUES (1)`).run();
  // Create an orphan: a photo whose service_call no longer exists.
  db.prepare(`INSERT INTO photos (service_call_id) VALUES (999)`).run();

  const results = auditOrphans(db);
  assert.equal(hasOrphans(results), true);
  const photos = results.find((r) => r.childTable === "photos" && r.childColumn === "service_call_id");
  assert.equal(photos?.orphanCount, 1);
  assert.match(formatOrphanReport(results), /photos\.service_call_id → service_calls\.id: 1 orphan/);
  db.close();
});

test("orphan in a declared-FK child (invoice_items) is detected", () => {
  const db = freshDb();
  // invoice_item pointing at a non-existent invoice.
  db.prepare(`INSERT INTO invoice_items (invoice_id) VALUES (42)`).run();
  const results = auditOrphans(db);
  const items = results.find((r) => r.childTable === "invoice_items");
  assert.equal(items?.orphanCount, 1);
  assert.equal(hasOrphans(results), true);
  db.close();
});

test("missing tables/columns are skipped without throwing", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE service_calls (id INTEGER PRIMARY KEY);`);
  // Only one parent table exists; every child relationship should be skipped.
  const results = auditOrphans(db);
  assert.equal(hasOrphans(results), false);
  db.close();
});
