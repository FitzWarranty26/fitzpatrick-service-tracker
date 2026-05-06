import { drizzle } from "drizzle-orm/better-sqlite3";
import { todayLocalISO, parseMoney } from "@shared/datetime";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  serviceCalls,
  photos,
  partsUsed,
  contacts,
  activityLog,
  users,
  auditLog,
  invoices,
  invoiceItems,
  type ServiceCall,
  type InsertServiceCall,
  type Photo,
  type InsertPhoto,
  type Part,
  type InsertPart,
  type Contact,
  type InsertContact,
  type ActivityLog,
  type InsertActivityLog,
  type User,
  type AuditLogEntry,
  type Invoice,
  type InsertInvoice,
  type InvoiceItem,
  type InsertInvoiceItem,
  type ServiceCallVisit,
  type InsertServiceCallVisit,
} from "@shared/schema";

// Use persistent disk path on Render if available, otherwise local
export const DB_PATH = process.env.DB_PATH || "warranty_tracker.db";
const sqlite = new Database(DB_PATH);
export const db = drizzle(sqlite);

// Export raw SQLite handle for backup API
export { sqlite };
if (process.env.NODE_ENV !== "production") {
  console.log(`Database: ${DB_PATH}`);
}

// Create tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS service_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_date TEXT NOT NULL,
    manufacturer TEXT NOT NULL,
    manufacturer_other TEXT,
    customer_name TEXT,
    job_site_name TEXT,
    job_site_address TEXT,
    job_site_city TEXT,
    job_site_state TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    site_contact_name TEXT,
    site_contact_phone TEXT,
    site_contact_email TEXT,
    product_model TEXT,
    product_serial TEXT,
    installation_date TEXT,
    issue_description TEXT,
    diagnosis TEXT,
    resolution TEXT,
    status TEXT NOT NULL DEFAULT 'Scheduled',
    claim_status TEXT NOT NULL DEFAULT 'Not Filed',
    claim_notes TEXT,
    tech_notes TEXT,
    latitude TEXT,
    longitude TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_call_id INTEGER NOT NULL,
    photo_url TEXT NOT NULL,
    caption TEXT,
    photo_type TEXT NOT NULL DEFAULT 'Other'
  );

  CREATE TABLE IF NOT EXISTS parts_used (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_call_id INTEGER NOT NULL,
    part_number TEXT NOT NULL,
    part_description TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    source TEXT
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_type TEXT NOT NULL,
    company_name TEXT,
    contact_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_call_id INTEGER NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'tech',
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,
    service_call_id INTEGER,
    bill_to_type TEXT NOT NULL DEFAULT 'contractor',
    bill_to_name TEXT NOT NULL,
    bill_to_address TEXT,
    bill_to_city TEXT,
    bill_to_state TEXT,
    bill_to_email TEXT,
    bill_to_phone TEXT,
    issue_date TEXT NOT NULL,
    due_date TEXT,
    payment_terms TEXT DEFAULT 'Net 30',
    status TEXT NOT NULL DEFAULT 'Draft',
    notes TEXT,
    subtotal TEXT NOT NULL DEFAULT '0',
    total TEXT NOT NULL DEFAULT '0',
    paid_date TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    description TEXT NOT NULL,
    quantity TEXT NOT NULL DEFAULT '1',
    unit_price TEXT NOT NULL DEFAULT '0',
    amount TEXT NOT NULL DEFAULT '0',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS audit_log_system (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    details TEXT,
    created_at TEXT NOT NULL
  );
`);

// ─── Indexes for query performance ──────────────────────────────────────────
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_photos_service_call_id ON photos(service_call_id);
  CREATE INDEX IF NOT EXISTS idx_parts_service_call_id ON parts_used(service_call_id);
  CREATE INDEX IF NOT EXISTS idx_service_calls_call_date ON service_calls(call_date);
  CREATE INDEX IF NOT EXISTS idx_service_calls_status ON service_calls(status);
  CREATE INDEX IF NOT EXISTS idx_activity_log_service_call_id ON activity_log(service_call_id);
  CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(contact_type);
`);

// ─── Migrations (safe to re-run) ─────────────────────────────────────────────
// Add new columns to existing tables without losing data.
// SQLite's ALTER TABLE ADD COLUMN is safe — it adds the column if missing.
// We check first to avoid errors on tables that already have the column.

// Allow only known table names to prevent SQL injection
const ALLOWED_TABLES = new Set(["service_calls", "photos", "parts_used", "contacts", "activity_log", "users", "audit_log_system", "service_call_visits", "invoice_items"]);

function columnExists(table: string, column: string): boolean {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`Unknown table: ${table}`);
  const info = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return info.some(col => col.name === column);
}

// Migration 1: Add contact_email to service_calls
if (!columnExists("service_calls", "contact_email")) {
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN contact_email TEXT`);
  console.log("Migration: added contact_email column to service_calls");
}

// Migration 2: Add site contact fields to service_calls
if (!columnExists("service_calls", "site_contact_name")) {
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN site_contact_name TEXT`);
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN site_contact_phone TEXT`);
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN site_contact_email TEXT`);
  console.log("Migration: added site contact columns to service_calls");
}

// Migration 3: Add latitude/longitude to service_calls
if (!columnExists("service_calls", "latitude")) {
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN latitude TEXT`);
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN longitude TEXT`);
  console.log("Migration: added latitude/longitude columns to service_calls");
}

// Migration 4: Add job logistics (hours, miles) and scheduling fields
if (!columnExists("service_calls", "hours_on_job")) {
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN hours_on_job TEXT`);
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN miles_traveled TEXT`);
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN scheduled_date TEXT`);
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN scheduled_time TEXT`);
  console.log("Migration: added hours_on_job, miles_traveled, scheduled_date, scheduled_time columns");
}

// Migration 5: Add parent_call_id for follow-up tracking
if (!columnExists("service_calls", "parent_call_id")) {
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN parent_call_id INTEGER`);
  console.log("Migration: added parent_call_id column to service_calls");
}

// Migration 6: Add product_type for warranty calculation
if (!columnExists("service_calls", "product_type")) {
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN product_type TEXT`);
  console.log("Migration: added product_type column to service_calls");
}

// Migration 7: Add claim financial fields
if (!columnExists("service_calls", "parts_cost")) {
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN parts_cost TEXT`);
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN labor_cost TEXT`);
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN other_cost TEXT`);
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN claim_amount TEXT`);
  console.log("Migration: added claim financial columns");
}

// Migration 8: Add sort_order to photos
if (!columnExists("photos", "sort_order")) {
  sqlite.exec(`ALTER TABLE photos ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
  sqlite.exec(`UPDATE photos SET sort_order = id WHERE sort_order = 0`);
  console.log("Migration: added sort_order column to photos");
}

// Migration 9: Add claim_number field
if (!columnExists("service_calls", "claim_number")) {
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN claim_number TEXT`);
  console.log("Migration: added claim_number column");
}

// Migration 10: Add follow_up_date field
if (!columnExists("service_calls", "follow_up_date")) {
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN follow_up_date TEXT`);
  console.log("Migration: added follow_up_date column");
}

// Migration 11: Add created_by / updated_by to service_calls
if (!columnExists("service_calls", "created_by")) {
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN created_by INTEGER`);
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN updated_by INTEGER`);
  console.log("Migration: added created_by/updated_by to service_calls");
}

// Migration 12: Add created_by to contacts
if (!columnExists("contacts", "created_by")) {
  sqlite.exec(`ALTER TABLE contacts ADD COLUMN created_by INTEGER`);
  console.log("Migration: added created_by to contacts");
}

// Migration 13: Add username to activity_log for attribution
if (!columnExists("activity_log", "username")) {
  sqlite.exec(`ALTER TABLE activity_log ADD COLUMN username TEXT`);
  console.log("Migration: added username to activity_log");
}

// Migration 14: Remove NOT NULL from optional fields in service_calls
// SQLite can't ALTER COLUMN, so we recreate the table.
// Handles partial failures from prior deploy attempts.
{
  const hasOriginal = (sqlite.prepare(`SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='service_calls'`).get() as any).c > 0;
  const hasNewTable = (sqlite.prepare(`SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='service_calls_new'`).get() as any).c > 0;

  if (!hasOriginal && hasNewTable) {
    // Prior attempt dropped service_calls but crashed before rename
    console.log("Migration 14: Recovering from partial prior run...");
    sqlite.exec(`ALTER TABLE service_calls_new RENAME TO service_calls`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_service_calls_call_date ON service_calls(call_date)`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_service_calls_status ON service_calls(status)`);
    console.log("Migration 14: Recovery complete");
  } else if (hasOriginal) {
    const m14cols = sqlite.prepare(`PRAGMA table_info(service_calls)`).all() as any[];
    const m14check = m14cols.find((c: any) => c.name === "customer_name");
    if (m14check && m14check.notnull === 1) {
      console.log("Migration 14: Removing NOT NULL constraints from optional service_calls columns...");
      sqlite.exec(`DROP TABLE IF EXISTS service_calls_new`);
      sqlite.exec(`
        CREATE TABLE service_calls_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          call_date TEXT NOT NULL,
          manufacturer TEXT NOT NULL,
          manufacturer_other TEXT,
          customer_name TEXT,
          job_site_name TEXT,
          job_site_address TEXT,
          job_site_city TEXT,
          job_site_state TEXT,
          contact_name TEXT,
          contact_phone TEXT,
          contact_email TEXT,
          site_contact_name TEXT,
          site_contact_phone TEXT,
          site_contact_email TEXT,
          product_model TEXT,
          product_serial TEXT,
          installation_date TEXT,
          issue_description TEXT,
          diagnosis TEXT,
          resolution TEXT,
          status TEXT NOT NULL DEFAULT 'Scheduled',
          claim_status TEXT NOT NULL DEFAULT 'Not Filed',
          claim_notes TEXT,
          tech_notes TEXT,
          latitude TEXT,
          longitude TEXT,
          created_at TEXT NOT NULL,
          hours_on_job TEXT,
          miles_traveled TEXT,
          scheduled_date TEXT,
          scheduled_time TEXT,
          parent_call_id INTEGER,
          product_type TEXT,
          parts_cost TEXT,
          labor_cost TEXT,
          other_cost TEXT,
          claim_amount TEXT,
          claim_number TEXT,
          follow_up_date TEXT,
          created_by INTEGER,
          updated_by INTEGER
        )
      `);
      // Use explicit column list from the OLD table to handle column differences
      const oldCols = m14cols.map((c: any) => c.name).join(", ");
      sqlite.exec(`INSERT INTO service_calls_new (${oldCols}) SELECT ${oldCols} FROM service_calls`);
      sqlite.exec(`DROP TABLE service_calls`);
      sqlite.exec(`ALTER TABLE service_calls_new RENAME TO service_calls`);
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_service_calls_call_date ON service_calls(call_date)`);
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_service_calls_status ON service_calls(status)`);
      console.log("Migration 14: Done");
    }
  }
}

// Indexes for new tables
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_audit_log_system_created_at ON audit_log_system(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_log_system_user_id ON audit_log_system(user_id);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
`);

