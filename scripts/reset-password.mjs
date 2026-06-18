#!/usr/bin/env node
/**
 * Admin password recovery — manager lockout escape hatch.
 *
 * Resets a user's password directly in the production SQLite database when no
 * working manager account is available to do it from the in-app Team screen.
 * Intended to be run from the Render Shell on the live web service.
 *
 * Safety:
 *  - Makes a timestamped backup copy of the DB before writing.
 *  - Hashes with the same bcryptjs cost factor (12) the app uses.
 *  - Re-activates the account and sets must_change_password = 1 so the user is
 *    forced to set their own password at next login.
 *  - Writes an audit_log_system row so the reset is traceable.
 *
 * Usage (from the Render Shell, in the service's working directory):
 *   node scripts/reset-password.mjs <username> <newPassword>
 *
 * Example:
 *   node scripts/reset-password.mjs kevin 'a-temp-pass-8+'
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

const [, , username, newPassword] = process.argv;

if (!username || !newPassword) {
  fail(
    "Usage: node scripts/reset-password.mjs <username> <newPassword>\n" +
    "  Both arguments are required. Wrap the password in single quotes if it\n" +
    "  contains spaces or shell-special characters."
  );
}

if (newPassword.length < 8) {
  fail("New password must be at least 8 characters (matches the app's rule).");
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

// Lazy-require so a missing dependency gives a clear message.
let Database, bcrypt;
try {
  Database = require("better-sqlite3");
} catch {
  fail("better-sqlite3 is not installed in this environment.");
}
try {
  bcrypt = require("bcryptjs");
} catch {
  fail("bcryptjs is not installed in this environment.");
}

// 1) Safety backup.
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(path.dirname(resolved), `manual-backup-${ts}.db`);
fs.copyFileSync(resolved, backupPath);
console.log(`  Backup written: ${backupPath}`);

// 2) Reset.
const db = new Database(resolved);
try {
  const user = db
    .prepare("SELECT id, username, role FROM users WHERE LOWER(username) = LOWER(?)")
    .get(username);

  if (!user) {
    const all = db.prepare("SELECT username, role, active FROM users ORDER BY id").all();
    console.error(`\n  No user matched "${username}". Existing users:`);
    console.table(all);
    process.exit(1);
  }

  const hash = bcrypt.hashSync(newPassword, 12);
  const result = db
    .prepare(
      "UPDATE users SET password = ?, active = 1, must_change_password = 1 WHERE id = ?"
    )
    .run(hash, user.id);

  // Best-effort audit row (table/columns match server/storage.ts).
  try {
    db.prepare(
      "INSERT INTO audit_log_system (user_id, username, action, entity_type, entity_id, details, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      user.id,
      user.username,
      "password_reset_cli",
      "user",
      user.id,
      "Password reset via scripts/reset-password.mjs (admin recovery)",
      new Date().toISOString()
    );
  } catch (e) {
    console.warn(`  (Audit row skipped: ${e.message})`);
  }

  console.log(`\n  Rows updated: ${result.changes}`);
  console.log(`  User "${user.username}" (id ${user.id}, role ${user.role}) reset.`);
  console.log("  Account re-activated; user must change password at next login.\n");
} finally {
  db.close();
}
