// Shared date/time helpers — used by both server and client to compute "today"
// and other relative dates in the business's configured timezone, NOT the
// server's UTC clock or the user's browser-local clock.
//
// Why this matters: storing dates as plain ISO date strings ("2026-05-07")
// works fine, but `new Date().toISOString().split("T")[0]` returns the UTC
// date. After 6pm Mountain Time that's already tomorrow in UTC, so the
// dashboard's "Today's Schedule" silently rolls over before midnight local.
//
// The business timezone is read from APP_TIMEZONE env var on the server
// (default America/Denver — Fitzpatrick is in Utah), and from the bundled
// constant on the client (build-time). For now both default to the same
// zone; making it per-account is a future change when we go multi-tenant.

export const APP_TIMEZONE: string =
  // Server: real env var
  (typeof process !== "undefined" && process.env && process.env.APP_TIMEZONE)
    ? process.env.APP_TIMEZONE
    // Client/fallback: hardcoded default for Fitzpatrick HQ
    : "America/Denver";

/**
 * Today's date as YYYY-MM-DD in the business timezone (NOT UTC).
 * Use this anywhere you previously wrote
 *   new Date().toISOString().split("T")[0]
 */
export function todayLocalISO(timezone: string = APP_TIMEZONE): string {
  // Intl.DateTimeFormat in en-CA returns YYYY-MM-DD — perfect for our text
  // date columns. Robust against DST and works the same on server + client.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

/**
 * Convert a Date object to YYYY-MM-DD in the business timezone.
 */
export function localDateISO(d: Date, timezone: string = APP_TIMEZONE): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/**
 * Add a number of days to today (in business TZ) and return the YYYY-MM-DD
 * representation. Negative numbers reach into the past.
 */
export function shiftDays(days: number, timezone: string = APP_TIMEZONE): string {
  const today = todayLocalISO(timezone);
  // Parse the local date as a local Date (NOT UTC). The +T12:00:00 stub
  // avoids timezone fence-post bugs around DST.
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().split("T")[0];
}

/**
 * Difference in whole days between two YYYY-MM-DD strings (b - a).
 * Avoids hour/DST issues by anchoring both at noon UTC.
 */
export function daysBetweenISO(a: string, b: string): number {
  if (!a || !b) return 0;
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aMs = Date.UTC(ay, am - 1, ad, 12, 0, 0);
  const bMs = Date.UTC(by, bm - 1, bd, 12, 0, 0);
  return Math.round((bMs - aMs) / (24 * 60 * 60 * 1000));
}

/**
 * Current month as YYYY-MM in the business timezone — used by month-to-date
 * filters on the dashboard / analytics.
 */
export function currentMonthISO(timezone: string = APP_TIMEZONE): string {
  return todayLocalISO(timezone).slice(0, 7);
}

// ─── Money helpers ──────────────────────────────────────────────────────────
//
// Money fields in this app are stored as TEXT strings (parts_cost, labor_cost,
// claim_amount, invoice.total, etc.) because SQLite doesn't have a DECIMAL type
// and we want to preserve whatever formatting the user typed. That means we
// need a robust parser for every place we want to do math on them.
//
// parseFloat("$1,200.00") returns NaN. parseFloat("1,200") returns 1 (stops at
// the comma). Both silently corrupt reports. Use parseMoney() instead.

/**
 * Parse a money-like string into a finite number. Strips $, commas, and
 * surrounding whitespace. Returns 0 for null/undefined/empty/non-numeric
 * input so callers can accumulate totals without adding NaN to their sums.
 */
export function parseMoney(value: string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const trimmed = String(value).trim();
  if (!trimmed) return 0;
  // Strip $, commas, stray whitespace; keep the minus sign and decimal point.
  const cleaned = trimmed.replace(/[$\s,]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format a number as dollars. Works for numbers OR money-like strings.
 * Examples: 1200 -> "$1,200.00", "1200" -> "$1,200.00", null -> "$0.00".
 */
export function formatMoney(value: string | number | null | undefined): string {
  const n = parseMoney(value);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Safe division guard for analytics ratios. Returns `fallback` when the
 * divisor is zero, NaN, or not finite. Prevents NaN%/Infinity% from leaking
 * onto dashboards.
 */
export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return fallback;
  }
  return numerator / denominator;
}
