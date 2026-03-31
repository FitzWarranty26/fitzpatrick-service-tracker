import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import {
  serviceCalls,
  photos,
  partsUsed,
  contacts,
  type ServiceCall,
  type InsertServiceCall,
  type Photo,
  type InsertPhoto,
  type Part,
  type InsertPart,
  type Contact,
  type InsertContact,
} from "@shared/schema";

// Use persistent disk path on Render if available, otherwise local
const DB_PATH = process.env.DB_PATH || "warranty_tracker.db";
const sqlite = new Database(DB_PATH);
export const db = drizzle(sqlite);
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
    customer_name TEXT NOT NULL,
    job_site_name TEXT NOT NULL,
    job_site_address TEXT NOT NULL,
    job_site_city TEXT NOT NULL,
    job_site_state TEXT NOT NULL,
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    site_contact_name TEXT,
    site_contact_phone TEXT,
    site_contact_email TEXT,
    product_model TEXT NOT NULL,
    product_serial TEXT,
    installation_date TEXT,
    issue_description TEXT NOT NULL,
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
`);

// ─── Indexes for query performance ──────────────────────────────────────────
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_photos_service_call_id ON photos(service_call_id);
  CREATE INDEX IF NOT EXISTS idx_parts_service_call_id ON parts_used(service_call_id);
  CREATE INDEX IF NOT EXISTS idx_service_calls_call_date ON service_calls(call_date);
  CREATE INDEX IF NOT EXISTS idx_service_calls_status ON service_calls(status);
`);

// ─── Migrations (safe to re-run) ─────────────────────────────────────────────
// Add new columns to existing tables without losing data.
// SQLite's ALTER TABLE ADD COLUMN is safe — it adds the column if missing.
// We check first to avoid errors on tables that already have the column.

// Allow only known table names to prevent SQL injection
const ALLOWED_TABLES = new Set(["service_calls", "photos", "parts_used", "contacts"]);

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

export interface ServiceCallWithCounts extends ServiceCall {
  photoCount: number;
  partCount: number;
}

export interface ServiceCallFull extends ServiceCall {
  photos: Photo[];
  parts: Part[];
}

export interface DashboardStats {
  totalCalls: number;
  openCalls: number;
  completedThisMonth: number;
  pendingClaims: number;
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
      partsCost: row.parts_cost,
      laborCost: row.labor_cost,
      otherCost: row.other_cost,
      claimAmount: row.claim_amount,
      techNotes: row.tech_notes,
      hoursOnJob: row.hours_on_job,
      milesTraveled: row.miles_traveled,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
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
    const callPhotos = db.select().from(photos).where(eq(photos.serviceCallId, id)).all();
    const callParts = db.select().from(partsUsed).where(eq(partsUsed.serviceCallId, id)).all();
    return { ...call, photos: callPhotos, parts: callParts };
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

    const row = sqlite.prepare(`
      SELECT
        COUNT(*) AS total_calls,
        SUM(CASE WHEN status != 'Completed' THEN 1 ELSE 0 END) AS open_calls,
        SUM(CASE WHEN status = 'Completed' AND call_date >= ? AND call_date <= ? THEN 1 ELSE 0 END) AS completed_this_month,
        SUM(CASE WHEN claim_status IN ('Submitted', 'Pending Review') THEN 1 ELSE 0 END) AS pending_claims
      FROM service_calls
    `).get(monthStart, monthEnd) as any;

    return {
      totalCalls: row.total_calls ?? 0,
      openCalls: row.open_calls ?? 0,
      completedThisMonth: row.completed_this_month ?? 0,
      pendingClaims: row.pending_claims ?? 0,
    };
  }

  getRecentServiceCalls(limit: number): ServiceCallWithCounts[] {
    const rows = sqlite.prepare(`
      SELECT sc.*,
        (SELECT COUNT(*) FROM photos p WHERE p.service_call_id = sc.id) AS photo_count,
        (SELECT COUNT(*) FROM parts_used pu WHERE pu.service_call_id = sc.id) AS part_count
      FROM service_calls sc
      ORDER BY sc.call_date DESC
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
      partsCost: row.parts_cost,
      laborCost: row.labor_cost,
      otherCost: row.other_cost,
      claimAmount: row.claim_amount,
      techNotes: row.tech_notes,
      hoursOnJob: row.hours_on_job,
      milesTraveled: row.miles_traveled,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
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
      partsCost: row.parts_cost,
      laborCost: row.labor_cost,
      otherCost: row.other_cost,
      claimAmount: row.claim_amount,
      techNotes: row.tech_notes,
      hoursOnJob: row.hours_on_job,
      milesTraveled: row.miles_traveled,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
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
}

export const storage = new SQLiteStorage();
