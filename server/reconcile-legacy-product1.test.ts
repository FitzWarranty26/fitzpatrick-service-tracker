// Tests for the gated one-time legacy → Product 1 reconcile script (Issue #64,
// A2 step 2). The script reuses the audit's divergence detection to build a plan,
// renders a full untruncated dry-run, archives every overwritten value before it
// writes, applies inside one transaction, and is idempotent.
//
// These tests build a throwaway SQLite DB with the minimal schema slice the
// script touches (service_calls legacy columns + service_call_products with
// created_at/updated_at), then prove: dry-run writes nothing, apply reconciles
// seeded diverged + missing-row fixtures, the archive captures overwritten
// values, a second apply is a no-op, and the dry-run output is untruncated.
// Pure functions + a temp-file DB only — no prod data.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computePlan,
  formatPlan,
  buildArchive,
  applyPlan,
} from "../scripts/reconcile-legacy-product1.mjs";
import { LEGACY_FIELDS } from "../scripts/audit-legacy-divergence.mjs";

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
      manufacturer TEXT NOT NULL DEFAULT 'Other', manufacturer_other TEXT, product_model TEXT,
      product_serial TEXT, product_type TEXT, installation_date TEXT,
      issue_description TEXT, diagnosis TEXT, resolution TEXT,
      claim_status TEXT, claim_number TEXT, claim_notes TEXT,
      parts_cost TEXT, labor_cost TEXT, other_cost TEXT, claim_amount TEXT,
      created_at TEXT, updated_at TEXT
    );
  `);
  return db;
}

function insertCall(db: Database.Database, id: number, fields: Record<string, unknown>) {
  const cols = ["id", "call_date", "updated_at", ...LEGACY_FIELDS];
  const vals = cols.map((c) => (c in fields ? fields[c] : c === "id" ? id : null));
  vals[0] = id;
  db.prepare(`INSERT INTO service_calls (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals);
}

