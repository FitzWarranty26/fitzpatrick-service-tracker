// Shared-store persistence for sessions and login rate-limit counters
// (server C2 + client H1).
//
// Both the session store and the login rate-limit store were previously
// in-memory Maps in routes.ts, so every deploy/restart logged everyone out and
// the 5-attempt lockout reset. They now live in the SAME better-sqlite3 DB so
// they survive restarts and work across multiple instances.
//
// Everything is behind a small interface: when the Postgres migration (Issue #7)
// lands, only this file changes — the two SQLite classes become Postgres-backed
// classes with the same method signatures, and routes.ts is untouched.
//
// Table creation is additive/idempotent (CREATE TABLE IF NOT EXISTS), matching
// the existing startup-migration style in storage.ts.
import type { Database } from "better-sqlite3";

export interface SessionRecord {
  token: string;
  userId: number;
  username: string;
  role: string;
  ip: string;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
}

export interface SessionStore {
  create(record: Omit<SessionRecord, "createdAt" | "expiresAt"> & { ttlMs: number }): SessionRecord;
  get(token: string): SessionRecord | null;
  destroy(token: string): void;
  destroyByUser(userId: number): number;
  pruneExpired(now?: number): number;
  count(): number;
}

export interface LoginRateLimitStore {
  isLimited(ip: string, maxAttempts: number, now?: number): boolean;
  recordFailure(ip: string, lockoutMs: number, now?: number): void;
  clear(ip: string): void;
  pruneExpired(now?: number): number;
}

// ─── SQLite-backed session store ────────────────────────────────────────────
export class SqliteSessionStore implements SessionStore {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        ip TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);`);
  }

  create(record: Omit<SessionRecord, "createdAt" | "expiresAt"> & { ttlMs: number }): SessionRecord {
    const now = Date.now();
    const full: SessionRecord = {
      token: record.token,
      userId: record.userId,
      username: record.username,
      role: record.role,
      ip: record.ip,
      createdAt: now,
      expiresAt: now + record.ttlMs,
    };
    this.db
      .prepare(
        `INSERT INTO sessions (token, user_id, username, role, ip, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(full.token, full.userId, full.username, full.role, full.ip, full.createdAt, full.expiresAt);
    return full;
  }

  get(token: string): SessionRecord | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT token, user_id AS userId, username, role, ip, created_at AS createdAt, expires_at AS expiresAt
         FROM sessions WHERE token = ?`
      )
      .get(token) as SessionRecord | undefined;
    if (!row) return null;
    if (Date.now() > row.expiresAt) {
      this.destroy(token);
      return null;
    }
    return row;
  }

  destroy(token: string): void {
    if (!token) return;
    this.db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  }

  destroyByUser(userId: number): number {
    return this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId).changes;
  }

  pruneExpired(now: number = Date.now()): number {
    return this.db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(now).changes;
  }

  count(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM sessions`).get() as { c: number }).c;
  }
}

// ─── SQLite-backed login rate-limit store ───────────────────────────────────
// Preserves the existing behavior: N failures within the lockout window blocks
// further attempts from that IP until the window (reset_at) passes. A successful
// login clears the counter.
export class SqliteLoginRateLimitStore implements LoginRateLimitStore {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        ip TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      );
    `);
  }

  private row(ip: string): { count: number; reset_at: number } | undefined {
    return this.db.prepare(`SELECT count, reset_at FROM login_attempts WHERE ip = ?`).get(ip) as
      | { count: number; reset_at: number }
      | undefined;
  }

  isLimited(ip: string, maxAttempts: number, now: number = Date.now()): boolean {
    const record = this.row(ip);
    if (!record) return false;
    if (now > record.reset_at) {
      this.clear(ip);
      return false;
    }
    return record.count >= maxAttempts;
  }

  recordFailure(ip: string, lockoutMs: number, now: number = Date.now()): void {
    const record = this.row(ip);
    if (!record || now > record.reset_at) {
      this.db
        .prepare(
          `INSERT INTO login_attempts (ip, count, reset_at) VALUES (?, 1, ?)
           ON CONFLICT(ip) DO UPDATE SET count = 1, reset_at = excluded.reset_at`
        )
        .run(ip, now + lockoutMs);
    } else {
      this.db.prepare(`UPDATE login_attempts SET count = count + 1 WHERE ip = ?`).run(ip);
    }
  }

  clear(ip: string): void {
    this.db.prepare(`DELETE FROM login_attempts WHERE ip = ?`).run(ip);
  }

  pruneExpired(now: number = Date.now()): number {
    return this.db.prepare(`DELETE FROM login_attempts WHERE reset_at <= ?`).run(now).changes;
  }
}
