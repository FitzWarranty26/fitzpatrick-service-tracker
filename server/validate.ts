// Zod request-body validation middleware (server H1).
//
// Several mutating routes (users, invoices, visits, scheduled-appointments)
// historically read raw `req.body`, so type confusion / missing required
// fields / corrupt money strings could reach the SQL builders. This middleware
// runs the body through a zod schema BEFORE the handler:
//   - valid   → `req.body` is REPLACED with the parsed/typed output and next()
//   - invalid → 400 with a field-level error list, handler never runs
//
// Unknown keys are STRIPPED, not rejected (zod's default `.parse` behavior on
// object schemas). The web client sends harmless extras — e.g. Team.tsx posts
// `confirmPassword`, InvoiceDetail spreads the whole fetched invoice — so we
// must not use `.strict()` or those payloads would start 400-ing. The offline
// sync replay path only hits /api/service-calls, /photos and /parts (already
// validated elsewhere), so it is unaffected by the schemas wired up here.

import { z } from "zod";

export interface FieldError {
  field: string;
  message: string;
}

export function formatZodError(err: z.ZodError): FieldError[] {
  return err.errors.map((e) => ({
    field: e.path.length ? e.path.join(".") : "(body)",
    message: e.message,
  }));
}

// Build a single human-readable string from the field errors, e.g.
// "password: Password must be at least 8 characters; role: Invalid enum value".
export function fieldErrorMessage(errors: FieldError[]): string {
  return errors.map((e) => `${e.field}: ${e.message}`).join("; ");
}

export function validate(schema: z.ZodTypeAny) {
  return (req: any, res: any, next: any) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = formatZodError(result.error);
      return res.status(400).json({
        error: fieldErrorMessage(details),
        details,
      });
    }
    // Replace the body with the clean, typed output so handlers get parsed data
    // (unknown keys stripped, defaults applied, coercions done).
    req.body = result.data;
    return next();
  };
}
