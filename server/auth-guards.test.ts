// Tests for the role guards (server H4). The DELETE /api/service-calls/:id route
// now uses requireManager, so a non-manager must be rejected with 403.
import { test } from "node:test";
import assert from "node:assert/strict";
import { requireManager, requireEditor } from "./auth-guards.ts";

function mockRes() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function run(guard: (req: any, res: any, next: any) => unknown, role: string | undefined) {
  const res = mockRes();
  let nextCalled = false;
  guard({ user: role ? { role } : undefined }, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

test("requireManager: non-manager roles get 403 (the service-call delete gate)", () => {
  for (const role of ["tech", "staff", undefined]) {
    const { res, nextCalled } = run(requireManager, role);
    assert.equal(nextCalled, false, `role=${role} should be blocked`);
    assert.equal(res.statusCode, 403, `role=${role} should get 403`);
    assert.deepEqual(res.body, { error: "Manager access required" });
  }
});

test("requireManager: manager passes through", () => {
  const { res, nextCalled } = run(requireManager, "manager");
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 0);
});

test("requireEditor: staff blocked, manager and tech pass", () => {
  assert.equal(run(requireEditor, "staff").res.statusCode, 403);
  assert.equal(run(requireEditor, "manager").nextCalled, true);
  assert.equal(run(requireEditor, "tech").nextCalled, true);
});
