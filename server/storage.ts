import { drizzle } from "drizzle-orm/better-sqlite3";
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
const ALLOWED_TABLES = new Set(["service_calls", "photos", "parts_used", "contacts", "activity_log", "users", "audit_log_system"]);

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

    // Single query with subqueries for counts — eliminates N+1 pattern
    const query = `
      SELECT sc.*,
        (SELECT COUNT(*) FROM photos p WHERE p.service_call_id = sc.id) AS photo_count,
        (SELECT COUNT(*) FROM parts_used pu WHERE pu.service_call_id = sc.id) AS part_count
      FROM service_calls sc
      ${whereClause}
      ORDER BY sc.call_date DESC
    `;

    const rows = sqlite.prepare(query).all(...params) as any[];

    // Map snake_case SQL result to camelCase TypeScript types
    return rows.map(row => ({
      id: row.id,
      callDate: row.call_date,
      manufacturer: row.manufacturer,
      manufacturerOther: row.manufacturer_other,
      customerName: row.customer_name,
      jobSiteName: row.job_site_name,
      jobSiteAddress: row.job_site_address,
      jobSiteCity: row.job_site_city,
      jobSiteState: row.job_site_state,
      contactName: row.contact_name,
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
      createdAt: row.created_at,
      photoCount: row.photo_count,
      partCount: row.part_count,
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
    return db.update(serviceCalls).set(call).where(eq(serviceCalls.id, id)).returning().get();
  }

  deleteServiceCall(id: number): void {
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
    return db.insert(photos).values(photo).returning().get();
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
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-31`;

    const today = now.toISOString().split("T")[0];

    const row = sqlite.prepare(`
      SELECT
        COUNT(*) AS total_calls,
        SUM(CASE WHEN status != 'Completed' THEN 1 ELSE 0 END) AS open_calls,
        SUM(CASE WHEN status = 'Completed' AND call_date >= ? AND call_date <= ? THEN 1 ELSE 0 END) AS completed_this_month,
        SUM(CASE WHEN claim_status IN ('Submitted', 'Pending Review') THEN 1 ELSE 0 END) AS pending_claims,
        SUM(CASE WHEN follow_up_date IS NOT NULL AND follow_up_date <= ? AND status != 'Completed' THEN 1 ELSE 0 END) AS follow_ups_due
      FROM service_calls
    `).get(monthStart, monthEnd, today) as any;

    return {
      totalCalls: row.total_calls ?? 0,
      openCalls: row.open_calls ?? 0,
      completedThisMonth: row.completed_this_month ?? 0,
      pendingClaims: row.pending_claims ?? 0,
      followUpsDue: row.follow_ups_due ?? 0,
    };
  }

  getRecentServiceCalls(limit: number): ServiceCallWithCounts[] {
    const rows = sqlite.prepare(`
      SELECT sc.*,
        (SELECT COUNT(*) FROM photos p WHERE p.service_call_id = sc.id) AS photo_count,
        (SELECT COUNT(*) FROM parts_used pu WHERE pu.service_call_id = sc.id) AS part_count
      FROM service_calls sc
      ORDER BY
        CASE WHEN sc.scheduled_date IS NULL THEN 1 ELSE 0 END,
        sc.scheduled_date DESC,
        sc.scheduled_time DESC,
        sc.call_date DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(row => ({
      id: row.id,
      callDate: row.call_date,
      manufacturer: row.manufacturer,
      manufacturerOther: row.manufacturer_other,
      customerName: row.customer_name,
      jobSiteName: row.job_site_name,
      jobSiteAddress: row.job_site_address,
      jobSiteCity: row.job_site_city,
      jobSiteState: row.job_site_state,
      contactName: row.contact_name,
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
      createdAt: row.created_at,
      photoCount: row.photo_count,
      partCount: row.part_count,
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
      callDate: row.call_date,
      manufacturer: row.manufacturer,
      manufacturerOther: row.manufacturer_other,
      customerName: row.customer_name,
      jobSiteName: row.job_site_name,
      jobSiteAddress: row.job_site_address,
      jobSiteCity: row.job_site_city,
      jobSiteState: row.job_site_state,
      contactName: row.contact_name,
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
      createdAt: row.created_at,
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
    const today = new Date().toISOString().split("T")[0];
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
      callDate: row.call_date,
      manufacturer: row.manufacturer,
      manufacturerOther: row.manufacturer_other,
      customerName: row.customer_name,
      jobSiteName: row.job_site_name,
      jobSiteAddress: row.job_site_address,
      jobSiteCity: row.job_site_city,
      jobSiteState: row.job_site_state,
      contactName: row.contact_name,
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
      createdAt: row.created_at,
      photoCount: row.photo_count,
      partCount: row.part_count,
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
    const year = new Date().getFullYear();
    const row = sqlite.prepare(`SELECT COUNT(*) as count FROM invoices WHERE invoice_number LIKE ?`).get(`INV-${year}-%`) as any;
    const seq = String((row.count || 0) + 1).padStart(3, "0");
    return `INV-${year}-${seq}`;
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

  // Invoice items
  createInvoiceItem(data: InsertInvoiceItem): InvoiceItem {
    const row = sqlite.prepare(`
      INSERT INTO invoice_items (invoice_id, type, description, quantity, unit_price, amount, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *
    `).get(data.invoiceId, data.type, data.description, data.quantity, data.unitPrice, data.amount, data.sortOrder || 0) as any;
    return this.mapItemRow(row);
  }

  updateInvoiceItem(id: number, data: Partial<InsertInvoiceItem>): InvoiceItem | undefined {
    const allowed = ["type","description","quantity","unitPrice","amount","sortOrder"];
    const colMap: Record<string,string> = { type:"type", description:"description", quantity:"quantity", unitPrice:"unit_price", amount:"amount", sortOrder:"sort_order" };
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
}

export const storage = new SQLiteStorage();
