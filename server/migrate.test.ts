// Versioned-migration runner + baselining tests (server H5).
//
// The two paths that MUST both hold in production:
//   (a) fresh/empty DB  -> baseline executes, full schema created.
//   (b) pre-existing DB -> baseline marked applied WITHOUT executing (the live
//       production schema is never touched), app can boot.
//
// For (b) we simulate a DB that predates this migration system by applying the
// baseline SQL directly and leaving no bookkeeping table — which is exactly the
// state a production DB built by the old inline startup migrations is in (the
// baseline file was itself dumped from a legacy-built DB, so the schemas match).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "./migrate.ts";
import { seedAdmin, seedInitialData } from "./seed.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, "..", "migrations");

const EXPECTED_TABLES = [
  "activity_log",
  "audit_log_system",
  "contacts",
  "invoice_items",
  "invoices",
  "login_attempts",
  "parts_used",
  "photo_label_presets",
  "photos",
  "scheduled_appointments",
  "service_call_products",
  "service_call_visits",
  "service_calls",
  "sessions",
  "users",
];

function tableNames(db: Database.Database): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name")
    .all()
    .map((r: any) => r.name);
}

function applyBaselineRaw(db: Database.Database) {
  // Mimic a legacy-built (pre-migration-system) DB: schema present, no bookkeeping.
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, "0000_baseline.sql"), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
    db.exec(stmt);
  }
}

test("fresh/empty DB: baseline executes and creates the full schema", () => {
  const db = new Database(":memory:");
  const res = runMigrations(db, { dir: MIGRATIONS_DIR });

  assert.deepEqual(res.applied, ["0000_baseline"], "baseline should have been executed");
  assert.deepEqual(res.baselined, [], "nothing should be baselined on an empty DB");
  assert.deepEqual(tableNames(db), EXPECTED_TABLES);

  // Bookkeeping records it as a real (executed) application, not a baseline.
  const row: any = db.prepare("SELECT baselined FROM schema_migrations WHERE name = ?").get("0000_baseline");
  assert.equal(row.baselined, 0);
  db.close();
});

test("pre-existing DB (predates system): baseline marked applied WITHOUT executing", () => {
  const db = new Database(":memory:");
  applyBaselineRaw(db);
  const before = tableNames(db);
  // Prove there is no bookkeeping yet — this is the real production shape.
  const hasBookkeeping = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  assert.ok(!hasBookkeeping, "precondition: existing DB has no bookkeeping table");

  const res = runMigrations(db, { dir: MIGRATIONS_DIR });

  assert.deepEqual(res.baselined, ["0000_baseline"], "existing schema should be baselined");
  assert.deepEqual(res.applied, [], "baseline must NOT be executed against an existing DB");
  assert.deepEqual(tableNames(db), before, "schema must be unchanged");

  const row: any = db.prepare("SELECT baselined FROM schema_migrations WHERE name = ?").get("0000_baseline");
  assert.equal(row.baselined, 1, "recorded as a baseline, not an execution");
  db.close();
});

test("runMigrations is idempotent: a second run is a no-op", () => {
  const db = new Database(":memory:");
  runMigrations(db, { dir: MIGRATIONS_DIR });
  const res2 = runMigrations(db, { dir: MIGRATIONS_DIR });
  assert.deepEqual(res2.applied, []);
  assert.deepEqual(res2.baselined, []);
  assert.deepEqual(res2.skipped, ["0000_baseline"]);
  db.close();
});

test("seedAdmin: creates one admin on empty DB, honors SEED_ADMIN_PASSWORD, idempotent", () => {
  const db = new Database(":memory:");
  runMigrations(db, { dir: MIGRATIONS_DIR });

  const prev = process.env.SEED_ADMIN_PASSWORD;
  process.env.SEED_ADMIN_PASSWORD = "supersecret123";
  try {
    seedAdmin(db, () => {});
    seedAdmin(db, () => {}); // second call must not create a duplicate
  } finally {
    if (prev === undefined) delete process.env.SEED_ADMIN_PASSWORD;
    else process.env.SEED_ADMIN_PASSWORD = prev;
  }

  const admins: any[] = db.prepare("SELECT username, role, must_change_password FROM users").all();
  assert.equal(admins.length, 1);
  assert.equal(admins[0].username, "admin");
  assert.equal(admins[0].role, "manager");
  assert.equal(admins[0].must_change_password, 1, "seeded admin must be forced to change password");
  db.close();
});

test("seedInitialData: inserts the contact list once and is idempotent", () => {
  const db = new Database(":memory:");
  runMigrations(db, { dir: MIGRATIONS_DIR });

  seedInitialData(db, () => {});
  const first = (db.prepare("SELECT COUNT(*) c FROM contacts").get() as any).c;
  assert.ok(first >= 41, `expected the 40 contacts + TEST CUSTOMER, got ${first}`);

  seedInitialData(db, () => {});
  const second = (db.prepare("SELECT COUNT(*) c FROM contacts").get() as any).c;
  assert.equal(second, first, "re-running the seed must not duplicate rows");
  db.close();
});
