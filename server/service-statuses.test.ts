// Enum/SQL reconciliation for service-call status (server M6).
//
// SERVICE_STATUSES (shared/schema.ts) is meant to be the single source of truth
// for a service call's status. The bug the code review flagged: 'Needs Return
// Visit' was written to the status column (via visit-status propagation) and
// filtered on in server SQL, but was absent from the enum — so it never showed
// in the status dropdowns. This test proves the enum now covers every status
// literal the server SQL filters on, so the two can't silently drift again.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICE_STATUSES } from "../shared/schema.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const enumSet = new Set<string>(SERVICE_STATUSES);

test("'Needs Return Visit' is in the enum (reconciled with SQL/data)", () => {
  assert.ok(enumSet.has("Needs Return Visit"));
});

test("SERVICE_STATUSES has no duplicates", () => {
  assert.equal(new Set(SERVICE_STATUSES).size, SERVICE_STATUSES.length);
});

// Scan the server source for service-call `status IN ('A', 'B', ...)` clauses
// and assert every quoted literal is a member of SERVICE_STATUSES. This is the
// reconciliation guard: if someone edits a service-call status filter with a
// value not in the enum (or vice versa), this fails. We only consider clauses
// that contain a sentinel service-call status ('Scheduled') so we don't pick up
// the unrelated invoice ('Sent'/'Overdue') or claim ('Submitted') status
// filters, which legitimately use different vocabularies.
test("every status literal in server service-call SQL IN-clauses exists in the enum", () => {
  const files = ["routes.ts", "storage.ts"].map((f) => path.join(here, f));
  const inClause = /status\s+IN\s*\(([^)]*)\)/gi;
  const literal = /'([^']+)'/g;
  const referenced = new Set<string>();

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = inClause.exec(src)) !== null) {
      const group = m[1];
      const lits: string[] = [];
      let lit: RegExpExecArray | null;
      while ((lit = literal.exec(group)) !== null) lits.push(lit[1]);
      // Only reconcile clauses that are clearly filtering service-call status.
      if (!lits.includes("Scheduled")) continue;
      for (const l of lits) referenced.add(l);
    }
  }

  // Sanity: the scan actually found the service-call status clauses.
  assert.ok(referenced.has("Needs Return Visit"), "scan should have found 'Needs Return Visit' in server SQL");
  assert.ok(referenced.size >= 3, "scan should have found several status literals");

  const missing = [...referenced].filter((s) => !enumSet.has(s));
  assert.deepEqual(missing, [], `status literals in server SQL missing from SERVICE_STATUSES: ${missing.join(", ")}`);
});
