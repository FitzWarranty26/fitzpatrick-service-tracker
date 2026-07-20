#!/usr/bin/env node
/**
 * READ-ONLY foreign-key orphan audit (server C4).
 *
 * Counts child rows whose non-NULL foreign key points at a parent row that no
 * longer exists, for every parent→child relationship in the schema. Use it to
 * decide whether it is safe to enable `PRAGMA foreign_keys = ON` in production:
 * a clean report means the app will enable enforcement automatically on its next
 * boot (see the FK gate in server/storage.ts); a dirty report lists exactly
 * which rows to clean up first.
 *
 * SAFETY: opens the database in { readonly: true } mode — it cannot write,
 * update, or delete anything, so no backup is required. Run it against the live
 * DB or a backup copy.
 *
 * Usage (from the Render Shell, in the service's working directory):
 *   node scripts/audit-orphans.mjs                 # uses DB_PATH
 *   node scripts/audit-orphans.mjs /path/to/copy.db
 *
 * The DB path is the first CLI arg if given, else DB_PATH
 * (production: /var/data/warranty_tracker.db).
 *
 * NOTE: the ORPHAN_CHECKS list below is kept in sync with server/orphan-audit.ts
 * (the shared module the app + tests use). Keep the two identical.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function fail(msg) {
  console.error(`\n  ERROR: ${msg}\n`);
  process.exit(1);
}

// Kept in sync with ORPHAN_CHECKS in server/orphan-audit.ts.
const ORPHAN_CHECKS = [
  { childTable: "photos", childColumn: "service_call_id", parentTable: "service_calls", parentColumn: "id" },
  { childTable: "parts_used", childColumn: "service_call_id", parentTable: "service_calls", parentColumn: "id" },
  { childTable: "activity_log", childColumn: "service_call_id", parentTable: "service_calls", parentColumn: "id" },
  { childTable: "invoices", childColumn: "service_call_id", parentTable: "service_calls", parentColumn: "id" },
  { childTable: "invoice_items", childColumn: "invoice_id", parentTable: "invoices", parentColumn: "id" },
  { childTable: "service_call_visits", childColumn: "service_call_id", parentTable: "service_calls", parentColumn: "id" },
  { childTable: "service_call_visits", childColumn: "technician_id", parentTable: "users", parentColumn: "id" },
  { childTable: "scheduled_appointments", childColumn: "call_id", parentTable: "service_calls", parentColumn: "id" },
  { childTable: "scheduled_appointments", childColumn: "created_by_id", parentTable: "users", parentColumn: "id" },
  { childTable: "service_call_products", childColumn: "service_call_id", parentTable: "service_calls", parentColumn: "id" },
];

const DB_PATH = process.argv[2] || process.env.DB_PATH || "warranty_tracker.db";
const resolved = path.resolve(DB_PATH);

if (!fs.existsSync(resolved)) {
  fail(
    `Database not found at ${resolved}.\n` +
    "  In production DB_PATH should be /var/data/warranty_tracker.db, or pass a\n" +
    "  path to a backup copy as the first argument."
  );
}

let Database;
try {
  Database = require("better-sqlite3");
} catch {
  fail("better-sqlite3 is not installed in this environment.");
}

// readonly: true guarantees this script cannot modify the database.
const db = new Database(resolved, { readonly: true, fileMustExist: true });

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

try {
  const rows = [];
  let totalOrphans = 0;

  for (const check of ORPHAN_CHECKS) {
    if (!tableExists(check.childTable) || !tableExists(check.parentTable)) continue;
    if (!columnExists(check.childTable, check.childColumn)) continue;
    const { n } = db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${check.childTable} c
         WHERE c.${check.childColumn} IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM ${check.parentTable} p
             WHERE p.${check.parentColumn} = c.${check.childColumn}
           )`
      )
      .get();
    totalOrphans += n;
    rows.push({
      relationship: `${check.childTable}.${check.childColumn} -> ${check.parentTable}.${check.parentColumn}`,
      orphans: n,
    });
  }

  console.log(`\n  DB: ${resolved}`);
  console.log(`  Relationships checked: ${rows.length}`);
  console.log(`  Total orphaned rows: ${totalOrphans}\n`);
  console.table(rows);

  if (totalOrphans === 0) {
    console.log("\n  CLEAN — safe to enable PRAGMA foreign_keys = ON (app enables it automatically on next boot).\n");
  } else {
    console.log("\n  ORPHANS FOUND — clean these up before FK enforcement can be enabled.\n");
  }
} finally {
  db.close();
}
