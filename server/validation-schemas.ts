// Per-route zod schemas for the raw-body routes hardened in S8 (server H1).
//
// Where a drizzle-zod insert schema already exists we derive from it (so the
// schema tracks the table columns); the scheduled_appointments and
// service_call_visits tables have no drizzle-zod insert schema (created via raw
// SQL migration / $inferInsert), so those are defined by hand to match exactly
// what the handlers consume.
//
// Design rules (see server/validate.ts for the why):
//   - PATCH/PUT schemas are `.partial()` so a status-only or single-field edit
//     validates.
//   - Fields the client legitimately omits (server-generated invoice number,
//     server-stamped createdBy) are optional here so we don't reject real
//     payloads.
//   - Nested arrays the handler still needs (`invoice.items`) are declared so
//     they survive the unknown-key strip.

import { z } from "zod";
import {
  insertUserSchema,
  insertInvoiceSchema,
  insertInvoiceItemSchema,
  USER_ROLES,
} from "@shared/schema";

// ─── Users ───────────────────────────────────────────────────────────────────

export const createUserSchema = insertUserSchema.extend({
  username: z.string().min(1, "Username is required"),
  displayName: z.string().min(1, "Display name is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(USER_ROLES),
});

export const updateUserSchema = insertUserSchema.partial().extend({
  // Only enforced when present — reset/edit may omit it.
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  role: z.enum(USER_ROLES).optional(),
  // The client sends 0/1 (toggleActive) and the handler normalizes truthy →
  // 1/0, so accept either a number or a boolean.
  active: z.union([z.boolean(), z.number()]).optional(),
});

// ─── Invoices ──────────────────────────────────────────────────────────────

// A line item as the client sends it. `invoiceId` is stamped by the handler
// from the URL, and `id` (present when editing a fetched invoice) is an unknown
// key that gets stripped. Money/quantity columns are TEXT, so they stay strings.
const invoiceItemInputSchema = insertInvoiceItemSchema.omit({ invoiceId: true });

export const createInvoiceSchema = insertInvoiceSchema.extend({
  // The route generates a number when the client doesn't supply one, so it is
  // optional here even though the column is NOT NULL.
  invoiceNumber: z.string().optional(),
  billToName: z.string().min(1, "Bill To Name is required"),
  issueDate: z.string().min(1, "Issue Date is required"),
  items: z.array(invoiceItemInputSchema).optional(),
});

export const updateInvoiceSchema = insertInvoiceSchema.partial().extend({
  items: z.array(invoiceItemInputSchema).optional(),
});

// ─── Service-call visits ─────────────────────────────────────────────────────
// service_call_visits has no drizzle-zod insert schema. visit_number and
// service_call_id are assigned server-side, so they are not accepted here.

export const createVisitSchema = z.object({
  visitDate: z.string().min(1, "Visit date is required"),
  status: z.string().optional(),
  technicianId: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  hoursOnJob: z.string().nullable().optional(),
  milesTraveled: z.string().nullable().optional(),
});

export const updateVisitSchema = createVisitSchema.partial();

// ─── Scheduled appointments ──────────────────────────────────────────────────
// scheduled_appointments is a raw-SQL table. The handlers require scheduledDate;
// `reason` is conditionally required (only on an actual reschedule) and that
// check stays in the handler.

export const rescheduleAppointmentSchema = z.object({
  scheduledDate: z.string().min(1, "scheduledDate is required"),
  scheduledTime: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});

export const editActiveAppointmentSchema = z.object({
  scheduledDate: z.string().min(1, "scheduledDate is required"),
  scheduledTime: z.string().nullable().optional(),
});
