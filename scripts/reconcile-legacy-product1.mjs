#!/usr/bin/env node
/**
 * One-time legacy → Product 1 reconciliation (Issue #64, A2 step 2).
 *
 * service_calls carries 16 legacy columns duplicated on service_call_products
 * (product_index = 1). Before A2 step 1 (write-through) shipped, the detail-page
 * edit path wrote only the legacy columns, so some Product 1 rows are stale and
 * a few calls have no Product 1 row at all. This script makes Product 1 match
 * the legacy columns for every existing call, so readers can later be repointed
 * to Product 1 without changing any output.
 *
 * MODES
 *   (no flags)  FULL DRY-RUN. Opens the DB readonly. Prints, per call, the
 *               COMPLETE untruncated before/after for every field it would
 *               change, the full field set for every Product 1 row it would
 *               create, and a summary. Writes nothing.
 *   --apply     Opens the DB writable. FIRST writes a timestamped JSON archive
 *               of every value about to be overwritten plus the full plan to
 *               <db-dir>/reconcile-archive-<ISO>.json (in production that is
 *               /var/data). Then applies all changes inside a single
 *               transaction, re-verifies 0 divergence, and prints the archive
 *               path. Idempotent: a second run is a no-op.
 *
 * It does NOT touch syncLegacyFromProduct or any reader. Comparison semantics
 * (the 16 fields, trim, NULL == '') are reused from audit-legacy-divergence.mjs.
 *
 * Usage (Render Shell, repo root):
 *   node scripts/reconcile-legacy-product1.mjs                 # dry-run, DB_PATH
 *   node scripts/reconcile-legacy-product1.mjs --apply         # write, DB_PATH
 *   node scripts/reconcile-legacy-product1.mjs /path/copy.db   # dry-run a copy
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { LEGACY_FIELDS, norm, auditLegacyDivergence } from "./audit-legacy-divergence.mjs";

function fail(msg) {
  console.error(`\n  ERROR: ${msg}\n`);
  process.exit(1);
}

/**
 * Build the reconciliation plan from an open better-sqlite3 handle. Pure /
 * read-only. Reuses the audit's divergence detection so the plan is exactly
 * what the audit reports.
 *   updates: existing Product 1 rows with >=1 diverged field (legacy → product1)
 *   creates: calls with no Product 1 row (a full row is backfilled from legacy)
 */
export function computePlan(db) {
  const report = auditLegacyDivergence(db);

  // Diverged existing Product 1 rows: copy each differing legacy value across.
  const updates = report.diverged.map((call) => ({
    callId: call.id,
    callDate: call.callDate,
    fields: call.fields.map((f) => ({
      field: f.field,
      oldProduct1: f.product1 ?? null, // value being overwritten
      newLegacy: f.legacy ?? null, // value being written in
    })),
  }));

  // Calls with no Product 1 row: build a full 16-field row from the legacy
  // columns (migration-33 backfill semantics).
  const creates = [];
  for (const callId of report.noProduct.ids) {
    const row = db.prepare(`SELECT * FROM service_calls WHERE id = ?`).get(callId);
    if (!row) continue;
    const values = {};
    for (const f of LEGACY_FIELDS) values[f] = row[f] ?? null;
    // manufacturer is NOT NULL on the product table.
    if (norm(values.manufacturer) === "") values.manufacturer = "Other";
    creates.push({ callId, callDate: row.call_date ?? null, values });
  }

  const fieldCounts = {};
  for (const u of updates) for (const f of u.fields) fieldCounts[f.field] = (fieldCounts[f.field] || 0) + 1;

  return {
    totalCalls: report.totalCalls,
    updates,
    creates,
    fieldCounts,
    isEmpty: updates.length === 0 && creates.length === 0,
  };
}

/** Full, UNTRUNCATED dry-run rendering of the plan. */
export function formatPlan(plan) {
  const lines = [];
  if (plan.isEmpty) {
    lines.push("  Nothing to reconcile — every Product 1 row already matches its legacy columns.");
  } else {
    if (plan.updates.length) {
      lines.push(`  Product 1 rows to UPDATE (legacy → product1): ${plan.updates.length}`);
      lines.push("");
      for (const u of plan.updates) {
        lines.push(`  ── Call #${u.callId}  (call_date: ${u.callDate ?? "n/a"}) ──`);
        for (const f of u.fields) {
          lines.push(`    ${f.field}:`);
          lines.push(`      BEFORE (product1, overwritten): ${JSON.stringify(f.oldProduct1)}`);
          lines.push(`      AFTER  (legacy, written in):    ${JSON.stringify(f.newLegacy)}`);
        }
        lines.push("");
      }
    }
    if (plan.creates.length) {
      lines.push(`  Product 1 rows to CREATE (no product row exists): ${plan.creates.length}`);
      lines.push("");
      for (const c of plan.creates) {
        lines.push(`  ── Call #${c.callId}  (call_date: ${c.callDate ?? "n/a"}) — new Product 1 ──`);
        for (const f of LEGACY_FIELDS) lines.push(`      ${f}: ${JSON.stringify(c.values[f])}`);
        lines.push("");
      }
    }
  }

  lines.push("  ── Summary ──");
  lines.push(`  Total service calls: ${plan.totalCalls}`);
  lines.push(`  Product 1 rows to update: ${plan.updates.length}`);
  lines.push(`  Product 1 rows to create: ${plan.creates.length}`);
  const fieldEntries = Object.entries(plan.fieldCounts).sort((a, b) => b[1] - a[1]);
  if (fieldEntries.length) {
    lines.push("  Fields to change (by field):");
    for (const [field, count] of fieldEntries) lines.push(`    ${field}: ${count}`);
  }
  return lines.join("\n");
}