function insertProduct(db: Database.Database, callId: number, fields: Record<string, unknown>) {
  const cols = ["service_call_id", "product_index", "voided", "created_at", "updated_at", ...LEGACY_FIELDS];
  const vals = cols.map((c) => {
    if (c === "service_call_id") return callId;
    if (c === "product_index") return fields.product_index ?? 1;
    if (c === "voided") return fields.voided ?? 0;
    return c in fields ? fields[c] : c === "manufacturer" ? "Other" : null;
  });
  db.prepare(`INSERT INTO service_call_products (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals);
}

function product1(db: Database.Database, callId: number) {
  return db
    .prepare(
      `SELECT * FROM service_call_products WHERE service_call_id = ? AND product_index = 1 AND voided = 0 ORDER BY id LIMIT 1`,
    )
    .get(callId) as any;
}

// A dataset mirroring production shape: one diverged (stale product1), one with
// NO product1 row (needs create), one already clean.
function seedMixed(db: Database.Database) {
  // #1 diverged — issue_description + diagnosis stale on product1.
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

  // #2 no product1 row at all — needs one created from legacy.
  insertCall(db, 2, {
    manufacturer: "Beta",
    diagnosis: "d0",
    resolution: "r0",
    claim_number: "CLM-9",
    updated_at: "2026-01-01T00:00:00Z",
  });

  // #3 clean — product1 already matches.
  insertCall(db, 3, { manufacturer: "Gamma", issue_description: "x", updated_at: "2026-01-01T00:00:00Z" });
  insertProduct(db, 3, { manufacturer: "Gamma", issue_description: "x", updated_at: "2026-01-01T00:00:00Z" });
}

test("computePlan: updates for diverged, creates for missing, clean ignored", () => {
  const db = freshDb();
  seedMixed(db);

  const plan = computePlan(db);
  assert.equal(plan.totalCalls, 3);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.isEmpty, false);

  assert.equal(plan.updates[0].callId, 1);
  const changed = plan.updates[0].fields.map((f: any) => f.field).sort();
  assert.deepEqual(changed, ["diagnosis", "issue_description"]);
  const issue = plan.updates[0].fields.find((f: any) => f.field === "issue_description");
  assert.equal(issue.oldProduct1, "ORIGINAL: unit leaking");
  assert.equal(issue.newLegacy, "EDITED: replaced under warranty");

  assert.equal(plan.creates[0].callId, 2);
  assert.equal(plan.creates[0].values.diagnosis, "d0");
  assert.equal(plan.creates[0].values.claim_number, "CLM-9");
  assert.equal(plan.creates[0].values.manufacturer, "Beta");
  db.close();
});

test("create plan defaults empty manufacturer to 'Other' (NOT NULL)", () => {
  const db = freshDb();
  insertCall(db, 1, { manufacturer: "", diagnosis: "d", updated_at: "2026-01-01T00:00:00Z" });
  const plan = computePlan(db);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].values.manufacturer, "Other");
  db.close();
});

test("dry-run (computePlan + formatPlan) writes NOTHING", () => {
  const db = freshDb();
  seedMixed(db);

  const before = db.prepare(`SELECT * FROM service_call_products ORDER BY id`).all();
  const plan = computePlan(db);
  formatPlan(plan); // pure render — no writes
  const after = db.prepare(`SELECT * FROM service_call_products ORDER BY id`).all();

  assert.deepEqual(after, before);
  // Still diverged because nothing was applied.
  assert.equal(computePlan(db).isEmpty, false);
  db.close();
});

test("formatPlan prints FULL untruncated before/after and all create fields", () => {
  const db = freshDb();
  const longText =
    "EDITED: " + "reconciliation-detail ".repeat(40) + "END"; // > 120 chars, would be truncated by the audit printer
  insertCall(db, 1, { manufacturer: "Acme", issue_description: longText, updated_at: "2026-02-01T00:00:00Z" });
  insertProduct(db, 1, { manufacturer: "Acme", issue_description: "old", updated_at: "2026-01-01T00:00:00Z" });

  const out = formatPlan(computePlan(db));
  assert.ok(longText.length > 120);
  assert.match(out, /BEFORE \(product1, overwritten\)/);
  assert.match(out, /AFTER  \(legacy, written in\)/);
  // Full text present verbatim (JSON-encoded), and NOT truncated with an ellipsis.
  assert.ok(out.includes(JSON.stringify(longText)), "full legacy text must appear untruncated");
  assert.ok(!out.includes("…"), "dry-run output must not truncate");
  db.close();
});

test("applyPlan reconciles diverged fields and creates missing rows", () => {
  const db = freshDb();
  seedMixed(db);

  const plan = computePlan(db);
  db.transaction(() => applyPlan(db, plan))();

  // #1 product1 now matches legacy.
  const p1 = product1(db, 1);
  assert.equal(p1.issue_description, "EDITED: replaced under warranty");
  assert.equal(p1.diagnosis, "EDITED: cracked heat exchanger");

  // #2 product1 row created with backfilled legacy values + correct metadata.
  const p2 = product1(db, 2);
  assert.ok(p2, "missing Product 1 row should be created");
  assert.equal(p2.product_index, 1);
  assert.equal(p2.voided, 0);
  assert.equal(p2.manufacturer, "Beta");
  assert.equal(p2.diagnosis, "d0");
  assert.equal(p2.resolution, "r0");
  assert.equal(p2.claim_number, "CLM-9");
  assert.ok(p2.created_at, "created_at set");
  assert.ok(p2.updated_at, "updated_at set");

  // Post-apply: zero divergence remains.
  assert.equal(computePlan(db).isEmpty, true);
  db.close();
});

test("buildArchive records every overwritten value plus the full plan", () => {
  const db = freshDb();
  seedMixed(db);

  const plan = computePlan(db);
  const archive = buildArchive(plan, "/var/data/warranty_tracker.db");

  assert.equal(archive.db, "/var/data/warranty_tracker.db");
  assert.ok(archive.timestamp, "timestamp present");
  assert.equal(archive.summary.updates, 1);
  assert.equal(archive.summary.creates, 1);
  // The overwritten (BEFORE) value is captured for recovery.
  const issue = archive.updates[0].fields.find((f: any) => f.field === "issue_description");
  assert.equal(issue.oldProduct1, "ORIGINAL: unit leaking");
  assert.equal(issue.newLegacy, "EDITED: replaced under warranty");
  assert.equal(archive.creates[0].callId, 2);
  db.close();
});

test("idempotent: a second apply is a no-op", () => {
  const db = freshDb();
  seedMixed(db);

  db.transaction(() => applyPlan(db, computePlan(db)))();
  const afterFirst = db.prepare(`SELECT * FROM service_call_products ORDER BY id`).all();

  // Second run: plan is empty, applying it changes nothing.
  const plan2 = computePlan(db);
  assert.equal(plan2.isEmpty, true);
  db.transaction(() => applyPlan(db, plan2))();
  const afterSecond = db.prepare(`SELECT * FROM service_call_products ORDER BY id`).all();

  assert.equal(afterSecond.length, afterFirst.length);
  // Exactly one product1 row per call — no duplicate creates.
  const rows2 = db.prepare(`SELECT COUNT(*) c FROM service_call_products WHERE service_call_id = 2`).get() as any;
  assert.equal(rows2.c, 1);
  db.close();
});

test("empty dataset: plan isEmpty, formatPlan says nothing to reconcile", () => {
  const db = freshDb();
  insertCall(db, 1, { manufacturer: "Acme", issue_description: "x", updated_at: "2026-01-01T00:00:00Z" });
  insertProduct(db, 1, { manufacturer: "Acme", issue_description: "x", updated_at: "2026-01-01T00:00:00Z" });

  const plan = computePlan(db);
  assert.equal(plan.isEmpty, true);
  assert.match(formatPlan(plan), /Nothing to reconcile/);
  db.close();
});

// End-to-end CLI smoke: run the real script against a temp-file DB, first as a
// readonly dry-run (must write nothing, no archive), then with --apply (must
// write an archive file next to the DB and reconcile).
test("CLI: dry-run writes nothing; --apply archives then reconciles", async () => {
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const scriptPath = fileURLToPath(new URL("../scripts/reconcile-legacy-product1.mjs", import.meta.url));

  const dir = mkdtempSync(join(tmpdir(), "fst-reconcile-cli-"));
  const dbPath = join(dir, "warranty_tracker.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE service_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, call_date TEXT,
      manufacturer TEXT, manufacturer_other TEXT, product_model TEXT,
      product_serial TEXT, product_type TEXT, installation_date TEXT,
      issue_description TEXT, diagnosis TEXT, resolution TEXT,
      claim_status TEXT, claim_number TEXT, claim_notes TEXT,
      parts_cost TEXT, labor_cost TEXT, other_cost TEXT, claim_amount TEXT,
      updated_at TEXT
    );
    CREATE TABLE service_call_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, service_call_id INTEGER NOT NULL,
      product_index INTEGER NOT NULL DEFAULT 1, voided INTEGER NOT NULL DEFAULT 0,
      manufacturer TEXT NOT NULL DEFAULT 'Other', manufacturer_other TEXT, product_model TEXT,
      product_serial TEXT, product_type TEXT, installation_date TEXT,
      issue_description TEXT, diagnosis TEXT, resolution TEXT,
      claim_status TEXT, claim_number TEXT, claim_notes TEXT,
      parts_cost TEXT, labor_cost TEXT, other_cost TEXT, claim_amount TEXT,
      created_at TEXT, updated_at TEXT
    );
  `);
  insertCall(db, 1, {
    manufacturer: "Acme",
    issue_description: "EDITED: replaced under warranty",
    updated_at: "2026-02-01T00:00:00Z",
  });
  insertProduct(db, 1, { manufacturer: "Acme", issue_description: "stale", updated_at: "2026-01-01T00:00:00Z" });
  db.close();

  // Dry-run.
  const dryOut = execFileSync("node", [scriptPath, dbPath], { encoding: "utf8" });
  assert.match(dryOut, /DRY-RUN — no changes made\. Run with --apply to write\./);
  assert.equal(readdirSync(dir).some((f) => f.startsWith("reconcile-archive-")), false, "dry-run writes no archive");
  const check = new Database(dbPath, { readonly: true });
  assert.equal(product1(check, 1).issue_description, "stale", "dry-run must not modify the DB");
  check.close();

  // Apply.
  const applyOut = execFileSync("node", [scriptPath, "--apply", dbPath], { encoding: "utf8" });
  assert.match(applyOut, /Post-apply verification: 0 diverged/);
  const archives = readdirSync(dir).filter((f) => f.startsWith("reconcile-archive-") && f.endsWith(".json"));
  assert.equal(archives.length, 1, "exactly one archive written");
  const archive = JSON.parse(readFileSync(join(dir, archives[0]), "utf8"));
  assert.equal(archive.summary.updates, 1);

  const after = new Database(dbPath, { readonly: true });
  assert.equal(product1(after, 1).issue_description, "EDITED: replaced under warranty");
  after.close();

  // Second --apply is a no-op (already in sync, no new archive).
  const againOut = execFileSync("node", [scriptPath, "--apply", dbPath], { encoding: "utf8" });
  assert.match(againOut, /Nothing to reconcile/);
  assert.equal(
    readdirSync(dir).filter((f) => f.startsWith("reconcile-archive-")).length,
    1,
    "no second archive on no-op apply",
  );
});
