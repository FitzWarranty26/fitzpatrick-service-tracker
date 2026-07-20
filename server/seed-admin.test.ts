// Tests for seeded-admin credential hardening (server C5).
//
// The old seed baked a well-known password ("fitzpatrick2026") into the app and
// logged it in plaintext. The fix: use an operator-supplied SEED_ADMIN_PASSWORD
// when present, otherwise a cryptographically-random one; never the old default.
// The admin is always flagged must_change_password.
//
// storage.ts seeds at module init, so we point DB_PATH at a throwaway temp DB
// and set SEED_ADMIN_PASSWORD BEFORE importing storage. Each test file runs in
// its own process under `node --test`, so the env/import here is isolated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";

process.env.NODE_ENV = "test";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "fst-seed-test-")), "test.db");
process.env.SEED_ADMIN_PASSWORD = "correct-horse-battery-staple";

const { sqlite } = await import("./storage.ts");

test("seed admin: uses SEED_ADMIN_PASSWORD, flags must_change_password, drops the old default", () => {
  const admin = sqlite
    .prepare(`SELECT username, password, role, active, must_change_password FROM users WHERE username = ?`)
    .get("admin") as {
    username: string;
    password: string;
    role: string;
    active: number;
    must_change_password: number;
  };

  assert.ok(admin, "admin user should be seeded on an empty DB");
  assert.equal(admin.role, "manager");
  assert.equal(admin.active, 1);
  assert.equal(admin.must_change_password, 1, "seeded admin must be forced to change password");

  // The stored hash matches the supplied env password...
  assert.equal(bcrypt.compareSync("correct-horse-battery-staple", admin.password), true);
  // ...and NOT the old hardcoded default.
  assert.equal(bcrypt.compareSync("fitzpatrick2026", admin.password), false);
  // Plaintext is never stored.
  assert.notEqual(admin.password, "correct-horse-battery-staple");
});