// Migration 15: Create service_call_visits table for return visits
{
  const hasTable = (sqlite.prepare(`SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='service_call_visits'`).get() as any).c > 0;
  if (!hasTable) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS service_call_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_call_id INTEGER NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
      visit_number INTEGER NOT NULL,
      visit_date TEXT NOT NULL,
      technician_id INTEGER REFERENCES users(id),
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'Scheduled',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_service_call_visits_call_id ON service_call_visits(service_call_id)`);
    console.log("Migration 15: created service_call_visits table");
  }
}

// Migration 20: Add wholesaler fields to service_calls
if (!columnExists("service_calls", "wholesaler_name")) {
  sqlite.prepare(`ALTER TABLE service_calls ADD COLUMN wholesaler_name TEXT`).run();
  sqlite.prepare(`ALTER TABLE service_calls ADD COLUMN wholesaler_phone TEXT`).run();
  console.log("Migration 20: added wholesaler_name/wholesaler_phone to service_calls");
}

// Migration 21: Add job_site_zip to service_calls
if (!columnExists("service_calls", "job_site_zip")) {
  sqlite.prepare(`ALTER TABLE service_calls ADD COLUMN job_site_zip TEXT`).run();
  console.log("Migration 21: added job_site_zip to service_calls");
}

// Migration 18: Add unit_cost to parts_used
if (!columnExists("parts_used", "unit_cost")) {
  sqlite.prepare(`ALTER TABLE parts_used ADD COLUMN unit_cost TEXT`).run();
  console.log("Migration 18: added unit_cost to parts_used");
}

// Migration 16: Add hours_on_job, miles_traveled to service_call_visits; add visit_number to photos
{
  if (!columnExists("service_call_visits", "hours_on_job")) {
    sqlite.exec(`ALTER TABLE service_call_visits ADD COLUMN hours_on_job TEXT`);
    console.log("Migration 16: added hours_on_job to service_call_visits");
  }
  if (!columnExists("service_call_visits", "miles_traveled")) {
    sqlite.exec(`ALTER TABLE service_call_visits ADD COLUMN miles_traveled TEXT`);
    console.log("Migration 16: added miles_traveled to service_call_visits");
  }
  if (!columnExists("photos", "visit_number")) {
    sqlite.exec(`ALTER TABLE photos ADD COLUMN visit_number INTEGER NOT NULL DEFAULT 1`);
    console.log("Migration 16: added visit_number to photos");
  }
}

// Migration 17: Add visit_number to invoice_items for visit-grouped line items
if (!columnExists("invoice_items", "visit_number")) {
  sqlite.exec(`ALTER TABLE invoice_items ADD COLUMN visit_number INTEGER`);
  console.log("Migration 17: added visit_number to invoice_items");
}



// Migration 25: Add call_type to service_calls
if (!columnExists("service_calls", "call_type")) {
  sqlite.prepare(`ALTER TABLE service_calls ADD COLUMN call_type TEXT DEFAULT 'residential'`).run();
  console.log("Migration 25: added call_type to service_calls");
}

// Migration 24: Add contact_company to service_calls
if (!columnExists("service_calls", "contact_company")) {
  sqlite.prepare(`ALTER TABLE service_calls ADD COLUMN contact_company TEXT`).run();
  console.log("Migration 24: added contact_company to service_calls");
}

// Migration 22: Add is_test flag to service_calls
if (!columnExists("service_calls", "is_test")) {
  sqlite.prepare(`ALTER TABLE service_calls ADD COLUMN is_test INTEGER DEFAULT 0`).run();
  console.log("Migration 22: added is_test column to service_calls");
}

// Migration 26: Add service_method to service_calls (In-Person / Phone Call / Video Call)
if (!columnExists("service_calls", "service_method")) {
  sqlite.prepare(`ALTER TABLE service_calls ADD COLUMN service_method TEXT DEFAULT 'In-Person'`).run();
  console.log("Migration 26: added service_method column to service_calls");
}

// Migration 27: Add scheduled_appointments table for schedule history
const hasSchedAppts = (sqlite.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_appointments'`
).get() as any);
if (!hasSchedAppts) {
  sqlite.prepare(`
    CREATE TABLE scheduled_appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
      scheduled_date TEXT NOT NULL,
      scheduled_time TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      reason TEXT,
      created_by_id INTEGER REFERENCES users(id),
      created_by_name TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  sqlite.prepare(`CREATE INDEX IF NOT EXISTS idx_sched_appts_call ON scheduled_appointments(call_id)`).run();
  // Backfill from existing service_calls.scheduled_date
  const existing = sqlite.prepare(`
    SELECT id, scheduled_date, scheduled_time FROM service_calls
    WHERE scheduled_date IS NOT NULL AND scheduled_date != ''
  `).all() as any[];
  const insertAppt = sqlite.prepare(`
    INSERT INTO scheduled_appointments (call_id, scheduled_date, scheduled_time, status, reason, created_by_name, created_at)
    VALUES (?, ?, ?, 'active', NULL, 'System', CURRENT_TIMESTAMP)
  `);
  for (const c of existing) {
    insertAppt.run(c.id, c.scheduled_date, c.scheduled_time);
  }
  console.log(`Migration 27: created scheduled_appointments table, backfilled ${existing.length} active appointments`);
}

// Migration 28: Add updated_at to service_calls for optimistic concurrency
// control. Two editors (e.g. manager on desktop + tech on phone) could
// previously silently overwrite each other's changes. PATCH now accepts an
// If-Unmodified-Since header and rejects with 409 if the row has changed.
if (!columnExists("service_calls", "updated_at")) {
  sqlite.prepare(`ALTER TABLE service_calls ADD COLUMN updated_at TEXT`).run();
  // Backfill to created_at so existing rows have a baseline.
  sqlite.prepare(`UPDATE service_calls SET updated_at = created_at WHERE updated_at IS NULL`).run();
  console.log("Migration 28: added updated_at column to service_calls (backfilled from created_at)");
}

// Migration 30: Add completed_date to service_calls. Dashboard "completed
// this month" and First-Time Fix Rate previously filtered by call_date, which
// is when the call was logged — a call logged in March but finished in May
// wouldn't count as completed in May at all. We now track when the row
// transitioned to Completed. Backfill: rows currently Completed get their
// updated_at (or created_at) so existing history is approximately correct.
if (!columnExists("service_calls", "completed_date")) {
  sqlite.prepare(`ALTER TABLE service_calls ADD COLUMN completed_date TEXT`).run();
  sqlite.prepare(`
    UPDATE service_calls
    SET completed_date = COALESCE(updated_at, created_at)
    WHERE status = 'Completed' AND completed_date IS NULL
  `).run();
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_service_calls_completed_date ON service_calls(completed_date)`);
  console.log("Migration 30: added completed_date column to service_calls (backfilled from updated_at/created_at)");
}

