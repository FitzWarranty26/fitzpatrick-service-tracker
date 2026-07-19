// Read-only foreign-key orphan audit (server C4).
//
// SQLite disables FK enforcement per-connection by default, so the schema's
// `ON DELETE CASCADE` clauses are dead and nothing prevents orphaned child
// rows. Before we turn enforcement on (`PRAGMA foreign_keys = ON`) we must know
// the current data is clean: enabling enforcement against a DB that already
// contains orphans would make subsequent writes to the affected parents start
// failing at runtime.
//
// This module is the "audit before enforcement" gate. It NEVER writes — it only
// counts child rows whose non-NULL FK value points at a parent that no longer
// exists. It is used in three places:
//   1. server/storage.ts at startup (decides whether to enable FKs — fail-open),
//   2. server/orphan-audit.test.ts (proves clean → 0, orphan → detected),
//   3. scripts/audit-orphans.mjs (standalone run against a backup copy).
//
// The relationship list below is kept in sync with the standalone script
// scripts/audit-orphans.mjs (which re-declares it so it can run with zero build
// step in the Render Shell).

import type Database from "better-sqlite3";

export interface OrphanCheck {
  /** Table that holds the foreign key. */
  childTable: string;
  /** Foreign-key column on the child table. */
  childColumn: string;
  /** Referenced parent table. */
  parentTable: string;
  /** Referenced parent column (always the PK here). */
  parentColumn: string;
}

export interface OrphanResult extends OrphanCheck {
  orphanCount: number;
}

// Every parent→child relationship in the schema. Includes both the DDL-declared
// FKs (visits, appointments, products) and the logical-but-undeclared ones
// (photos, parts_used, activity_log, invoices, invoice_items) so the audit
// reports the full integrity picture, not just what SQLite would enforce.
export const ORPHAN_CHECKS: OrphanCheck[] = [
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

type Db = Database.Database;

function tableExists(db: Db, name: string): boolean {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

function columnExists(db: Db, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/**
 * Count orphaned child rows for every known FK relationship. Read-only.
 * A row is an orphan when its FK column is NON-NULL and no parent row has a
 * matching id. NULL FK values are legitimately unlinked and never counted.
 * Relationships whose table/column don't exist (older/newer schema) are skipped.
 */
export function auditOrphans(db: Db): OrphanResult[] {
  const results: OrphanResult[] = [];
  for (const check of ORPHAN_CHECKS) {
    if (!tableExists(db, check.childTable) || !tableExists(db, check.parentTable)) continue;
    if (!columnExists(db, check.childTable, check.childColumn)) continue;
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${check.childTable} c
         WHERE c.${check.childColumn} IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM ${check.parentTable} p
             WHERE p.${check.parentColumn} = c.${check.childColumn}
           )`
      )
      .get() as { n: number };
    results.push({ ...check, orphanCount: row.n });
  }
  return results;
}

/** True when no relationship has any orphaned rows. */
export function hasOrphans(results: OrphanResult[]): boolean {
  return results.some((r) => r.orphanCount > 0);
}

/** One-line-per-offender summary of only the relationships that have orphans. */
export function formatOrphanReport(results: OrphanResult[]): string {
  return results
    .filter((r) => r.orphanCount > 0)
    .map((r) => `${r.childTable}.${r.childColumn} → ${r.parentTable}.${r.parentColumn}: ${r.orphanCount} orphan(s)`)
    .join("; ");
}
