#!/usr/bin/env node
/**
 * READ-ONLY diagnostic — blast radius of the create-time description-wipe bug.
 *
 * Lists every service call whose Issue Description was blanked to NULL/empty
 * (see bug in server/routes.ts POST /api/service-calls -> syncLegacyFromProduct).
 * It checks BOTH the service_calls row AND its Product 1 (product_index = 1)
 * row, since the create bug omits the narrative field from Product 1 too.
 *
 * PRIVACY: output is intentionally PII-minimal. It prints only the service
 * call id, dates, empty/blank flags, and the creator/technician id + name.
 * It does NOT print homeowner names, addresses, phone numbers, the description
 * text itself, or any photo data.
 *
 * SAFETY: opens the database in { readonly: true } mode. It cannot write,
 * update, or delete anything. No backup is needed because nothing is modified.
 *
 * Usage (from the Render Shell, in the service's working directory):
 *   node scripts/find-blank-descriptions.mjs
 *
 * The DB path is read from DB_PATH (production: /var/data/warranty_tracker.db).
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

const DB_PATH = process.env.DB_PATH || "warranty_tracker.db";
const resolved = path.resolve(DB_PATH);

if (!fs.existsSync(resolved)) {
  fail(
    `Database not found at ${resolved}.\n` +
    "  In production DB_PATH should be /var/data/warranty_tracker.db. Confirm\n" +
    "  you are running this on the Render web service with the disk mounted."
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

try {
  const rows = db
    .prepare(
      `SELECT
         sc.id                                    AS service_call_id,
         sc.call_date                             AS call_date,
         sc.created_at                            AS created_at,
         CASE WHEN sc.issue_description IS NULL
                OR TRIM(sc.issue_description) = ''
              THEN 1 ELSE 0 END                   AS call_desc_empty,
         CASE WHEN p1.issue_description IS NULL
                OR TRIM(p1.issue_description) = ''
              THEN 1 ELSE 0 END                   AS product1_desc_empty,
         CASE WHEN p1.id IS NULL THEN 0 ELSE 1 END AS has_product1,
         sc.is_test                               AS is_test,
         sc.created_by                            AS created_by_id,
         u.username                               AS created_by_username,
         u.display_name                           AS created_by_name,
         sc.assigned_technician_id                AS assigned_technician_id
       FROM service_calls sc
       LEFT JOIN service_call_products p1
         ON p1.service_call_id = sc.id AND p1.product_index = 1
       LEFT JOIN users u ON u.id = sc.created_by
       WHERE sc.issue_description IS NULL
          OR TRIM(sc.issue_description) = ''
       ORDER BY sc.id`
    )
    .all();

  const total = db.prepare("SELECT COUNT(*) AS n FROM service_calls").get().n;

  console.log(`\n  DB: ${resolved}`);
  console.log(`  Total service calls: ${total}`);
  console.log(`  Service calls with blank/NULL issue_description: ${rows.length}\n`);

  if (rows.length > 0) {
    console.table(rows);
  } else {
    console.log("  No affected calls found — nothing has a blank description.\n");
  }
} finally {
  db.close();
}