// Migration 29: Add covering indexes for queries that scan tables fully.
// These dramatically speed up the manager dashboard and detail pages once the
// database has thousands of rows. All idempotent (IF NOT EXISTS).
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_invoices_service_call_id ON invoices(service_call_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
  CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
  CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
  CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_service_calls_parent_call_id ON service_calls(parent_call_id);
  CREATE INDEX IF NOT EXISTS idx_service_calls_scheduled_date ON service_calls(scheduled_date);
  CREATE INDEX IF NOT EXISTS idx_service_calls_created_by ON service_calls(created_by);
  CREATE INDEX IF NOT EXISTS idx_visits_visit_date ON service_call_visits(visit_date);
  CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log_system(entity_type, entity_id);
`);
console.log("Migration 29: ensured query indexes (invoices, visits, audit, service_calls)");

// Seed default admin user if users table is empty
const userCount = (sqlite.prepare(`SELECT COUNT(*) as count FROM users`).get() as any).count;
if (userCount === 0) {
  const hashedPw = bcrypt.hashSync("fitzpatrick2026", 12);
  sqlite.prepare(
    `INSERT INTO users (username, password, display_name, email, role, active, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("admin", hashedPw, "Kevin Fitzpatrick", "kevin@fitzpatricksales.com", "manager", 1, 1, new Date().toISOString());
  console.log("Seed: created default admin user (admin / fitzpatrick2026)");
}

export interface ServiceCallWithCounts extends ServiceCall {
  photoCount: number;
  partCount: number;
  // Roll-up fields for the operational list view
  primaryTechnicianId: number | null;     // technician on most-recent visit
  primaryTechnicianName: string | null;
  visitCount: number;                      // # of return visits
  invoiceId: number | null;                // latest invoice on this call
  invoiceNumber: string | null;
  invoiceStatus: string | null;            // Draft | Sent | Paid | Overdue
  invoiceTotal: string | null;
  invoiceDueDate: string | null;
}

export interface ServiceCallFull extends ServiceCall {
  photos: Photo[];
  parts: Part[];
  activities: ActivityLog[];
}

export interface DashboardStats {
  totalCalls: number;
  openCalls: number;
  completedThisMonth: number;
  pendingClaims: number;
  followUpsDue: number;
  revenueThisMonth: number;
  outstandingBalance: number;
  firstTimeFixRate: number;
  avgDaysToPayment: number;
}

export interface DashboardTodayData {
  todayScheduled: ServiceCallWithCounts[];
  todayCount: number;
  inProgressCount: number;
  overdueInvoices: number;
}

export interface DashboardActivityEntry {
  id: number;
  username: string;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: string | null;
  createdAt: string;
}

export interface IStorage {
  // Service Calls
  getAllServiceCalls(filters?: {
    manufacturer?: string;
    status?: string;
    claimStatus?: string;
    city?: string;
    state?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
  }): ServiceCallWithCounts[];
  getServiceCallById(id: number): ServiceCallFull | undefined;
  createServiceCall(call: InsertServiceCall): ServiceCall;
  updateServiceCall(id: number, call: Partial<InsertServiceCall>): ServiceCall | undefined;
  deleteServiceCall(id: number): void;

  // Photos
  getPhotosByServiceCallId(serviceCallId: number): Photo[];
  createPhoto(photo: InsertPhoto): Photo;
  deletePhoto(id: number): void;

  // Parts
  getPartsByServiceCallId(serviceCallId: number): Part[];
  createPart(part: InsertPart): Part;
  updatePart(id: number, part: Partial<InsertPart>): Part | undefined;
  deletePart(id: number): void;

  // Dashboard
  getDashboardStats(): DashboardStats;
  getRecentServiceCalls(limit: number): ServiceCallWithCounts[];

  // Related Calls
  getRelatedCalls(callId: number): ServiceCall[];

  // Contacts
  getAllContacts(filters?: { type?: string; search?: string }): Contact[];
  getContactById(id: number): Contact | undefined;
  createContact(contact: InsertContact): Contact;
  updateContact(id: number, contact: Partial<InsertContact>): Contact | undefined;
  deleteContact(id: number): void;
  suggestContacts(type: string, query: string): Contact[];
  findOrCreateContact(type: string, contactName: string, extra?: {
    companyName?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
  }): Contact | null;
}

export class SQLiteStorage implements IStorage {
  // ─── Service Calls ──────────────────────────────────────────────────────────

  getAllServiceCalls(filters?: {
    manufacturer?: string;
    status?: string;
    claimStatus?: string;
    city?: string;
    state?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
  }): ServiceCallWithCounts[] {
    // Build WHERE conditions to push filtering into SQL
    const conditions: any[] = [];
    const params: any[] = [];

    if (filters?.manufacturer) {
      conditions.push(`sc.manufacturer = ?`);
      params.push(filters.manufacturer);
    }
    if (filters?.status) {
      conditions.push(`sc.status = ?`);
      params.push(filters.status);
    }
    if (filters?.claimStatus) {
      conditions.push(`sc.claim_status = ?`);
      params.push(filters.claimStatus);
    }
    if (filters?.city) {
      conditions.push(`LOWER(sc.job_site_city) LIKE ?`);
      params.push(`%${filters.city.toLowerCase()}%`);
    }
    if (filters?.state) {
      conditions.push(`sc.job_site_state = ?`);
      params.push(filters.state);
    }
    if (filters?.search) {
      const s = `%${filters.search.toLowerCase()}%`;
      conditions.push(`(LOWER(sc.customer_name) LIKE ? OR LOWER(sc.job_site_name) LIKE ? OR LOWER(sc.job_site_city) LIKE ? OR LOWER(sc.product_model) LIKE ? OR LOWER(sc.product_serial) LIKE ? OR LOWER(sc.contact_name) LIKE ?)`);
      params.push(s, s, s, s, s, s);
    }
    if (filters?.dateFrom) {
      conditions.push(`sc.call_date >= ?`);
      params.push(filters.dateFrom);
    }
    if (filters?.dateTo) {
      conditions.push(`sc.call_date <= ?`);
      params.push(filters.dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Single query with subqueries for counts + rollups (tech, invoice) — eliminates N+1
    // primary_technician_id = most-recent visit's technician (or NULL)
    // invoice_* = latest invoice (by issue_date) on this call (or NULL)
    const query = `
      SELECT sc.*,
        (SELECT COUNT(*) FROM photos p WHERE p.service_call_id = sc.id) AS photo_count,
        (SELECT COUNT(*) FROM parts_used pu WHERE pu.service_call_id = sc.id) AS part_count,
        (SELECT COUNT(*) FROM service_call_visits v WHERE v.service_call_id = sc.id) AS visit_count,
        (
          SELECT v.technician_id FROM service_call_visits v
          WHERE v.service_call_id = sc.id AND v.technician_id IS NOT NULL
          ORDER BY v.visit_date DESC, v.id DESC LIMIT 1
        ) AS primary_technician_id,
        (
          SELECT u.display_name FROM service_call_visits v
          LEFT JOIN users u ON u.id = v.technician_id
          WHERE v.service_call_id = sc.id AND v.technician_id IS NOT NULL
          ORDER BY v.visit_date DESC, v.id DESC LIMIT 1
        ) AS primary_technician_name,
        (
          SELECT i.id FROM invoices i
          WHERE i.service_call_id = sc.id
          ORDER BY i.issue_date DESC, i.id DESC LIMIT 1
        ) AS invoice_id,
        (
          SELECT i.invoice_number FROM invoices i
          WHERE i.service_call_id = sc.id
          ORDER BY i.issue_date DESC, i.id DESC LIMIT 1
        ) AS invoice_number,
        (
          SELECT i.status FROM invoices i
          WHERE i.service_call_id = sc.id
          ORDER BY i.issue_date DESC, i.id DESC LIMIT 1
        ) AS invoice_status,
        (
          SELECT i.total FROM invoices i
          WHERE i.service_call_id = sc.id
          ORDER BY i.issue_date DESC, i.id DESC LIMIT 1
        ) AS invoice_total,
        (
          SELECT i.due_date FROM invoices i
          WHERE i.service_call_id = sc.id
          ORDER BY i.issue_date DESC, i.id DESC LIMIT 1
        ) AS invoice_due_date
      FROM service_calls sc
      ${whereClause}
      ORDER BY sc.call_date DESC
    `;

    const rows = sqlite.prepare(query).all(...params) as any[];

    // Map snake_case SQL result to camelCase TypeScript types
    return rows.map(row => ({
      id: row.id,
      callType: row.call_type,
      serviceMethod: row.service_method,
      callDate: row.call_date,
      manufacturer: row.manufacturer,
      manufacturerOther: row.manufacturer_other,
      customerName: row.customer_name,
      jobSiteName: row.job_site_name,
      jobSiteAddress: row.job_site_address,
      jobSiteCity: row.job_site_city,
      jobSiteState: row.job_site_state,
      jobSiteZip: row.job_site_zip,
      wholesalerName: row.wholesaler_name,
      wholesalerPhone: row.wholesaler_phone,
      contactName: row.contact_name,
      contactCompany: row.contact_company,
      contactPhone: row.contact_phone,
      contactEmail: row.contact_email,
      siteContactName: row.site_contact_name,
      siteContactPhone: row.site_contact_phone,
      siteContactEmail: row.site_contact_email,
      productModel: row.product_model,
      productSerial: row.product_serial,
      productType: row.product_type,
      installationDate: row.installation_date,
      issueDescription: row.issue_description,
      diagnosis: row.diagnosis,
      resolution: row.resolution,
      status: row.status,
      claimStatus: row.claim_status,
      claimNotes: row.claim_notes,
      claimNumber: row.claim_number,
      partsCost: row.parts_cost,
      laborCost: row.labor_cost,
      otherCost: row.other_cost,
      claimAmount: row.claim_amount,
      techNotes: row.tech_notes,
      hoursOnJob: row.hours_on_job,
      milesTraveled: row.miles_traveled,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
      followUpDate: row.follow_up_date,
      latitude: row.latitude,
      longitude: row.longitude,
      parentCallId: row.parent_call_id,
      isTest: row.is_test,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedDate: row.completed_date ?? null,
      photoCount: row.photo_count,
      partCount: row.part_count,
      visitCount: row.visit_count ?? 0,
      primaryTechnicianId: row.primary_technician_id ?? null,
      primaryTechnicianName: row.primary_technician_name ?? null,
      invoiceId: row.invoice_id ?? null,
      invoiceNumber: row.invoice_number ?? null,
      invoiceStatus: row.invoice_status ?? null,
      invoiceTotal: row.invoice_total ?? null,
      invoiceDueDate: row.invoice_due_date ?? null,
    }));
  }

  getServiceCallById(id: number): ServiceCallFull | undefined {
    const call = db.select().from(serviceCalls).where(eq(serviceCalls.id, id)).get();
    if (!call) return undefined;
    const callPhotos = db.select().from(photos).where(eq(photos.serviceCallId, id)).orderBy(photos.sortOrder).all();
    const callParts = db.select().from(partsUsed).where(eq(partsUsed.serviceCallId, id)).all();
    const callActivities = db.select().from(activityLog).where(eq(activityLog.serviceCallId, id)).all();
    return { ...call, photos: callPhotos, parts: callParts, activities: callActivities };
  }

  createServiceCall(call: InsertServiceCall): ServiceCall {
    const now = new Date().toISOString();
    return db.insert(serviceCalls).values({ ...call, createdAt: now }).returning().get();
  }

  updateServiceCall(id: number, call: Partial<InsertServiceCall>): ServiceCall | undefined {
    // Always bump updated_at so optimistic concurrency works.
    const withTs = { ...call, updatedAt: new Date().toISOString() } as any;

    // Stamp completed_date when status transitions TO Completed, and clear it
    // when it transitions AWAY. Dashboards use completed_date (not call_date)
    // so "Completed this month" reflects when work finished, not when logged.
    if (call.status !== undefined) {
      const prev = sqlite.prepare(
        `SELECT status, completed_date FROM service_calls WHERE id = ? LIMIT 1`
      ).get(id) as any;
      const prevStatus = prev?.status;
      if (call.status === "Completed" && prevStatus !== "Completed") {
        withTs.completedDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      } else if (call.status !== "Completed" && prevStatus === "Completed") {
        withTs.completedDate = null;
      }
    }

    const updated = db.update(serviceCalls).set(withTs).where(eq(serviceCalls.id, id)).returning().get();
    if (updated && (call.scheduledDate !== undefined || call.scheduledTime !== undefined)) {
      // Keep the active scheduled_appointments row in lockstep with the call's
      // scheduled fields. Otherwise an admin editing the Overview's 'Scheduled
      // Date' would leave the active row stuck at the old date — the same class
      // of drift bug we just fixed on the dashboard side.
      const activeApp = sqlite.prepare(
        `SELECT id FROM scheduled_appointments WHERE call_id = ? AND status = 'active' LIMIT 1`
      ).get(id) as any;
      if (activeApp) {
        sqlite.prepare(
          `UPDATE scheduled_appointments SET scheduled_date = ?, scheduled_time = ? WHERE id = ?`
        ).run(updated.scheduledDate, updated.scheduledTime, activeApp.id);
      }
    }
    return updated;
  }

  deleteServiceCall(id: number): void {
    // Clean up all relational rows that reference this call so we don't leave
    // orphans in the DB (previously: appointments, visits, invoices remained).
    sqlite.prepare(`DELETE FROM scheduled_appointments WHERE call_id = ?`).run(id);
    sqlite.prepare(`DELETE FROM service_call_visits WHERE service_call_id = ?`).run(id);
    sqlite.prepare(`DELETE FROM invoices WHERE service_call_id = ?`).run(id);
    db.delete(photos).where(eq(photos.serviceCallId, id)).run();
    db.delete(partsUsed).where(eq(partsUsed.serviceCallId, id)).run();
    db.delete(activityLog).where(eq(activityLog.serviceCallId, id)).run();
    db.delete(serviceCalls).where(eq(serviceCalls.id, id)).run();
  }

  // ─── Photos ─────────────────────────────────────────────────────────────────

  getPhotosByServiceCallId(serviceCallId: number): Photo[] {
    return db.select().from(photos).where(eq(photos.serviceCallId, serviceCallId)).all();
  }

  createPhoto(photo: InsertPhoto): Photo {
    // Auto-assign visit_number based on latest visit for this service call
    const latest = sqlite.prepare(
      `SELECT COALESCE(MAX(visit_number), 1) as latest FROM service_call_visits WHERE service_call_id = ?`
    ).get(photo.serviceCallId) as any;
    const visitNumber = latest?.latest ?? 1;
    return db.insert(photos).values({ ...photo, visitNumber }).returning().get();
  }

  deletePhoto(id: number): void {
    db.delete(photos).where(eq(photos.id, id)).run();
  }

  updatePhotoSortOrder(photoId: number, sortOrder: number): void {
    sqlite.prepare("UPDATE photos SET sort_order = ? WHERE id = ?").run(sortOrder, photoId);
  }

  // ─── Parts ──────────────────────────────────────────────────────────────────

  getPartsByServiceCallId(serviceCallId: number): Part[] {
    return db.select().from(partsUsed).where(eq(partsUsed.serviceCallId, serviceCallId)).all();
  }

  createPart(part: InsertPart): Part {
    return db.insert(partsUsed).values(part).returning().get();
  }

  updatePart(id: number, part: Partial<InsertPart>): Part | undefined {
    return db.update(partsUsed).set(part).where(eq(partsUsed.id, id)).returning().get();
  }

  deletePart(id: number): void {
    db.delete(partsUsed).where(eq(partsUsed.id, id)).run();
  }

  // ─── Dashboard ──────────────────────────────────────────────────────────────

  getDashboardStats(): DashboardStats {
    // All dates computed in the business timezone (default America/Denver).
    // Previously this used server-local (UTC on Render) which caused the
    // month-start to roll over ~6 hours early.
    const today = todayLocalISO();
    const [ty, tm] = today.split("-");
    const monthStart = `${ty}-${tm}-01`;
    const monthEnd = `${ty}-${tm}-31`;

    const row = sqlite.prepare(`
      SELECT
        COUNT(*) AS total_calls,
        SUM(CASE WHEN status != 'Completed' THEN 1 ELSE 0 END) AS open_calls,
        SUM(CASE WHEN status = 'Completed' AND COALESCE(completed_date, call_date) >= ? AND COALESCE(completed_date, call_date) <= ? THEN 1 ELSE 0 END) AS completed_this_month,
        SUM(CASE WHEN claim_status IN ('Submitted', 'Pending Review') THEN 1 ELSE 0 END) AS pending_claims,
        SUM(CASE WHEN follow_up_date IS NOT NULL AND follow_up_date <= ? AND status != 'Completed' THEN 1 ELSE 0 END) AS follow_ups_due
      FROM service_calls
      WHERE (is_test = 0 OR is_test IS NULL)
    `).get(monthStart, monthEnd, today) as any;

    // Revenue this month: sum of non-Draft invoices with issue_date in this month
    const revRow = sqlite.prepare(`
      SELECT COALESCE(SUM(CAST(total AS REAL)), 0) AS revenue
      FROM invoices
      WHERE status != 'Draft' AND issue_date >= ? AND issue_date <= ?
    `).get(monthStart, monthEnd) as any;

    // Outstanding balance: Sent/Overdue invoices (unpaid)
    const outRow = sqlite.prepare(`
      SELECT COALESCE(SUM(CAST(total AS REAL)), 0) AS outstanding
      FROM invoices
      WHERE status IN ('Sent', 'Overdue')
    `).get() as any;

    // First-time fix rate — completed calls with no follow-up chain children / total completed
    const ftfRow = sqlite.prepare(`
      SELECT
        COUNT(*) AS completed_total,
        SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM service_calls child WHERE child.parent_call_id = sc.id
        ) THEN 1 ELSE 0 END) AS first_time
      FROM service_calls sc
      WHERE sc.status = 'Completed'
        AND (sc.is_test = 0 OR sc.is_test IS NULL)
    `).get() as any;

    const completedTotal = ftfRow.completed_total ?? 0;
    const firstTimeFixRate = completedTotal > 0
      ? Math.round(((ftfRow.first_time ?? 0) / completedTotal) * 100)
      : 0;

    // Avg days to payment: average of (paid_date - issue_date) for Paid invoices
    const payRow = sqlite.prepare(`
      SELECT paid_date, issue_date
      FROM invoices
      WHERE status = 'Paid' AND paid_date IS NOT NULL AND issue_date IS NOT NULL
    `).all() as any[];

    let avgDaysToPayment = 0;
    if (payRow.length > 0) {
      const totalDays = payRow.reduce((sum, r) => {
        const paid = new Date(r.paid_date);
        const issued = new Date(r.issue_date);
        const days = Math.max(0, Math.round((paid.getTime() - issued.getTime()) / (1000 * 60 * 60 * 24)));
        return sum + days;
      }, 0);
      avgDaysToPayment = Math.round(totalDays / payRow.length);
    }

    return {
      totalCalls: row.total_calls ?? 0,
      openCalls: row.open_calls ?? 0,
      completedThisMonth: row.completed_this_month ?? 0,
      pendingClaims: row.pending_claims ?? 0,
      followUpsDue: row.follow_ups_due ?? 0,
      revenueThisMonth: Math.round(revRow.revenue ?? 0),
      outstandingBalance: Math.round(outRow.outstanding ?? 0),
      firstTimeFixRate,
      avgDaysToPayment,
    };
  }

  getDashboardToday(): DashboardTodayData {
    const today = todayLocalISO();

    // Pull every call whose schedule lands on today — either via the parent
    // call's scheduled_date (or call_date as fallback), OR via any return
    // visit scheduled for today. The DISTINCT ensures a call with both an
    // active parent date AND a visit date for today only appears once.
    // Previously this query checked only service_calls.scheduled_date and
    // missed return-visit-only entries (e.g. Visit 3 scheduled for today on
    // a call originally logged last month).
    const rows = sqlite.prepare(`
      SELECT sc.*,
        (SELECT COUNT(*) FROM photos p WHERE p.service_call_id = sc.id) AS photo_count,
        (SELECT COUNT(*) FROM parts_used pu WHERE pu.service_call_id = sc.id) AS part_count
      FROM service_calls sc
      WHERE (sc.is_test = 0 OR sc.is_test IS NULL)
        AND sc.status IN ('Scheduled', 'In Progress', 'Needs Return Visit', 'Pending Parts')
        AND (
          sc.scheduled_date = ?
          OR (sc.scheduled_date IS NULL AND sc.call_date = ?)
          OR sc.id IN (
            SELECT service_call_id FROM service_call_visits
            WHERE visit_date = ? AND status IN ('Scheduled', 'In Progress', 'Needs Return Visit')
          )
        )
      ORDER BY
        CASE WHEN sc.scheduled_time IS NULL THEN 1 ELSE 0 END,
        sc.scheduled_time ASC,
        sc.id ASC
    `).all(today, today, today) as any[];

    const todayScheduled: ServiceCallWithCounts[] = rows.map(row => ({
      id: row.id,
      callType: row.call_type,
      serviceMethod: row.service_method,
      callDate: row.call_date,
      manufacturer: row.manufacturer,
      manufacturerOther: row.manufacturer_other,
      customerName: row.customer_name,
      jobSiteName: row.job_site_name,
      jobSiteAddress: row.job_site_address,
      jobSiteCity: row.job_site_city,
      jobSiteState: row.job_site_state,
      jobSiteZip: row.job_site_zip,
      wholesalerName: row.wholesaler_name,
      wholesalerPhone: row.wholesaler_phone,
      contactName: row.contact_name,
      contactCompany: row.contact_company,
      contactPhone: row.contact_phone,
      contactEmail: row.contact_email,
      siteContactName: row.site_contact_name,
      siteContactPhone: row.site_contact_phone,
      siteContactEmail: row.site_contact_email,
      productModel: row.product_model,
      productSerial: row.product_serial,
      productType: row.product_type,
      installationDate: row.installation_date,
      issueDescription: row.issue_description,
      diagnosis: row.diagnosis,
      resolution: row.resolution,
      status: row.status,
      claimStatus: row.claim_status,
      claimNotes: row.claim_notes,
      claimNumber: row.claim_number,
      partsCost: row.parts_cost,
      laborCost: row.labor_cost,
      otherCost: row.other_cost,
      claimAmount: row.claim_amount,
      techNotes: row.tech_notes,
      hoursOnJob: row.hours_on_job,
      milesTraveled: row.miles_traveled,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
      followUpDate: row.follow_up_date,
      latitude: row.latitude,
      longitude: row.longitude,
      parentCallId: row.parent_call_id,
      isTest: row.is_test,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedDate: row.completed_date ?? null,
      photoCount: row.photo_count,
      partCount: row.part_count,
      visitCount: 0,
      primaryTechnicianId: null,
      primaryTechnicianName: null,
      invoiceId: null,
      invoiceNumber: null,
      invoiceStatus: null,
      invoiceTotal: null,
      invoiceDueDate: null,
    }));

    const inProgressCount = todayScheduled.filter(c => c.status === "In Progress").length;

    const overdueRow = sqlite.prepare(`
      SELECT COUNT(*) AS cnt
      FROM invoices
      WHERE status NOT IN ('Paid', 'Draft')
        AND due_date IS NOT NULL
        AND due_date < ?
    `).get(today) as any;

    return {
      todayScheduled,
      todayCount: todayScheduled.length,
      inProgressCount,
      overdueInvoices: overdueRow.cnt ?? 0,
    };
  }

  getDashboardActivity(limit: number = 10): DashboardActivityEntry[] {
    const rows = sqlite.prepare(`
      SELECT id, username, action, entity_type, entity_id, details, created_at
      FROM audit_log_system
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(r => ({
      id: r.id,
      username: r.username,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      details: r.details,
      createdAt: r.created_at,
    }));
  }

  getRecentServiceCalls(limit: number): ServiceCallWithCounts[] {
    const rows = sqlite.prepare(`
      SELECT sc.*,
        (SELECT COUNT(*) FROM photos p WHERE p.service_call_id = sc.id) AS photo_count,
        (SELECT COUNT(*) FROM parts_used pu WHERE pu.service_call_id = sc.id) AS part_count
      FROM service_calls sc
      WHERE (sc.is_test = 0 OR sc.is_test IS NULL)
      ORDER BY
        CASE WHEN sc.scheduled_date IS NULL THEN 1 ELSE 0 END,
        sc.scheduled_date DESC,
        sc.scheduled_time DESC,
        sc.call_date DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(row => ({
      id: row.id,
      callType: row.call_type,
      serviceMethod: row.service_method,
      callDate: row.call_date,
      manufacturer: row.manufacturer,
      manufacturerOther: row.manufacturer_other,
      customerName: row.customer_name,
      jobSiteName: row.job_site_name,
      jobSiteAddress: row.job_site_address,
      jobSiteCity: row.job_site_city,
      jobSiteState: row.job_site_state,
      jobSiteZip: row.job_site_zip,
      wholesalerName: row.wholesaler_name,
      wholesalerPhone: row.wholesaler_phone,
      contactName: row.contact_name,
      contactCompany: row.contact_company,
      contactPhone: row.contact_phone,
      contactEmail: row.contact_email,
      siteContactName: row.site_contact_name,
      siteContactPhone: row.site_contact_phone,
      siteContactEmail: row.site_contact_email,
      productModel: row.product_model,
      productSerial: row.product_serial,
      productType: row.product_type,
      installationDate: row.installation_date,
      issueDescription: row.issue_description,
      diagnosis: row.diagnosis,
      resolution: row.resolution,
      status: row.status,
      claimStatus: row.claim_status,
      claimNotes: row.claim_notes,
      claimNumber: row.claim_number,
      partsCost: row.parts_cost,
      laborCost: row.labor_cost,
      otherCost: row.other_cost,
      claimAmount: row.claim_amount,
      techNotes: row.tech_notes,
      hoursOnJob: row.hours_on_job,
      milesTraveled: row.miles_traveled,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
      followUpDate: row.follow_up_date,
      latitude: row.latitude,
      longitude: row.longitude,
      parentCallId: row.parent_call_id,
      isTest: row.is_test,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedDate: row.completed_date ?? null,
      photoCount: row.photo_count,
      partCount: row.part_count,
      visitCount: 0,
      primaryTechnicianId: null,
      primaryTechnicianName: null,
      invoiceId: null,
      invoiceNumber: null,
      invoiceStatus: null,
      invoiceTotal: null,
      invoiceDueDate: null,
    }));
  }

  // ─── Related Calls (Follow-up chain) ─────────────────────────────────────

  getRelatedCalls(callId: number): ServiceCall[] {
    // Find the root call by walking up parent_call_id
    let currentId = callId;
    for (let i = 0; i < 100; i++) {
      const row = sqlite.prepare(`SELECT parent_call_id FROM service_calls WHERE id = ?`).get(currentId) as any;
      if (!row || !row.parent_call_id) break;
      currentId = row.parent_call_id;
    }
    const rootId = currentId;

    // Collect all calls in the chain using BFS
    const ids = new Set<number>([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const children = sqlite.prepare(`SELECT id FROM service_calls WHERE parent_call_id = ?`).all(parentId) as any[];
      for (const child of children) {
        if (!ids.has(child.id)) {
          ids.add(child.id);
          queue.push(child.id);
        }
      }
    }

    if (ids.size <= 1) {
      // Check if this single call even has a parent_call_id; if not, no chain
      const row = sqlite.prepare(`SELECT parent_call_id FROM service_calls WHERE id = ?`).get(rootId) as any;
      if (!row?.parent_call_id && ids.size === 1) {
        // Check children
        const children = sqlite.prepare(`SELECT id FROM service_calls WHERE parent_call_id = ?`).all(rootId) as any[];
        if (children.length === 0) return [];
      }
    }

    const placeholders = Array.from(ids).map(() => "?").join(",");
    const rows = sqlite.prepare(
      `SELECT * FROM service_calls WHERE id IN (${placeholders}) ORDER BY call_date ASC, id ASC`
    ).all(...Array.from(ids)) as any[];

    return rows.map(row => ({
      id: row.id,
      callType: row.call_type,
      serviceMethod: row.service_method,
      callDate: row.call_date,
      manufacturer: row.manufacturer,
      manufacturerOther: row.manufacturer_other,
      customerName: row.customer_name,
      jobSiteName: row.job_site_name,
      jobSiteAddress: row.job_site_address,
      jobSiteCity: row.job_site_city,
      jobSiteState: row.job_site_state,
      jobSiteZip: row.job_site_zip,
      wholesalerName: row.wholesaler_name,
      wholesalerPhone: row.wholesaler_phone,
      contactName: row.contact_name,
      contactCompany: row.contact_company,
      contactPhone: row.contact_phone,
      contactEmail: row.contact_email,
      siteContactName: row.site_contact_name,
      siteContactPhone: row.site_contact_phone,
      siteContactEmail: row.site_contact_email,
      productModel: row.product_model,
      productSerial: row.product_serial,
      productType: row.product_type,
      installationDate: row.installation_date,
      issueDescription: row.issue_description,
      diagnosis: row.diagnosis,
      resolution: row.resolution,
      status: row.status,
      claimStatus: row.claim_status,
      claimNotes: row.claim_notes,
      claimNumber: row.claim_number,
      partsCost: row.parts_cost,
      laborCost: row.labor_cost,
      otherCost: row.other_cost,
      claimAmount: row.claim_amount,
      techNotes: row.tech_notes,
      hoursOnJob: row.hours_on_job,
      milesTraveled: row.miles_traveled,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
      followUpDate: row.follow_up_date,
      latitude: row.latitude,
      longitude: row.longitude,
      parentCallId: row.parent_call_id,
      isTest: row.is_test,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedDate: row.completed_date ?? null,
    }));
  }

  // ─── Contacts ──────────────────────────────────────────────────────────────

  getAllContacts(filters?: { type?: string; search?: string }): Contact[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters?.type) {
      conditions.push(`c.contact_type = ?`);
      params.push(filters.type);
    }
    if (filters?.search) {
      const s = `%${filters.search.toLowerCase()}%`;
      conditions.push(`(LOWER(c.company_name) LIKE ? OR LOWER(c.contact_name) LIKE ? OR LOWER(c.phone) LIKE ? OR LOWER(c.email) LIKE ?)`);
      params.push(s, s, s, s);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = sqlite.prepare(`SELECT * FROM contacts c ${whereClause} ORDER BY c.contact_name ASC`).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      contactType: row.contact_type,
      companyName: row.company_name,
      contactName: row.contact_name,
      contactCompany: row.contact_company,
      phone: row.phone,
      email: row.email,
      address: row.address,
      city: row.city,
      state: row.state,
      notes: row.notes,
      createdAt: row.created_at,
    }));
  }

  getContactById(id: number): Contact | undefined {
    return db.select().from(contacts).where(eq(contacts.id, id)).get();
  }

  createContact(contact: InsertContact): Contact {
    const now = new Date().toISOString();
    return db.insert(contacts).values({ ...contact, createdAt: now }).returning().get();
  }

  updateContact(id: number, contact: Partial<InsertContact>): Contact | undefined {
    return db.update(contacts).set(contact).where(eq(contacts.id, id)).returning().get();
  }

  deleteContact(id: number): void {
    db.delete(contacts).where(eq(contacts.id, id)).run();
  }

  // Find existing contact by type + name, or create a new one
  findOrCreateContact(type: string, contactName: string, extra?: {
    companyName?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
  }): Contact | null {
    if (!contactName || !contactName.trim()) return null;
    const name = contactName.trim();
    // Check if a contact with the same type and name already exists
    const existing = sqlite.prepare(
      `SELECT * FROM contacts WHERE contact_type = ? AND LOWER(contact_name) = LOWER(?) LIMIT 1`
    ).get(type, name) as any;
    if (existing) {
      // Update phone/email if they were empty and we now have them
      const updates: string[] = [];
      const params: any[] = [];
      if (!existing.phone && extra?.phone) { updates.push("phone = ?"); params.push(extra.phone); }
      if (!existing.email && extra?.email) { updates.push("email = ?"); params.push(extra.email); }
      if (!existing.company_name && extra?.companyName) { updates.push("company_name = ?"); params.push(extra.companyName); }
      if (!existing.address && extra?.address) { updates.push("address = ?"); params.push(extra.address); }
      if (!existing.city && extra?.city) { updates.push("city = ?"); params.push(extra.city); }
      if (!existing.state && extra?.state) { updates.push("state = ?"); params.push(extra.state); }
      if (updates.length > 0) {
        sqlite.prepare(`UPDATE contacts SET ${updates.join(", ")} WHERE id = ?`).run(...params, existing.id);
      }
      return existing;
    }
    // Create new
    return this.createContact({
      contactType: type,
      contactName: name,
      companyName: extra?.companyName ?? null,
      phone: extra?.phone ?? null,
      email: extra?.email ?? null,
      address: extra?.address ?? null,
      city: extra?.city ?? null,
      state: extra?.state ?? null,
      notes: null,
    });
  }

  suggestContacts(type: string, query: string): Contact[] {
    const s = `%${query.toLowerCase()}%`;
    const rows = sqlite.prepare(
      `SELECT * FROM contacts WHERE contact_type = ? AND (LOWER(company_name) LIKE ? OR LOWER(contact_name) LIKE ?) ORDER BY contact_name ASC LIMIT 5`
    ).all(type, s, s) as any[];

    return rows.map(row => ({
      id: row.id,
      contactType: row.contact_type,
      companyName: row.company_name,
      contactName: row.contact_name,
      contactCompany: row.contact_company,
      phone: row.phone,
      email: row.email,
      address: row.address,
      city: row.city,
      state: row.state,
      notes: row.notes,
      createdAt: row.created_at,
    }));
  }

  // ─── Follow-ups Due ────────────────────────────────────────────────────────

  getFollowUpsDue(): ServiceCallWithCounts[] {
    const today = todayLocalISO();
    const rows = sqlite.prepare(`
      SELECT sc.*,
        (SELECT COUNT(*) FROM photos p WHERE p.service_call_id = sc.id) AS photo_count,
        (SELECT COUNT(*) FROM parts_used pu WHERE pu.service_call_id = sc.id) AS part_count
      FROM service_calls sc
      WHERE sc.follow_up_date IS NOT NULL AND sc.follow_up_date <= ? AND sc.status != 'Completed'
      ORDER BY sc.follow_up_date ASC
    `).all(today) as any[];

    return rows.map(row => ({
      id: row.id,
      callType: row.call_type,
      serviceMethod: row.service_method,
      callDate: row.call_date,
      manufacturer: row.manufacturer,
      manufacturerOther: row.manufacturer_other,
      customerName: row.customer_name,
      jobSiteName: row.job_site_name,
      jobSiteAddress: row.job_site_address,
      jobSiteCity: row.job_site_city,
      jobSiteState: row.job_site_state,
      jobSiteZip: row.job_site_zip,
      wholesalerName: row.wholesaler_name,
      wholesalerPhone: row.wholesaler_phone,
      contactName: row.contact_name,
      contactCompany: row.contact_company,
      contactPhone: row.contact_phone,
      contactEmail: row.contact_email,
      siteContactName: row.site_contact_name,
      siteContactPhone: row.site_contact_phone,
      siteContactEmail: row.site_contact_email,
      productModel: row.product_model,
      productSerial: row.product_serial,
      productType: row.product_type,
      installationDate: row.installation_date,
      issueDescription: row.issue_description,
      diagnosis: row.diagnosis,
      resolution: row.resolution,
      status: row.status,
      claimStatus: row.claim_status,
      claimNotes: row.claim_notes,
      claimNumber: row.claim_number,
      partsCost: row.parts_cost,
      laborCost: row.labor_cost,
      otherCost: row.other_cost,
      claimAmount: row.claim_amount,
      techNotes: row.tech_notes,
      hoursOnJob: row.hours_on_job,
      milesTraveled: row.miles_traveled,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
      followUpDate: row.follow_up_date,
      latitude: row.latitude,
      longitude: row.longitude,
      parentCallId: row.parent_call_id,
      isTest: row.is_test,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedDate: row.completed_date ?? null,
      photoCount: row.photo_count,
      partCount: row.part_count,
      visitCount: 0,
      primaryTechnicianId: null,
      primaryTechnicianName: null,
      invoiceId: null,
      invoiceNumber: null,
      invoiceStatus: null,
      invoiceTotal: null,
      invoiceDueDate: null,
    }));
  }

  // ─── Global Search ────────────────────────────────────────────────────────

  globalSearch(query: string): {
    calls: Array<{ id: number; callDate: string; customerName: string | null; manufacturer: string; productModel: string | null; status: string }>;
    contacts: Array<{ id: number; contactType: string; contactName: string; companyName: string | null; phone: string | null }>;
    activities: Array<{ id: number; serviceCallId: number; note: string; createdAt: string }>;
  } {
    const q = `%${query.toLowerCase()}%`;

    const calls = sqlite.prepare(`
      SELECT id, call_date, customer_name, manufacturer, product_model, status
      FROM service_calls
      WHERE LOWER(customer_name) LIKE ? OR LOWER(job_site_name) LIKE ? OR LOWER(product_model) LIKE ?
        OR LOWER(product_serial) LIKE ? OR LOWER(issue_description) LIKE ? OR LOWER(claim_number) LIKE ?
        OR LOWER(manufacturer) LIKE ?
      ORDER BY call_date DESC
      LIMIT 5
    `).all(q, q, q, q, q, q, q) as any[];

    const contactRows = sqlite.prepare(`
      SELECT id, contact_type, contact_name, company_name, phone
      FROM contacts
      WHERE LOWER(contact_name) LIKE ? OR LOWER(company_name) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(email) LIKE ?
      ORDER BY contact_name ASC
      LIMIT 5
    `).all(q, q, q, q) as any[];

    const activityRows = sqlite.prepare(`
      SELECT id, service_call_id, note, created_at
      FROM activity_log
      WHERE LOWER(note) LIKE ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(q) as any[];

    return {
      calls: calls.map(r => ({
        id: r.id,
        callDate: r.call_date,
        customerName: r.customer_name,
        manufacturer: r.manufacturer,
        productModel: r.product_model,
        status: r.status,
      })),
      contacts: contactRows.map(r => ({
        id: r.id,
        contactType: r.contact_type,
        contactName: r.contact_name,
        companyName: r.company_name,
        phone: r.phone,
      })),
      activities: activityRows.map(r => ({
        id: r.id,
        serviceCallId: r.service_call_id,
        note: r.note,
        createdAt: r.created_at,
      })),
    };
  }

  // ─── Activity Log ──────────────────────────────────────────────────────────

  getActivitiesByServiceCallId(serviceCallId: number): ActivityLog[] {
    return db.select().from(activityLog).where(eq(activityLog.serviceCallId, serviceCallId)).all();
  }

  createActivity(data: InsertActivityLog): ActivityLog {
    const now = new Date().toISOString();
    return db.insert(activityLog).values({ ...data, createdAt: now }).returning().get();
  }

  deleteActivity(id: number): void {
    db.delete(activityLog).where(eq(activityLog.id, id)).run();
  }

  // ─── Users ──────────────────────────────────────────────────────────────────

  getAllUsers(): Omit<User, "password">[] {
    const rows = sqlite.prepare(`SELECT id, username, display_name, email, role, active, must_change_password, created_at FROM users ORDER BY created_at ASC`).all() as any[];
    return rows.map(r => ({
      id: r.id, username: r.username, displayName: r.display_name, email: r.email,
      role: r.role, active: r.active, mustChangePassword: r.must_change_password, createdAt: r.created_at,
    }));
  }

  getUserById(id: number): User | undefined {
    const row = sqlite.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as any;
    if (!row) return undefined;
    return { id: row.id, username: row.username, password: row.password, displayName: row.display_name, email: row.email, role: row.role, active: row.active, mustChangePassword: row.must_change_password, createdAt: row.created_at };
  }

  getUserByUsername(username: string): User | undefined {
    const row = sqlite.prepare(`SELECT * FROM users WHERE LOWER(username) = LOWER(?)`).get(username) as any;
    if (!row) return undefined;
    return { id: row.id, username: row.username, password: row.password, displayName: row.display_name, email: row.email, role: row.role, active: row.active, mustChangePassword: row.must_change_password, createdAt: row.created_at };
  }

  createUser(data: { username: string; password: string; displayName: string; email?: string; role: string }): Omit<User, "password"> {
    const hashed = bcrypt.hashSync(data.password, 12);
    const now = new Date().toISOString();
    const row = sqlite.prepare(
      `INSERT INTO users (username, password, display_name, email, role, active, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?) RETURNING *`
    ).get(data.username, hashed, data.displayName, data.email || null, data.role, now) as any;
    return { id: row.id, username: row.username, displayName: row.display_name, email: row.email, role: row.role, active: row.active, mustChangePassword: row.must_change_password, createdAt: row.created_at };
  }

  deleteUser(id: number): void {
    // Nullify references so history is preserved
    sqlite.prepare(`UPDATE audit_log_system SET user_id = NULL WHERE user_id = ?`).run(id);
    sqlite.prepare(`UPDATE service_call_visits SET technician_id = NULL WHERE technician_id = ?`).run(id);
    sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  }

  updateUser(id: number, data: { displayName?: string; email?: string; role?: string; active?: number; password?: string; mustChangePassword?: number }): Omit<User, "password"> | undefined {
    const updates: string[] = [];
    const params: any[] = [];
    if (data.displayName !== undefined) { updates.push("display_name = ?"); params.push(data.displayName); }
    if (data.email !== undefined) { updates.push("email = ?"); params.push(data.email); }
    if (data.role !== undefined) { updates.push("role = ?"); params.push(data.role); }
    if (data.active !== undefined) { updates.push("active = ?"); params.push(data.active); }
    if (data.password !== undefined) {
      updates.push("password = ?"); params.push(bcrypt.hashSync(data.password, 12));
      updates.push("must_change_password = 1");
    }
    if (data.mustChangePassword !== undefined) { updates.push("must_change_password = ?"); params.push(data.mustChangePassword); }
    if (updates.length === 0) return this.getUserById(id) as any;
    params.push(id);
    const row = sqlite.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ? RETURNING *`).get(...params) as any;
    if (!row) return undefined;
    return { id: row.id, username: row.username, displayName: row.display_name, email: row.email, role: row.role, active: row.active, mustChangePassword: row.must_change_password, createdAt: row.created_at };
  }

  verifyPassword(plaintext: string, hash: string): boolean {
    return bcrypt.compareSync(plaintext, hash);
  }

  // ─── System Audit Log ─────────────────────────────────────────────────────

  createAuditEntry(data: { userId: number | null; username: string; action: string; entityType?: string; entityId?: number; details?: string }): void {
    sqlite.prepare(
      `INSERT INTO audit_log_system (user_id, username, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(data.userId, data.username, data.action, data.entityType || null, data.entityId || null, data.details || null, new Date().toISOString());
  }

  // ─── Invoices ───────────────────────────────────────────────────────────

  generateInvoiceNumber(): string {
    // Collision-safe: use MAX of the existing sequence numbers (not COUNT)
    // and never return a number that already exists. COUNT can collide if
    // an invoice was deleted, two requests arrive concurrently, or the
    // sequence is non-contiguous. We pick max+1, then walk forward until
    // we find a free slot.
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    const rows = sqlite.prepare(
      `SELECT invoice_number FROM invoices WHERE invoice_number LIKE ?`
    ).all(`${prefix}%`) as any[];
    let maxSeq = 0;
    const taken = new Set<number>();
    for (const r of rows) {
      const m = String(r.invoice_number).match(/-(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) {
          taken.add(n);
          if (n > maxSeq) maxSeq = n;
        }
      }
    }
    let next = maxSeq + 1;
    while (taken.has(next)) next++;
    return `${prefix}${String(next).padStart(3, "0")}`;
  }

  private mapInvoiceRow(r: any): Invoice {
    return {
      id: r.id, invoiceNumber: r.invoice_number, serviceCallId: r.service_call_id,
      billToType: r.bill_to_type, billToName: r.bill_to_name, billToAddress: r.bill_to_address,
      billToCity: r.bill_to_city, billToState: r.bill_to_state, billToEmail: r.bill_to_email,
      billToPhone: r.bill_to_phone, issueDate: r.issue_date, dueDate: r.due_date,
      paymentTerms: r.payment_terms, status: r.status, notes: r.notes,
      subtotal: r.subtotal, total: r.total, paidDate: r.paid_date,
      createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  private mapItemRow(r: any): InvoiceItem {
    return {
      id: r.id, invoiceId: r.invoice_id, type: r.type, description: r.description,
      quantity: r.quantity, unitPrice: r.unit_price, amount: r.amount, sortOrder: r.sort_order,
      visitNumber: r.visit_number ?? null,
    };
  }

  getAllInvoices(filters?: { status?: string; billToType?: string; search?: string }): (Invoice & { itemCount: number })[] {
    const conditions: string[] = [];
    const params: any[] = [];
    if (filters?.status) { conditions.push("status = ?"); params.push(filters.status); }
    if (filters?.billToType) { conditions.push("bill_to_type = ?"); params.push(filters.billToType); }
    if (filters?.search) {
      conditions.push("(invoice_number LIKE ? OR bill_to_name LIKE ?)");
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = sqlite.prepare(`
      SELECT i.*, (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.id) as item_count
      FROM invoices i ${where} ORDER BY i.created_at DESC
    `).all(...params) as any[];
    return rows.map(r => ({ ...this.mapInvoiceRow(r), itemCount: r.item_count }));
  }

  getInvoiceById(id: number): (Invoice & { items: InvoiceItem[] }) | undefined {
    const row = sqlite.prepare(`SELECT * FROM invoices WHERE id = ?`).get(id) as any;
    if (!row) return undefined;
    const items = sqlite.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC`).all(id) as any[];
    return { ...this.mapInvoiceRow(row), items: items.map(i => this.mapItemRow(i)) };
  }

  getInvoicesByServiceCallId(serviceCallId: number): Invoice[] {
    const rows = sqlite.prepare(`SELECT * FROM invoices WHERE service_call_id = ? ORDER BY created_at DESC`).all(serviceCallId) as any[];
    return rows.map(r => this.mapInvoiceRow(r));
  }

  createInvoice(data: InsertInvoice): Invoice {
    const now = new Date().toISOString();
    const row = sqlite.prepare(`
      INSERT INTO invoices (invoice_number, service_call_id, bill_to_type, bill_to_name,
        bill_to_address, bill_to_city, bill_to_state, bill_to_email, bill_to_phone,
        issue_date, due_date, payment_terms, status, notes, subtotal, total, paid_date,
        created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      data.invoiceNumber, data.serviceCallId || null, data.billToType, data.billToName,
      data.billToAddress || null, data.billToCity || null, data.billToState || null,
      data.billToEmail || null, data.billToPhone || null,
      data.issueDate, data.dueDate || null, data.paymentTerms || "Net 30",
      data.status || "Draft", data.notes || null,
      data.subtotal || "0", data.total || "0", data.paidDate || null,
      data.createdBy || null, now, now
    ) as any;
    return this.mapInvoiceRow(row);
  }

  updateInvoice(id: number, data: Partial<InsertInvoice>): Invoice | undefined {
    const now = new Date().toISOString();
    const allowed = ["billToType","billToName","billToAddress","billToCity","billToState",
      "billToEmail","billToPhone","issueDate","dueDate","paymentTerms","status",
      "notes","subtotal","total","paidDate","serviceCallId"];
    const colMap: Record<string,string> = {
      billToType:"bill_to_type", billToName:"bill_to_name", billToAddress:"bill_to_address",
      billToCity:"bill_to_city", billToState:"bill_to_state", billToEmail:"bill_to_email",
      billToPhone:"bill_to_phone", issueDate:"issue_date", dueDate:"due_date",
      paymentTerms:"payment_terms", status:"status", notes:"notes",
      subtotal:"subtotal", total:"total", paidDate:"paid_date", serviceCallId:"service_call_id",
    };
    const updates: string[] = ["updated_at = ?"];
    const params: any[] = [now];
    for (const key of allowed) {
      if (key in data) { updates.push(`${colMap[key]} = ?`); params.push((data as any)[key]); }
    }
    params.push(id);
    const row = sqlite.prepare(`UPDATE invoices SET ${updates.join(", ")} WHERE id = ? RETURNING *`).get(...params) as any;
    return row ? this.mapInvoiceRow(row) : undefined;
  }

  deleteInvoice(id: number): void {
    sqlite.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).run(id);
    sqlite.prepare(`DELETE FROM invoices WHERE id = ?`).run(id);
  }

  // Mark any Sent invoice whose due_date < today as Overdue
  markOverdueInvoices(today: string): void {
    sqlite.prepare(
      `UPDATE invoices SET status = 'Overdue', updated_at = ? WHERE status = 'Sent' AND due_date IS NOT NULL AND due_date < ?`
    ).run(new Date().toISOString(), today);
  }

  // Invoice items
  createInvoiceItem(data: InsertInvoiceItem): InvoiceItem {
    const row = sqlite.prepare(`
      INSERT INTO invoice_items (invoice_id, type, description, quantity, unit_price, amount, sort_order, visit_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `).get(data.invoiceId, data.type, data.description, data.quantity, data.unitPrice, data.amount, data.sortOrder || 0, data.visitNumber ?? null) as any;
    return this.mapItemRow(row);
  }

  updateInvoiceItem(id: number, data: Partial<InsertInvoiceItem>): InvoiceItem | undefined {
    const allowed = ["type","description","quantity","unitPrice","amount","sortOrder","visitNumber"];
    const colMap: Record<string,string> = { type:"type", description:"description", quantity:"quantity", unitPrice:"unit_price", amount:"amount", sortOrder:"sort_order", visitNumber:"visit_number" };
    const updates: string[] = [];
    const params: any[] = [];
    for (const key of allowed) {
      if (key in data) { updates.push(`${colMap[key]} = ?`); params.push((data as any)[key]); }
    }
    if (!updates.length) return undefined;
    params.push(id);
    const row = sqlite.prepare(`UPDATE invoice_items SET ${updates.join(", ")} WHERE id = ? RETURNING *`).get(...params) as any;
    return row ? this.mapItemRow(row) : undefined;
  }

  deleteInvoiceItem(id: number): void {
    sqlite.prepare(`DELETE FROM invoice_items WHERE id = ?`).run(id);
  }

  replaceInvoiceItems(invoiceId: number, items: InsertInvoiceItem[]): InvoiceItem[] {
    sqlite.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).run(invoiceId);
    return items.map((item, idx) => this.createInvoiceItem({ ...item, invoiceId, sortOrder: idx }));
  }

  // ─── Service Call Visits (Return Visits) ──────────────────────────────────

  private mapVisitRow(r: any): ServiceCallVisit {
    return {
      id: r.id,
      serviceCallId: r.service_call_id,
      visitNumber: r.visit_number,
      visitDate: r.visit_date,
      technicianId: r.technician_id,
      notes: r.notes,
      status: r.status,
      hoursOnJob: r.hours_on_job ?? null,
      milesTraveled: r.miles_traveled ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  getVisitsForCall(serviceCallId: number): ServiceCallVisit[] {
    const rows = sqlite.prepare(
      `SELECT * FROM service_call_visits WHERE service_call_id = ? ORDER BY visit_number ASC`
    ).all(serviceCallId) as any[];
    return rows.map(r => this.mapVisitRow(r));
  }

  createVisit(data: InsertServiceCallVisit & { hoursOnJob?: string; milesTraveled?: string }): ServiceCallVisit {
    const nextNum = (sqlite.prepare(
      `SELECT COALESCE(MAX(visit_number), 1) + 1 AS next_num FROM service_call_visits WHERE service_call_id = ?`
    ).get(data.serviceCallId) as any).next_num;
    const now = new Date().toISOString();
    const row = sqlite.prepare(`
      INSERT INTO service_call_visits (service_call_id, visit_number, visit_date, technician_id, notes, status, hours_on_job, miles_traveled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `).get(
      data.serviceCallId, nextNum, data.visitDate,
      data.technicianId || null, data.notes || null,
      data.status || "Scheduled",
      data.hoursOnJob || null, data.milesTraveled || null,
      now, now
    ) as any;
    return this.mapVisitRow(row);
  }

  updateVisit(id: number, data: Partial<Pick<ServiceCallVisit, 'visitDate' | 'technicianId' | 'notes' | 'status' | 'hoursOnJob' | 'milesTraveled'>>): ServiceCallVisit | undefined {
    const allowed = ["visitDate", "technicianId", "notes", "status", "hoursOnJob", "milesTraveled"];
    const colMap: Record<string, string> = {
      visitDate: "visit_date", technicianId: "technician_id", notes: "notes", status: "status",
      hoursOnJob: "hours_on_job", milesTraveled: "miles_traveled",
    };
    const updates: string[] = ["updated_at = ?"];
    const params: any[] = [new Date().toISOString()];
    for (const key of allowed) {
      if (key in data) {
        updates.push(`${colMap[key]} = ?`);
        params.push((data as any)[key] ?? null);
      }
    }
    params.push(id);
    const row = sqlite.prepare(
      `UPDATE service_call_visits SET ${updates.join(", ")} WHERE id = ? RETURNING *`
    ).get(...params) as any;
    return row ? this.mapVisitRow(row) : undefined;
  }

  deleteVisit(id: number): void {
    sqlite.prepare(`DELETE FROM service_call_visits WHERE id = ?`).run(id);
  }

  getVisitById(id: number): ServiceCallVisit | undefined {
    const row = sqlite.prepare(`SELECT * FROM service_call_visits WHERE id = ?`).get(id) as any;
    return row ? this.mapVisitRow(row) : undefined;
  }

  getAuditLog(filters?: { userId?: number; action?: string; entityType?: string; limit?: number; offset?: number }): { entries: AuditLogEntry[]; total: number } {
    const conditions: string[] = [];
    const params: any[] = [];
    if (filters?.userId) { conditions.push("user_id = ?"); params.push(filters.userId); }
    if (filters?.action) { conditions.push("action = ?"); params.push(filters.action); }
    if (filters?.entityType) { conditions.push("entity_type = ?"); params.push(filters.entityType); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = (sqlite.prepare(`SELECT COUNT(*) as count FROM audit_log_system ${where}`).get(...params) as any).count;
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;
    const rows = sqlite.prepare(`SELECT * FROM audit_log_system ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];
    const entries = rows.map(r => ({
      id: r.id, userId: r.user_id, username: r.username, action: r.action,
      entityType: r.entity_type, entityId: r.entity_id, details: r.details, createdAt: r.created_at,
    }));
    return { entries, total };
  }

  // ─── Executive Briefing ────────────────────────────────────────────────────
  getExecutiveBriefing(): any {
    // All dates computed in business timezone, not server-UTC. Previous
    // implementation used now.getFullYear()/getMonth() which run in the
    // server's local timezone — UTC on Render — causing the month
    // boundary to be wrong for the last 6 hours of every month.
    const now = new Date(); // for relative-day math (week buckets); TZ-agnostic
    const today = todayLocalISO();
    const [tyStr, tmStr] = today.split("-");
    const yyyy = parseInt(tyStr, 10);
    const mm = parseInt(tmStr, 10) - 1; // 0-indexed for Date math below
    const monthStart = `${tyStr}-${tmStr}-01`;
    const monthEnd = `${tyStr}-${tmStr}-31`;
    // Previous month range — anchor at noon UTC to avoid DST fence-post
    const prevDate = new Date(Date.UTC(yyyy, mm - 1, 1, 12));
    const py = prevDate.getUTCFullYear();
    const pm = String(prevDate.getUTCMonth() + 1).padStart(2, "0");
    const prevStart = `${py}-${pm}-01`;
    const prevEnd = `${py}-${pm}-31`;

    // Helpers
    const num = (q: any, ...p: any[]) => Number((sqlite.prepare(q).get(...p) as any)?.v ?? 0);

    // Revenue this month vs last month
    const revThis = num(
      `SELECT COALESCE(SUM(CAST(total AS REAL)), 0) AS v FROM invoices WHERE status != 'Draft' AND issue_date >= ? AND issue_date <= ?`,
      monthStart, monthEnd
    );
    const revPrev = num(
      `SELECT COALESCE(SUM(CAST(total AS REAL)), 0) AS v FROM invoices WHERE status != 'Draft' AND issue_date >= ? AND issue_date <= ?`,
      prevStart, prevEnd
    );
    const revDelta = revPrev > 0 ? Math.round(((revThis - revPrev) / revPrev) * 100) : (revThis > 0 ? 100 : 0);

    // Calls completed this month vs last month
    const completedThis = num(
      `SELECT COUNT(*) AS v FROM service_calls WHERE status = 'Completed' AND COALESCE(completed_date, call_date) >= ? AND COALESCE(completed_date, call_date) <= ? AND (is_test = 0 OR is_test IS NULL)`,
      monthStart, monthEnd
    );
    const completedPrev = num(
      `SELECT COUNT(*) AS v FROM service_calls WHERE status = 'Completed' AND COALESCE(completed_date, call_date) >= ? AND COALESCE(completed_date, call_date) <= ? AND (is_test = 0 OR is_test IS NULL)`,
      prevStart, prevEnd
    );
    const completedDelta = completedPrev > 0 ? Math.round(((completedThis - completedPrev) / completedPrev) * 100) : (completedThis > 0 ? 100 : 0);

    // Open calls now vs new calls in last 7 days (proxy for trend)
    const openNow = num(`SELECT COUNT(*) AS v FROM service_calls WHERE status != 'Completed' AND (is_test = 0 OR is_test IS NULL)`);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];
    const newCallsThisWeek = num(
      `SELECT COUNT(*) AS v FROM service_calls WHERE call_date >= ? AND (is_test = 0 OR is_test IS NULL)`,
      sevenDaysAgo
    );
    const completedThisWeek = num(
      `SELECT COUNT(*) AS v FROM service_calls WHERE status = 'Completed' AND COALESCE(completed_date, call_date) >= ? AND (is_test = 0 OR is_test IS NULL)`,
      sevenDaysAgo
    );
    // Net change in open calls this week (positive = improving / shrinking backlog)
    const openDelta = completedThisWeek - newCallsThisWeek;

    // First-time fix rate this month vs last month
    const ftfThis = sqlite.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM service_calls c WHERE c.parent_call_id = sc.id) THEN 1 ELSE 0 END) AS first_time
      FROM service_calls sc WHERE sc.status = 'Completed' AND COALESCE(sc.completed_date, sc.call_date) >= ? AND COALESCE(sc.completed_date, sc.call_date) <= ? AND (sc.is_test = 0 OR sc.is_test IS NULL)
    `).get(monthStart, monthEnd) as any;
    const ftfPrev = sqlite.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM service_calls c WHERE c.parent_call_id = sc.id) THEN 1 ELSE 0 END) AS first_time
      FROM service_calls sc WHERE sc.status = 'Completed' AND COALESCE(sc.completed_date, sc.call_date) >= ? AND COALESCE(sc.completed_date, sc.call_date) <= ? AND (sc.is_test = 0 OR sc.is_test IS NULL)
    `).get(prevStart, prevEnd) as any;
    const ftfThisRate = (ftfThis?.total ?? 0) > 0 ? Math.round((ftfThis.first_time / ftfThis.total) * 100) : 0;
    const ftfPrevRate = (ftfPrev?.total ?? 0) > 0 ? Math.round((ftfPrev.first_time / ftfPrev.total) * 100) : 0;
    const ftfDelta = ftfThisRate - ftfPrevRate;  // points

    // Pulse strip stats
    const callsToday = num(`SELECT COUNT(*) AS v FROM service_calls WHERE (scheduled_date = ? OR (scheduled_date IS NULL AND call_date = ?)) AND status != 'Completed' AND (is_test = 0 OR is_test IS NULL)`, today, today);
    const inProgress = num(`SELECT COUNT(*) AS v FROM service_calls WHERE status = 'In Progress' AND (is_test = 0 OR is_test IS NULL)`);
    const overdueInvoices = num(`SELECT COUNT(*) AS v FROM invoices WHERE status = 'Overdue'`);

    // 12-week sparkline data for revenue (weekly buckets)
    const sparkRevenue: number[] = [];
    for (let i = 11; i >= 0; i--) {
      const wkEnd = new Date(now.getTime() - i * 7 * 86400000);
      const wkStart = new Date(wkEnd.getTime() - 6 * 86400000);
      const ws = wkStart.toISOString().split("T")[0];
      const we = wkEnd.toISOString().split("T")[0];
      sparkRevenue.push(num(
        `SELECT COALESCE(SUM(CAST(total AS REAL)), 0) AS v FROM invoices WHERE status != 'Draft' AND issue_date >= ? AND issue_date <= ?`,
        ws, we
      ));
    }

    // 12-week sparkline data for completed calls
    const sparkCompleted: number[] = [];
    for (let i = 11; i >= 0; i--) {
      const wkEnd = new Date(now.getTime() - i * 7 * 86400000);
      const wkStart = new Date(wkEnd.getTime() - 6 * 86400000);
      const ws = wkStart.toISOString().split("T")[0];
      const we = wkEnd.toISOString().split("T")[0];
      sparkCompleted.push(num(
        `SELECT COUNT(*) AS v FROM service_calls WHERE status = 'Completed' AND COALESCE(completed_date, call_date) >= ? AND COALESCE(completed_date, call_date) <= ? AND (is_test = 0 OR is_test IS NULL)`,
        ws, we
      ));
    }

    // Outstanding balance
    const outstanding = num(`SELECT COALESCE(SUM(CAST(total AS REAL)), 0) AS v FROM invoices WHERE status IN ('Sent', 'Overdue')`);

    // Avg days to payment
    const payRows = sqlite.prepare(`SELECT paid_date, issue_date FROM invoices WHERE status = 'Paid' AND paid_date IS NOT NULL AND issue_date IS NOT NULL`).all() as any[];
    let avgDaysToPayment = 0;
    if (payRows.length > 0) {
      const totalDays = payRows.reduce((sum, r) => {
        const days = Math.max(0, Math.round((new Date(r.paid_date).getTime() - new Date(r.issue_date).getTime()) / 86400000));
        return sum + days;
      }, 0);
      avgDaysToPayment = Math.round(totalDays / payRows.length);
    }

    return {
      pulse: {
        date: today,
        callsToday,
        inProgress,
        overdueInvoices,
        revenueMTD: Math.round(revThis),
      },
      heroKPIs: {
        revenue: { value: Math.round(revThis), delta: revDelta, deltaLabel: "vs last month", spark: sparkRevenue },
        completed: { value: completedThis, delta: completedDelta, deltaLabel: "vs last month", spark: sparkCompleted },
        openCalls: { value: openNow, delta: openDelta, deltaLabel: openDelta > 0 ? "fewer than last week" : openDelta < 0 ? "more than last week" : "vs last week" },
        firstTimeFix: { value: ftfThisRate, delta: ftfDelta, deltaLabel: "pts vs last month" },
      },
      financial: {
        outstanding: Math.round(outstanding),
        avgDaysToPayment,
      },
    };
  }

  // ─── 90-Day Trend ──────────────────────────────────────────────────────────
  getDashboardTrend90Days(): Array<{ date: string; calls: number; revenue: number; completed: number }> {
    const now = new Date();
    const start = new Date(now.getTime() - 89 * 86400000);
    const startStr = start.toISOString().split("T")[0];

    // Get all calls created/scheduled in the last 90 days
    const callRows = sqlite.prepare(`
      SELECT call_date AS d, COUNT(*) AS cnt FROM service_calls
      WHERE call_date >= ? AND (is_test = 0 OR is_test IS NULL)
      GROUP BY call_date
    `).all(startStr) as any[];
    const callMap = new Map<string, number>();
    callRows.forEach(r => callMap.set(r.d, r.cnt));

    const completedRows = sqlite.prepare(`
      SELECT call_date AS d, COUNT(*) AS cnt FROM service_calls
      WHERE call_date >= ? AND status = 'Completed' AND (is_test = 0 OR is_test IS NULL)
      GROUP BY call_date
    `).all(startStr) as any[];
    const completedMap = new Map<string, number>();
    completedRows.forEach(r => completedMap.set(r.d, r.cnt));

    const revenueRows = sqlite.prepare(`
      SELECT issue_date AS d, COALESCE(SUM(CAST(total AS REAL)), 0) AS v FROM invoices
      WHERE issue_date >= ? AND status != 'Draft'
      GROUP BY issue_date
    `).all(startStr) as any[];
    const revMap = new Map<string, number>();
    revenueRows.forEach(r => revMap.set(r.d, r.v));

    const out: Array<{ date: string; calls: number; revenue: number; completed: number }> = [];
    for (let i = 0; i < 90; i++) {
      const d = new Date(start.getTime() + i * 86400000).toISOString().split("T")[0];
      out.push({
        date: d,
        calls: callMap.get(d) || 0,
        completed: completedMap.get(d) || 0,
        revenue: Math.round(revMap.get(d) || 0),
      });
    }
    return out;
  }

  // ─── Watchlist ──────────────────────────────────────────────────────────
  getDashboardWatchlist(): Array<{ kind: string; severity: string; title: string; subtitle: string; href: string; amount?: number; days?: number }> {
    const today = todayLocalISO();
    const out: Array<any> = [];

    // Overdue invoices
    const overdueInv = sqlite.prepare(`
      SELECT id, invoice_number, bill_to_name, total, due_date,
        CAST(julianday(?) - julianday(COALESCE(due_date, issue_date)) AS INTEGER) AS days_overdue
      FROM invoices WHERE status = 'Overdue' ORDER BY COALESCE(due_date, issue_date) ASC LIMIT 10
    `).all(today) as any[];
    for (const inv of overdueInv) {
      out.push({
        kind: "overdue-invoice",
        severity: inv.days_overdue > 30 ? "high" : "medium",
        title: `${inv.invoice_number} — ${inv.bill_to_name || "Unknown"}`,
        subtitle: `${inv.days_overdue} day${inv.days_overdue !== 1 ? "s" : ""} overdue`,
        amount: Math.round(parseMoney(inv.total)),
        days: inv.days_overdue,
        href: `/invoices/${inv.id}`,
      });
    }

    // Stalled calls — In Progress for over 7 days
    const stalled = sqlite.prepare(`
      SELECT id, customer_name, job_site_name, call_date,
        CAST(julianday(?) - julianday(call_date) AS INTEGER) AS days_open
      FROM service_calls
      WHERE status = 'In Progress' AND call_date <= date(?, '-7 days') AND (is_test = 0 OR is_test IS NULL)
      ORDER BY call_date ASC LIMIT 5
    `).all(today, today) as any[];
    for (const c of stalled) {
      out.push({
        kind: "stalled-call",
        severity: c.days_open > 14 ? "high" : "medium",
        title: `Call #${c.id} — ${c.customer_name || c.job_site_name || "Unknown"}`,
        subtitle: `In Progress for ${c.days_open} days`,
        days: c.days_open,
        href: `/calls/${c.id}`,
      });
    }

    // Overdue follow-ups
    const followUps = sqlite.prepare(`
      SELECT id, customer_name, job_site_name, follow_up_date,
        CAST(julianday(?) - julianday(follow_up_date) AS INTEGER) AS days_overdue
      FROM service_calls
      WHERE follow_up_date IS NOT NULL AND follow_up_date < ? AND status != 'Completed' AND (is_test = 0 OR is_test IS NULL)
      ORDER BY follow_up_date ASC LIMIT 5
    `).all(today, today) as any[];
    for (const c of followUps) {
      out.push({
        kind: "overdue-followup",
        severity: c.days_overdue > 14 ? "high" : "medium",
        title: `Follow-up overdue: ${c.customer_name || c.job_site_name || "Unknown"}`,
        subtitle: `${c.days_overdue} day${c.days_overdue !== 1 ? "s" : ""} past due`,
        days: c.days_overdue,
        href: `/calls/${c.id}`,
      });
    }

    // Repeat failures — equipment with 3+ calls
    const repeats = sqlite.prepare(`
      SELECT product_serial, customer_name, job_site_name, COUNT(*) AS cnt
      FROM service_calls
      WHERE product_serial IS NOT NULL AND product_serial != '' AND (is_test = 0 OR is_test IS NULL)
      GROUP BY product_serial
      HAVING cnt >= 3
      ORDER BY cnt DESC LIMIT 5
    `).all() as any[];
    for (const r of repeats) {
      out.push({
        kind: "repeat-failure",
        severity: r.cnt >= 5 ? "high" : "medium",
        title: `Repeat failure: ${r.product_serial}`,
        subtitle: `${r.cnt} service calls — ${r.customer_name || r.job_site_name || "Unknown"}`,
        href: `/equipment?q=${encodeURIComponent(r.product_serial)}`,
      });
    }

    // Sort: high severity first, then by days/amount
    out.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
      return (b.days || 0) - (a.days || 0);
    });

    return out.slice(0, 12);
  }
}

