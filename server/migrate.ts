// Versioned schema migrations (server H5).
//
// Replaces the ad-hoc "CREATE TABLE IF NOT EXISTS" + guarded ALTER blocks that
// used to live inline in storage.ts. Migrations are ordered *.sql files in the
// repo-root `migrations/` folder (see migrations/0000_baseline.sql). Applied
// migrations are recorded in a bookkeeping table so each runs exactly once.
//
// Baselining (the delicate part): production already has the full schema but no
// bookkeeping table, because it predates this system. Re-running the baseline
// there would try to CREATE TABLE over live data. So on first contact with such
// a DB we mark the baseline as applied WITHOUT executing it — the live schema is
// never touched. A fresh/empty DB, by contrast, executes the baseline to build
// the schema from scratch. Both paths are covered by migrate.test.ts.

import fs from "node:fs";
import path from "node:path";
import type DatabaseType from "better-sqlite3";

type DB = DatabaseType.Database;

// Bookkeeping table. Kept intentionally boring; the old startup-migration code
// never referenced any bookkeeping table, so if this deploy is rolled back the
// old code simply ignores this table (its ALTERs remain guarded by columnExists
// and its CREATEs by IF NOT EXISTS) — see the PR rollback note.
const BOOKKEEPING = "schema_migrations";

// The baseline migration's file stem. Only this migration gets the
// "existing schema => mark-applied-without-executing" treatment.
const BASELINE = "0000_baseline";

// A table that only exists once the app schema is present. Used to detect a
// pre-existing (e.g. production) database that predates the bookkeeping table.
const SENTINEL_TABLE = "service_calls";

function tableExists(db: DB, name: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
}

// Resolve the migrations folder. Explicit wins (tests + `opts.dir`); otherwise
// probe the usual runtime locations. On Render the start command runs from the
// repo root, so `<cwd>/migrations` is present; `dist/migrations` is a build-copy
// fallback (see script/build.ts) in case cwd ever differs.
function resolveMigrationsDir(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.MIGRATIONS_DIR,
    path.join(process.cwd(), "migrations"),
    path.join(process.cwd(), "dist", "migrations"),
  ].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `runMigrations: could not locate a migrations folder (looked in: ${candidates.join(", ")})`,
  );
}

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface RunMigrationsOptions {
  dir?: string;
  log?: (message: string) => void;
}

export interface MigrationResult {
  applied: string[];
  baselined: string[];
  skipped: string[];
}

export function runMigrations(db: DB, opts: RunMigrationsOptions = {}): MigrationResult {
  const log = opts.log ?? (() => {});
  const dir = resolveMigrationsDir(opts.dir);

  db.exec(
    `CREATE TABLE IF NOT EXISTS ${BOOKKEEPING} (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      baselined INTEGER NOT NULL DEFAULT 0
    )`,
  );

  const alreadyApplied = new Set<string>(
    db
      .prepare(`SELECT name FROM ${BOOKKEEPING}`)
      .all()
      .map((r: any) => r.name as string),
  );

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // A DB that has the app schema but no recorded migrations predates this
  // system — treat its already-present schema as the baseline.
  const preExistingSchema = tableExists(db, SENTINEL_TABLE);

  const result: MigrationResult = { applied: [], baselined: [], skipped: [] };
  const record = db.prepare(
    `INSERT INTO ${BOOKKEEPING} (name, applied_at, baselined) VALUES (?, ?, ?)`,
  );

  for (const file of files) {
    const name = file.replace(/\.sql$/, "");
    if (alreadyApplied.has(name)) {
      result.skipped.push(name);
      continue;
    }

    const isBaseline = name === BASELINE;
    const shouldBaseline =
      isBaseline && preExistingSchema && alreadyApplied.size === 0;

    if (shouldBaseline) {
      db.transaction(() => {
        record.run(name, new Date().toISOString(), 1);
      })();
      result.baselined.push(name);
      log(`migrate: baselined ${name} (existing schema detected — not executed)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const statements = splitStatements(sql);
    db.transaction(() => {
      for (const stmt of statements) db.exec(stmt);
      record.run(name, new Date().toISOString(), 0);
    })();
    result.applied.push(name);
    log(`migrate: applied ${name} (${statements.length} statements)`);
  }

  return result;
}
