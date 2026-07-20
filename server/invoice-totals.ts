// Server-side invoice total computation (client C1 / S9).
//
// The web client computes line amounts and invoice totals before it POSTs/PATCHes,
// but those numbers must not be trusted: a stale client, a replayed request, or a
// hand-crafted payload could send a `total` that doesn't match its line items. So
// the server recomputes everything from the persisted line items and ignores any
// client-supplied `amount`/`subtotal`/`total`.
//
// The math MUST match the client to the cent (client/src/pages/NewInvoice.tsx and
// InvoiceDetail.tsx), otherwise a saved invoice would render with a total that
// differs from what the user saw:
//   - line amount = (parseMoney(quantity) * parseMoney(unitPrice)).toFixed(2)
//   - subtotal    = sum of parseMoney(line.amount) over the rounded amounts, then
//                   .toFixed(2)  ← note: each line is rounded FIRST, then summed
//   - total       = subtotal     ← the app currently has no tax line
//
// Money columns are TEXT, so all outputs are strings.

import { parseMoney } from "@shared/datetime";

export interface ComputableLine {
  quantity?: string | number | null;
  unitPrice?: string | number | null;
  [key: string]: any;
}

// One line's amount = quantity × unit price, rounded to the cent — exactly the
// client's calcAmount().
export function computeLineAmount(
  quantity: string | number | null | undefined,
  unitPrice: string | number | null | undefined,
): string {
  return (parseMoney(quantity) * parseMoney(unitPrice)).toFixed(2);
}

export interface ComputedTotals<T extends ComputableLine> {
  items: (T & { amount: string })[];
  subtotal: string;
  total: string;
}

// Recompute every line amount and the invoice subtotal/total from the given
// lines. The returned `items` carry the server-computed `amount` so the caller
// can persist them; `subtotal`/`total` overwrite whatever the client sent.
export function computeInvoiceTotals<T extends ComputableLine>(
  items: T[] | undefined | null,
): ComputedTotals<T> {
  const lines = (items ?? []).map((item) => ({
    ...item,
    amount: computeLineAmount(item.quantity, item.unitPrice),
  }));
  // Sum the already-rounded line amounts, mirroring the client which reduces
  // over parseMoney(item.amount) after each amount was toFixed(2)'d.
  const subtotal = lines.reduce((sum, line) => sum + parseMoney(line.amount), 0);
  const subtotalStr = subtotal.toFixed(2);
  return { items: lines, subtotal: subtotalStr, total: subtotalStr };
}