/** Serializable archive: what will be overwritten + the full plan. */
export function buildArchive(plan, dbPath) {
  return {
    timestamp: new Date().toISOString(),
    db: dbPath,
    summary: {
      totalCalls: plan.totalCalls,
      updates: plan.updates.length,
      creates: plan.creates.length,
      fieldCounts: plan.fieldCounts,
    },
    // Every value about to be overwritten, plus the incoming value.
    updates: plan.updates,
    // Rows to be created (nothing overwritten, recorded for completeness).
    creates: plan.creates,
  };
}

/** Apply the plan. Caller MUST wrap this in a single db.transaction(). */
export function applyPlan(db, plan) {
  const now = new Date().toISOString();

  for (const u of plan.updates) {
    const cols = u.fields.map((f) => f.field);
    const setSql = [...cols.map((c) => `${c} = ?`), "updated_at = ?"].join(", ");
    const args = [...u.fields.map((f) => f.newLegacy), now, u.callId];
    db.prepare(
      `UPDATE service_call_products SET ${setSql} WHERE service_call_id = ? AND product_index = 1 AND voided = 0`,
    ).run(...args);
  }

  for (const c of plan.creates) {
    const cols = ["service_call_id", "product_index", "voided", "created_at", "updated_at", ...LEGACY_FIELDS];
    const placeholders = cols.map(() => "?").join(", ");
    const args = [c.callId, 1, 0, now, now, ...LEGACY_FIELDS.map((f) => c.values[f] ?? null)];
    db.prepare(`INSERT INTO service_call_products (${cols.join(", ")}) VALUES (${placeholders})`).run(...args);
  }
}

// ── CLI entrypoint (skipped when imported by tests) ───────────────────────────
function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dbArg = args.find((a) => !a.startsWith("--"));
  const DB_PATH = dbArg || process.env.DB_PATH || "warranty_tracker.db";
  const resolved = path.resolve(DB_PATH);

  if (!fs.existsSync(resolved)) {
    fail(
      `Database not found at ${resolved}.\n` +
        "  In production DB_PATH should be /var/data/warranty_tracker.db, or pass a\n" +
        "  path to a backup copy as the first argument.",
    );
  }

  let Database;
  try {
    Database = createRequire(import.meta.url)("better-sqlite3");
  } catch {
    fail("better-sqlite3 is not installed in this environment.");
  }

  // Dry-run opens readonly (cannot write); --apply opens writable.
  const db = new Database(resolved, { readonly: !apply, fileMustExist: true });
  try {
    const plan = computePlan(db);

    if (!apply) {
      console.log(`\n  DB: ${resolved}  (READONLY dry-run)\n`);
      console.log(formatPlan(plan));
      console.log('\n  DRY-RUN — no changes made. Run with --apply to write.\n');
      process.exit(0);
    }

    // --apply invariants.
    if (db.readonly) fail("--apply requires a writable database handle, but it is readonly.");

    if (plan.isEmpty) {
      console.log(`\n  DB: ${resolved}\n`);
      console.log("  Nothing to reconcile — already in sync. No archive written, no changes made.\n");
      process.exit(0);
    }

    // 1) Archive FIRST — fail hard if it cannot be written.
    const stamp = new Date().toISOString().replace(/[:]/g, "-");
    const archivePath = path.join(path.dirname(resolved), `reconcile-archive-${stamp}.json`);
    try {
      fs.writeFileSync(archivePath, JSON.stringify(buildArchive(plan, resolved), null, 2), { flag: "wx" });
    } catch (e) {
      fail(`could not write archive to ${archivePath} (${e.message}). Aborting BEFORE any write.`);
    }

    // 2) Apply inside a single transaction.
    db.transaction(() => applyPlan(db, plan))();

    // 3) Verify 0 divergence remains.
    const post = computePlan(db);
    if (!post.isEmpty) {
      fail(
        `post-apply verification FAILED — ${post.updates.length} updates / ${post.creates.length} creates still diverged. ` +
          `Values were archived at ${archivePath}.`,
      );
    }

    console.log(`\n  DB: ${resolved}`);
    console.log(`  Applied: ${plan.updates.length} update(s), ${plan.creates.length} create(s).`);
    console.log(`  Archive of overwritten values + full plan: ${archivePath}`);
    console.log("  Post-apply verification: 0 diverged. ✅");
    console.log("\n  APPLIED — reconciliation complete.\n");
    process.exit(0);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
