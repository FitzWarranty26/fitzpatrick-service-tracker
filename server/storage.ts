import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, like, and, gte, lte, sql } from "drizzle-orm";
import {
  serviceCalls,
  photos,
  partsUsed,
  type ServiceCall,
  type InsertServiceCall,
  type Photo,
  type InsertPhoto,
  type Part,
  type InsertPart,
} from "@shared/schema";

const sqlite = new Database("warranty_tracker.db");
export const db = drizzle(sqlite);

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
`);

// ─── Migrations (safe to re-run) ─────────────────────────────────────────────
// Add new columns to existing tables without losing data.
// SQLite's ALTER TABLE ADD COLUMN is safe — it adds the column if missing.
// We check first to avoid errors on tables that already have the column.

function columnExists(table: string, column: string): boolean {
  const info = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return info.some(col => col.name === column);
}

// Migration 1: Add contact_email to service_calls
if (!columnExists("service_calls", "contact_email")) {
  sqlite.exec(`ALTER TABLE service_calls ADD COLUMN contact_email TEXT`);
  console.log("Migration: added contact_email column to service_calls");
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
    const calls = db.select().from(serviceCalls).orderBy(desc(serviceCalls.callDate)).all();
    
    let filtered = calls;
    if (filters) {
      if (filters.manufacturer) {
        filtered = filtered.filter(c => c.manufacturer === filters.manufacturer);
      }
      if (filters.status) {
        filtered = filtered.filter(c => c.status === filters.status);
      }
      if (filters.claimStatus) {
        filtered = filtered.filter(c => c.claimStatus === filters.claimStatus);
      }
      if (filters.city) {
        filtered = filtered.filter(c => c.jobSiteCity.toLowerCase().includes(filters.city!.toLowerCase()));
      }
      if (filters.state) {
        filtered = filtered.filter(c => c.jobSiteState === filters.state);
      }
      if (filters.search) {
        const s = filters.search.toLowerCase();
        filtered = filtered.filter(c =>
          c.customerName.toLowerCase().includes(s) ||
          c.jobSiteName.toLowerCase().includes(s) ||
          c.jobSiteCity.toLowerCase().includes(s) ||
          c.productModel.toLowerCase().includes(s) ||
          (c.productSerial && c.productSerial.toLowerCase().includes(s)) ||
          (c.contactName && c.contactName.toLowerCase().includes(s))
        );
      }
      if (filters.dateFrom) {
        filtered = filtered.filter(c => c.callDate >= filters.dateFrom!);
      }
      if (filters.dateTo) {
        filtered = filtered.filter(c => c.callDate <= filters.dateTo!);
      }
    }

    return filtered.map(call => {
      const photoCount = db.select({ count: sql<number>`count(*)` }).from(photos).where(eq(photos.serviceCallId, call.id)).get()?.count ?? 0;
      const partCount = db.select({ count: sql<number>`count(*)` }).from(partsUsed).where(eq(partsUsed.serviceCallId, call.id)).get()?.count ?? 0;
      return { ...call, photoCount, partCount };
    });
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
    const all = db.select().from(serviceCalls).all();
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-31`;

    return {
      totalCalls: all.length,
      openCalls: all.filter(c => c.status !== "Completed").length,
      completedThisMonth: all.filter(c => c.status === "Completed" && c.callDate >= monthStart && c.callDate <= monthEnd).length,
      pendingClaims: all.filter(c => c.claimStatus === "Submitted" || c.claimStatus === "Pending Review").length,
    };
  }

  getRecentServiceCalls(limit: number): ServiceCallWithCounts[] {
    const calls = db.select().from(serviceCalls).orderBy(desc(serviceCalls.callDate)).all().slice(0, limit);
    return calls.map(call => {
      const photoCount = db.select({ count: sql<number>`count(*)` }).from(photos).where(eq(photos.serviceCallId, call.id)).get()?.count ?? 0;
      const partCount = db.select({ count: sql<number>`count(*)` }).from(partsUsed).where(eq(partsUsed.serviceCallId, call.id)).get()?.count ?? 0;
      return { ...call, photoCount, partCount };
    });
  }
}

export const storage = new SQLiteStorage();
