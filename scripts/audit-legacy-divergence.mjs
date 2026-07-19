#!/usr/bin/env node
/**
 * READ-ONLY legacy → product1 divergence report (Issue #64 prep).
 *
 * service_calls carries 16 "legacy" columns that are duplicated on
 * service_call_products (product_index = 1). The detail-page edit path
 * (PATCH /api/service-calls/:id) updates ONLY service_calls, so the Product 1
 * row can drift out of date. Before any legacy → product1 reconciliation is
 * run, use this script to see EXACTLY what such a reconciliation would change.
 *
 * It compares each of the 16 fields per call and prints, for every diverged
 * call, the legacy value (which a reconcile would KEEP/COPY) versus the stale
 * product1 value (which a reconcile would OVERWRITE). It also flags the edge
 * case where product1 was blanked more recently than the call was edited
 * (a possible deliberate clear a reconcile would undo), and lists calls with no
 * Product 1 row at all.
 *
 * SAFETY: opens the database in { readonly: true } mode — it cannot write,
 * update, or delete anything, so no backup is required. It NEVER prints
 * customer names or addresses — only call id, call date, and the 16
 * equipment/claim fields being compared.
 *
 * Usage (from the Render Shell, in the service's working directory):
 *   node scripts/audit-legacy-divergence.mjs                 # uses DB_PATH
 *   node scripts/audit-legacy-divergence.mjs /path/to/copy.db
 *
 * The DB path is the first CLI arg if given, else DB_PATH
 * (production: /var/data/warranty_tracker.db).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// The 16 legacy columns. Same snake_case name on service_calls and on
// service_call_products, so one list drives both sides of the comparison.
export const LEGACY_FIELDS = [
  "manufacturer",
  "manufacturer_other",
  "product_model",
  "product_serial",
  "product_type",
  "installation_date",
  "issue_description",
  "diagnosis",
  "resolution",
  "claim_status",
  "claim_number",
  "claim_notes",
  "parts_cost",
  "labor_cost",
  "other_cost",
  "claim_amount",
];

// Normalize for comparison: NULL and "" and whitespace-only are all "empty".
export function norm(v) {
  return v == null ? "" : String(v).trim();
}

// Collapse newlines and cap length so the report stays one line per field and
// never dumps a huge blob.
export function truncate(v, max = 120) {
  const s = (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * Compare service_calls legacy columns against their product_index = 1 (voided
 * = 0) counterpart. Pure: takes an open better-sqlite3 handle, returns a plain
 * report object. No I/O, no writes.
 */
export function auditLegacyDivergence(db) {
  const calls = db.prepare(`SELECT * FROM service_calls`).all();

  // First non-voided Product 1 row per call (the reconcile target).
  const p1ByCall = new Map();
  for (const p of db
    .prepare(`SELECT * FROM service_call_products WHERE product_index = 1 AND voided = 0 ORDER BY id`)
    .all()) {
    if (!p1ByCall.has(p.service_call_id)) p1ByCall.set(p.service_call_id, p);
  }

  const diverged = [];
  const noProductIds = [];
  const fieldCounts = {};
  let reviewCount = 0;
  let scanned = 0;

  for (const call of calls) {
    const p1 = p1ByCall.get(call.id);
    if (!p1) {
      noProductIds.push(call.id);
      continue;
    }
    scanned++;

    const fields = [];
    for (const f of LEGACY_FIELDS) {
      const legacy = norm(call[f]);
      const product1 = norm(p1[f]);
      if (legacy === product1) continue;

      // Edge case: product1 is empty while legacy is populated AND the product
      // row was updated more recently than the call row — the blank on product1
      // may be a deliberate clear that a legacy → product1 copy would undo.
      const review =
        product1 === "" &&
        legacy !== "" &&
        call.updated_at != null &&
        p1.updated_at != null &&
        p1.updated_at > call.updated_at;

      fields.push({ field: f, legacy: call[f], product1: p1[f], review });
      fieldCounts[f] = (fieldCounts[f] || 0) + 1;
      if (review) reviewCount++;
    }

    if (fields.length) diverged.push({ id: call.id, callDate: call.call_date, fields });
  }

  return {
    totalCalls: calls.length,
    scanned,
    diverged,
    noProduct: { count: noProductIds.length, ids: noProductIds },
    fieldCounts,
    reviewCount,
  };
}

/** Render the report object to a printable string. No customer PII. */
export function formatDivergenceReport(report) {
  const lines = [];
  const { scanned, diverged, noProduct, fieldCounts, reviewCount } = report;

  if (diverged.length === 0) {
    lines.push("  No divergence found — every Product 1 row matches its legacy columns.");
  } else {
    lines.push(`  Diverged calls (${diverged.length}):`);
    lines.push("  A reconcile would copy LEGACY → PRODUCT1 (overwriting the product1 value shown).");
    lines.push("");
    for (const call of diverged) {
      lines.push(`  ── Call #${call.id}  (call_date: ${call.callDate ?? "n/a"}) ──`);
      for (const fld of call.fields) {
        const tag = fld.review ? "  [REVIEW: possible deliberate clear]" : "";
        lines.push(`    ${fld.field}:${tag}`);
        lines.push(`      LEGACY   (would be kept/copied):  "${truncate(fld.legacy)}"`);
        lines.push(`      PRODUCT1 (would be overwritten):  "${truncate(fld.product1)}"`);
      }
      lines.push("");
    }
  }

  lines.push("  ── Summary ──");
  lines.push(`  Calls scanned (had a Product 1 row): ${scanned}`);
  lines.push(`  Calls diverged:                      ${diverged.length}`);
  lines.push(`  Review-flagged fields (possible deliberate clear): ${reviewCount}`);

  const fieldEntries = Object.entries(fieldCounts).sort((a, b) => b[1] - a[1]);
  if (fieldEntries.length) {
    lines.push("  Fields diverged (by field):");
    for (const [field, count] of fieldEntries) lines.push(`    ${field}: ${count}`);
  }

  lines.push("");
  lines.push(`  Calls with NO Product 1 row (a reconcile would need to create one): ${noProduct.count}`);
  if (noProduct.count) lines.push(`    call ids: ${noProduct.ids.join(", ")}`);

  return lines.join("\n");
}

// ── CLI entrypoint (skipped when this module is imported, e.g. by tests) ──────
function fail(msg) {
  console.error(`\n  ERROR: ${msg}\n`);
  process.exit(1);
}

function main() {
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
    Database = createRequire(import.meta.url)("better-sqlite3");
  } catch {
    fail("better-sqlite3 is not installed in this environment.");
  }

  // readonly: true guarantees this script cannot modify the database.
  const db = new Database(resolved, { readonly: true, fileMustExist: true });
  try {
    const report = auditLegacyDivergence(db);
    console.log(`\n  DB: ${resolved}`);
    console.log(`  Total service calls: ${report.totalCalls}\n`);
    console.log(formatDivergenceReport(report));
    console.log("\n  READ-ONLY — no changes were made.\n");
  } finally {
    db.close();
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
