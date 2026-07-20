// Tests for the S8 zod validation middleware (server H1) and the per-route
// schemas. Covers the three middleware guarantees from the sprint brief —
// valid passes through, invalid → 400 with a field-level message, unknown keys
// stripped — plus at least one case per hardened route group.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { validate, formatZodError } from "./validate.ts";
import {
  createUserSchema,
  updateUserSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  createVisitSchema,
  updateVisitSchema,
  rescheduleAppointmentSchema,
  editActiveAppointmentSchema,
} from "./validation-schemas.ts";

function mockRes() {
  return {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
}

function runValidate(schema: z.ZodTypeAny, body: any) {
  const req: any = { body };
  const res = mockRes();
  let nextCalled = false;
  validate(schema)(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
}

// ─── Middleware behavior ─────────────────────────────────────────────────────

test("validate: a valid body passes through and next() is called", () => {
  const { res, nextCalled } = runValidate(createUserSchema, {
    username: "jsmith",
    displayName: "J Smith",
    password: "supersecret",
    role: "tech",
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 0);
});

test("validate: an invalid body returns 400 with a field-level message and blocks the handler", () => {
  const { res, nextCalled } = runValidate(createUserSchema, {
    username: "jsmith",
    displayName: "J Smith",
    password: "short", // < 8 chars
    role: "tech",
  });
  assert.equal(nextCalled, false, "handler must not run on invalid input");
  assert.equal(res.statusCode, 400);
  assert.ok(Array.isArray(res.body.details), "details should be an array");
  const passwordErr = res.body.details.find((d: any) => d.field === "password");
  assert.ok(passwordErr, "there should be a password field error");
  assert.match(passwordErr.message, /at least 8 characters/);
  // The flattened message string names the field too.
  assert.match(res.body.error, /password/);
});

test("validate: unknown keys are stripped, not rejected", () => {
  // Team.tsx posts confirmPassword; it must be dropped, not cause a 400.
  const { req, res, nextCalled } = runValidate(createUserSchema, {
    username: "jsmith",
    displayName: "J Smith",
    password: "supersecret",
    role: "tech",
    confirmPassword: "supersecret",
    somethingElse: 123,
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 0);
  assert.equal(req.body.confirmPassword, undefined, "confirmPassword must be stripped");
  assert.equal(req.body.somethingElse, undefined, "unknown keys must be stripped");
  assert.equal(req.body.username, "jsmith");
});

test("formatZodError: maps issues to {field, message} and labels the whole-body case", () => {
  const err = z.object({ a: z.string() }).safeParse({ a: 1 });
  assert.equal(err.success, false);
  if (!err.success) {
    const out = formatZodError(err.error);
    assert.equal(out[0].field, "a");
    assert.ok(out[0].message.length > 0);
  }
});

// ─── Users ───────────────────────────────────────────────────────────────────

test("users: create rejects an unknown role", () => {
  const { res, nextCalled } = runValidate(createUserSchema, {
    username: "u",
    displayName: "U",
    password: "supersecret",
    role: "superadmin",
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
});

test("users: update accepts a numeric active toggle and a partial body", () => {
  const { req, res, nextCalled } = runValidate(updateUserSchema, { active: 0 });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 0);
  assert.equal(req.body.active, 0);
});

// ─── Invoices ────────────────────────────────────────────────────────────────

test("invoices: create keeps the items array and tolerates a missing invoiceNumber", () => {
  const { req, res, nextCalled } = runValidate(createInvoiceSchema, {
    billToName: "Acme HVAC",
    issueDate: "2026-07-19",
    subtotal: "100.00",
    total: "100.00",
    status: "Draft",
    items: [
      { type: "labor", description: "Diagnostic", quantity: "1", unitPrice: "100.00", amount: "100.00", visitNumber: null, id: 5, invoiceId: 9 },
    ],
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 0);
  assert.equal(req.body.invoiceNumber, undefined);
  assert.equal(req.body.items.length, 1);
  // id/invoiceId on the line item are unknown keys and get stripped.
  assert.equal(req.body.items[0].id, undefined);
  assert.equal(req.body.items[0].invoiceId, undefined);
  assert.equal(req.body.items[0].description, "Diagnostic");
});

test("invoices: create requires billToName and issueDate", () => {
  const { res, nextCalled } = runValidate(createInvoiceSchema, { subtotal: "0", total: "0" });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  const fields = res.body.details.map((d: any) => d.field);
  assert.ok(fields.includes("billToName"));
  assert.ok(fields.includes("issueDate"));
});

test("invoices: update accepts a status-only patch", () => {
  const { req, res, nextCalled } = runValidate(updateInvoiceSchema, { status: "Overdue" });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 0);
  assert.equal(req.body.status, "Overdue");
});

// ─── Visits ──────────────────────────────────────────────────────────────────

test("visits: create requires a visit date and accepts nullable optional fields", () => {
  const ok = runValidate(createVisitSchema, {
    visitDate: "2026-07-20",
    status: "Scheduled",
    technicianId: null,
    notes: null,
    hoursOnJob: null,
    milesTraveled: null,
  });
  assert.equal(ok.nextCalled, true);

  const bad = runValidate(createVisitSchema, { status: "Scheduled" });
  assert.equal(bad.nextCalled, false);
  assert.equal(bad.res.statusCode, 400);
});

test("visits: update is partial", () => {
  const { nextCalled, res } = runValidate(updateVisitSchema, { notes: "back next week" });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 0);
});

// ─── Scheduled appointments ──────────────────────────────────────────────────

test("appointments: reschedule requires scheduledDate", () => {
  const bad = runValidate(rescheduleAppointmentSchema, { reason: "parts arrived" });
  assert.equal(bad.nextCalled, false);
  assert.equal(bad.res.statusCode, 400);

  const ok = runValidate(rescheduleAppointmentSchema, {
    scheduledDate: "2026-07-25",
    scheduledTime: null,
    reason: "parts arrived",
  });
  assert.equal(ok.nextCalled, true);
});

test("appointments: active edit requires scheduledDate", () => {
  const ok = runValidate(editActiveAppointmentSchema, { scheduledDate: "2026-07-25", scheduledTime: "09:00" });
  assert.equal(ok.nextCalled, true);
  const bad = runValidate(editActiveAppointmentSchema, { scheduledTime: "09:00" });
  assert.equal(bad.res.statusCode, 400);
});
