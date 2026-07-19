// Tests for the shared-store session + login rate-limit persistence (server C2).
//
// These prove the two behaviors the in-memory Maps could not guarantee:
//   1. Session CRUD + expiry pruning.
//   2. Login lockout counters SURVIVE A RESTART — modeled by opening a second
//      store instance on the SAME on-disk DB file (a new better-sqlite3 handle,
//      exactly what a redeploy/restart does). No real/production data touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteSessionStore, SqliteLoginRateLimitStore } from "./session-store.ts";

function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fst-sess-")), "test.db");
}

const HOUR = 60 * 60 * 1000;

// ─── Session store ──────────────────────────────────────────────────────────

test("session CRUD: create → get returns the record; destroy removes it", () => {
  const db = new Database(":memory:");
  const store = new SqliteSessionStore(db);

  const rec = store.create({ token: "tok-a", userId: 7, username: "kevin", role: "manager", ip: "1.2.3.4", ttlMs: HOUR });
  assert.equal(rec.token, "tok-a");
  assert.ok(rec.expiresAt > rec.createdAt);

  const got = store.get("tok-a");
  assert.equal(got?.userId, 7);
  assert.equal(got?.username, "kevin");
  assert.equal(got?.role, "manager");

  store.destroy("tok-a");
  assert.equal(store.get("tok-a"), null);
  db.close();
});

test("session expiry: an expired session is not returned and is pruned", () => {
  const db = new Database(":memory:");
  const store = new SqliteSessionStore(db);

  store.create({ token: "live", userId: 1, username: "a", role: "tech", ip: "x", ttlMs: HOUR });
  store.create({ token: "dead", userId: 2, username: "b", role: "tech", ip: "x", ttlMs: -1000 }); // already expired

  // get() lazily rejects + deletes the expired row.
  assert.equal(store.get("dead"), null);
  assert.ok(store.get("live"));

  // pruneExpired removes only expired rows.
  store.create({ token: "dead2", userId: 3, username: "c", role: "tech", ip: "x", ttlMs: -1000 });
  const removed = store.pruneExpired();
  assert.equal(removed, 1); // only dead2 (dead already lazily removed)
  assert.equal(store.count(), 1); // just "live"
  db.close();
});

test("destroyByUser invalidates every session for a user (deactivate/delete)", () => {
  const db = new Database(":memory:");
  const store = new SqliteSessionStore(db);
  store.create({ token: "t1", userId: 42, username: "u", role: "tech", ip: "x", ttlMs: HOUR });
  store.create({ token: "t2", userId: 42, username: "u", role: "tech", ip: "y", ttlMs: HOUR });
  store.create({ token: "t3", userId: 99, username: "other", role: "tech", ip: "z", ttlMs: HOUR });

  const removed = store.destroyByUser(42);
  assert.equal(removed, 2);
  assert.equal(store.get("t1"), null);
  assert.equal(store.get("t2"), null);
  assert.ok(store.get("t3")); // other user untouched
  db.close();
});

test("session persists across a simulated restart (new handle, same DB file)", () => {
  const dbPath = tmpDbPath();
  const db1 = new Database(dbPath);
  const store1 = new SqliteSessionStore(db1);
  store1.create({ token: "persist", userId: 5, username: "kev", role: "manager", ip: "1.1.1.1", ttlMs: HOUR });
  db1.close();

  // Restart: brand-new connection + store on the same file. In-memory Maps
  // would have lost this; the SQLite-backed store keeps it.
  const db2 = new Database(dbPath);
  const store2 = new SqliteSessionStore(db2);
  const got = store2.get("persist");
  assert.equal(got?.userId, 5);
  assert.equal(got?.role, "manager");
  db2.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

// ─── Login rate-limit store ───────────────────────────────────────────────

test("login lockout: blocks at the threshold, clears on success", () => {
  const db = new Database(":memory:");
  const store = new SqliteLoginRateLimitStore(db);
  const ip = "9.9.9.9";
  const MAX = 5;

  for (let i = 0; i < 4; i++) store.recordFailure(ip, 15 * 60 * 1000);
  assert.equal(store.isLimited(ip, MAX), false); // 4 < 5

  store.recordFailure(ip, 15 * 60 * 1000); // 5th
  assert.equal(store.isLimited(ip, MAX), true);

  store.clear(ip); // successful login clears the counter
  assert.equal(store.isLimited(ip, MAX), false);
  db.close();
});

test("login lockout SURVIVES A RESTART (new handle, same DB file)", () => {
  const dbPath = tmpDbPath();
  const db1 = new Database(dbPath);
  const store1 = new SqliteLoginRateLimitStore(db1);
  const ip = "5.5.5.5";
  for (let i = 0; i < 5; i++) store1.recordFailure(ip, 15 * 60 * 1000);
  assert.equal(store1.isLimited(ip, 5), true);
  db1.close();

  // Redeploy/restart: a fresh connection must still see the lockout.
  const db2 = new Database(dbPath);
  const store2 = new SqliteLoginRateLimitStore(db2);
  assert.equal(store2.isLimited(ip, 5), true);
  db2.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

test("login lockout window expires and prunes", () => {
  const db = new Database(":memory:");
  const store = new SqliteLoginRateLimitStore(db);
  const ip = "2.2.2.2";
  const past = Date.now() - 60 * 1000;
  // Record a failure whose reset_at is already in the past by using a negative
  // lockout window relative to an explicit "now".
  store.recordFailure(ip, -1000, past);
  // isLimited at the real now: window has passed → not limited, row cleared.
  assert.equal(store.isLimited(ip, 5), false);
  assert.equal(store.pruneExpired(), 0); // already cleared by isLimited
  db.close();
});