export const storage = new SQLiteStorage();
// Migration 19: Import 40 contacts from Fitzpatrick Sales customer list
{
  const existingCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM contacts WHERE company_name = 'Allreds Inc.'`).get() as any)?.c || 0;
  if (existingCount === 0) {
    console.log("Migration 19: Importing 40 contacts from Fitzpatrick Sales customer list...");
    const stmt = sqlite.prepare(`INSERT INTO contacts (contact_type, company_name, contact_name, phone, email, address, city, state, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
    stmt.run("wholesaler", "Allreds Inc.", "Allreds Inc.", "801-561-8300", null, "631 West Commerce Park Drive Midvale UT 84047", "Midvale", "UT", "Fax: 801-561-8383; ZIP: 84047");
    stmt.run("contractor", "All States Mechanical", "All States Mechanical", null, null, null, null, null, null);
    stmt.run("wholesaler", "Alpine Supply Company", "Alpine Supply Company", "(801) 768-8411", "aleda.gardner@alpinesc.com", "782 West State Street Lehi UT 84043 USA", "Lehi", "UT", "ZIP: 84043");
    stmt.run("wholesaler", "Appliance Parts Company", "Appliance Parts Company", null, "darcy@appliancepartscompany.com", "6825 South Kyrene Rd 102 Tempe AZ 85283", "Tempe", "AZ", "ZIP: 85283");
    stmt.run("wholesaler", "Applied Industrial Technologies, Inc.", "Applied Industrial Technologies, Inc.", null, "rgull@applied.com", "Applied Industrial Technologies, Inc. PO Box 93018 Cleveland Ohio 44101-5018", "Cleveland", "Ohio", "ZIP: 44101-5018");
    stmt.run("wholesaler", "BJ Plumbing", "BJ Plumbing", "(801) 224-6600", "ap@bjplumbingsupply.com", "968 North 1200 West Orem UT 84057", "Orem", "UT", "Fax: (801) 224-6242; ZIP: 84057");
    stmt.run("contractor", "Bowles Plumbing Inc.", "Bowles Plumbing Inc.", "(801) 699-2789", null, "14273 South Fort Pierce Way Herriman UT 84096", "Herriman", "UT", "ZIP: 84096");
    stmt.run("contractor", "Buss Mechanical Services, Inc.", "Buss Mechanical Services, Inc.", "(208) 562-0600", "marggie@bussmechanical.com", "PO Box 190476 Boise ID 83719-0476 USA", "Boise", "ID", "Fax: (208) 562-0555; ZIP: 83719-0476");
    stmt.run("contractor", "CL Wayman Piping, LLC", "CL Wayman Piping, LLC", null, null, "5565 West Leo Park RoadUt. West Jordan UT 84081", "West Jordan", "UT", "ZIP: 84081");
    stmt.run("wholesaler", "Commercial Kitchen Supply", "Commercial Kitchen Supply", "(801) 292-1611", "cksinvoice@commercialkitchensupply.com", "1030 W 650 N Centerville UT 84104", "Centerville", "UT", "ZIP: 84104");
    stmt.run("wholesaler", "Consolidated Supply, Co.", "Consolidated Supply, Co.", null, "trade@consolidatedsupply.com", "Consolidated Supply, Co. P.O. Box 5788 Portland Oregon 97228", "Portland", "Oregon", "ZIP: 97228");
    stmt.run("wholesaler", "Decker Plumbing Supply", "Decker Plumbing Supply", null, "apadvantage.haj@pnc.com", "Hajoca Corporation Service Center PO Box 951 Baton Rouge, Baton Rouge LA 70821-0951", "Baton Rouge", "LA", "ZIP: 70821-0951");
    stmt.run("wholesaler", "Durk's Plumbing Supply", "Durk's Plumbing Supply", null, null, "Durk's Plumbing Supply 1592 No. Main Street Layton Utah 84041 US", "Layton", "Utah", "ZIP: 84041");
    stmt.run("wholesaler", "Falls Plumbing Supply", "Falls Plumbing Supply", null, null, "525 East Anderson Idaho Falls ID 83401", "Idaho Falls", "ID", "ZIP: 83401");
    stmt.run("wholesaler", "Ferguson Enterprises", "Ferguson Enterprises", null, "sac266.vendorinvoices@ferguson.com", "Ferguson Enterprises PO Box 9285 Hampton Virginia 23670", "Hampton", "Virginia", "ZIP: 23670");
    stmt.run("wholesaler", "Great Western Plumbing Supply, Inc.", "Great Western Plumbing Supply, Inc.", "801-621-5412", "ap@gwsupply.com", "PO Box 6151 Ogden UT 84402", "Ogden", "UT", "Fax: 801-621-5417; ZIP: 84402");
    stmt.run("wholesaler", "Hajoca Corporation", "Hajoca Corporation", null, "vendorinvoices@hajoca.com", "Hajoca Corporation PO Box 842912 Boston Massachusetts 02284-2912", "Boston", "Massachusetts", "ZIP: 02284-2912");
    stmt.run("wholesaler", "HD Supply Waterworks", "HD Supply Waterworks", null, "wwapinventory@hdsupply.com", "P.O. Box 28446 St. Louis MO 63146", "St. Louis", "MO", "ZIP: 63146");
    stmt.run("wholesaler", "Heritage Landscape Supply Group", "Heritage Landscape Supply Group", "(214) 491-4149", "heritageinvoices@heritagelsg.com", "100 Enterprise Dr. STE 204 Rockaway NJ 07866 USA", "Rockaway", "NJ", "ZIP: 07866");
    stmt.run("wholesaler", "Idaho Industrial Supply Co.", "Idaho Industrial Supply Co.", null, null, "P.O. Box 7793Idaho Boise ID 83707", "Boise", "ID", "ZIP: 83707");
    stmt.run("wholesaler", "Jerry's Plumbing Specialties", "Jerry's Plumbing Specialties", null, "randyg@jpsonline.biz", "P.O. Box 1007 Ogden UT 84402-1007", "Ogden", "UT", "ZIP: 84402-1007");
    stmt.run("wholesaler", "Johnstone Supply", "Johnstone Supply", null, null, "PO Box 3010 Portland OR 97208 USA", "Portland", "OR", "ZIP: 97208");
    stmt.run("wholesaler", "Keller Supply", "Keller Supply", null, "ap@kellersupply.com", "Main OfficeP O Box 79014 Seattle WA 98119", "Seattle", "WA", "ZIP: 98119");
    stmt.run("contractor", "Mark McBride Plumbing, Inc.", "Mark McBride Plumbing, Inc.", "801-261-4462", null, "5944 South 350 EastUt Murray UT 84107", "Murray", "UT", "ZIP: 84107");
    stmt.run("wholesaler", "McCall Industrial Supply", "McCall Industrial Supply", null, null, "7614 West Lemhi #1Idaho Boise ID 83705", "Boise", "ID", "ZIP: 83705");
    stmt.run("wholesaler", "MLSC Holding Co., Inc", "MLSC Holding Co., Inc", null, "mlsap@mountainland.com", "MLSC Holding Co., Inc P.O. Box 190 Orem Utah 84059", "Orem", "Utah", "ZIP: 84059");
    stmt.run("wholesaler", "M-One Specialties", "M-One Specialties", null, "mone.payables@gmail.com", "974 West 100 South Salt Lake City UT 84115", "Salt Lake City", "UT", "ZIP: 84115");
    stmt.run("wholesaler", "Morcon Industrial Specialty, Inc.", "Morcon Industrial Specialty, Inc.", "(307) 789-6235", "ap@morcon-ind.com", "PO Box 1670 Evanston WY 82931-1670", "Evanston", "WY", "ZIP: 82931-1670");
    stmt.run("wholesaler", "Paramount Supply Co., Inc", "Paramount Supply Co., Inc", "(208) 345-5432", "accounts@paramountpipelc.com", "P.O. Box 5628 Boise ID 83705", "Boise", "ID", "Fax: (208) 338-9257; ZIP: 83705");
    stmt.run("wholesaler", "Peterson Plumbing Supply", "Peterson Plumbing Supply", null, "ap@petersonplumbingsupply.com", "Peterson Plumbing Supply c/o Marci Stubblefield 1036 N 1430 W Orem Utah 84057 USA", "Orem", "Utah", "ZIP: 84057");
    stmt.run("wholesaler", "Pipeco Inc.", "Pipeco Inc.", null, "ap@dbcirrigation.com", "8550 Chinden Blvd. Idaho Boise ID 83714", "Boise", "ID", "ZIP: 83714");
    stmt.run("wholesaler", "Pipe Valve & Fitting Co.", "Pipe Valve & Fitting Co.", null, null, "P.O. Box 65765 Salt Lake City UT 84115", "Salt Lake City", "UT", "ZIP: 84115");
    stmt.run("wholesaler", "Scholzen Products Co.", "Scholzen Products Co.", null, "ap@scholzens.com", "P.O. Box 628 Hurricane UT 84737", "Hurricane", "UT", "ZIP: 84737");
    stmt.run("contractor", "Schoonover Plumbing & Heating", "Schoonover Plumbing & Heating", "801-768-4021", null, "1530 N. State Street, Unit D Lehi UT 84043", "Lehi", "UT", "ZIP: 84043");
    stmt.run("contractor", "Shamrock Plumbing, LLC", "Shamrock Plumbing, LLC", "801-295-1690", null, "340 West 500 NorthUtah NSL UT 84054", "NSL", "UT", "Fax: 801-295-1699; ZIP: 84054");
    stmt.run("wholesaler", "Southwest Plumbing Supply", "Southwest Plumbing Supply", "(435) 586-6464", "ap@swplumb.com", "Southwest Plumbing Supply 506 N. 200 West Cedar City Utah 84721", "Cedar City", "Utah", "Fax: (435) 865-7200; ZIP: 84721");
    stmt.run("wholesaler", "Standard Plumbing Supply", "Standard Plumbing Supply", "(801) 255-7145", "abigail.ortiz@standardplumbing.com", "P O Box 708490 Sandy UT 84070", "Sandy", "UT", "ZIP: 84070");
    stmt.run("contractor", "Valley Plumbing", "Valley Plumbing", null, null, "5698 Dannon WaySuite #11 West Jordan UT 84081", "West Jordan", "UT", "ZIP: 84081");
    stmt.run("wholesaler", "Winston Water Cooler of Rigby, LP", "Winston Water Cooler of Rigby, LP", "(208) 709-9600", "acctg@winstonwatercooler.com", "6626 Oakbrrok Blvd. Dallas TX 75235", "Dallas", "TX", "ZIP: 75235");
    stmt.run("wholesaler", "WinWholesale", "WinWholesale", "(866) 351-3493", "apcentral@winwholesale.com", "3110 Kettering Blvd Dayton OH 45439", "Dayton", "OH", "ZIP: 45439");
    console.log("Migration 19: 40 contacts imported");
  }
}

// Migration 23: Insert TEST CUSTOMER contact
{
  const testExists = (sqlite.prepare(`SELECT COUNT(*) as c FROM contacts WHERE company_name = 'TEST CUSTOMER'`).get() as any)?.c || 0;
  if (testExists === 0) {
    sqlite.prepare(
      `INSERT INTO contacts (contact_type, company_name, contact_name, phone, email, address, city, state, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run("customer", "TEST CUSTOMER", "Test Account", "000-000-0000", "test@test.com", "123 Test Street", "Test City", "UT", "Test account — excluded from reports");
    console.log("Migration 23: TEST CUSTOMER contact inserted");
  }
}


