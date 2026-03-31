import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Service Calls ───────────────────────────────────────────────────────────

export const serviceCalls = sqliteTable("service_calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  callDate: text("call_date").notNull(),
  manufacturer: text("manufacturer").notNull(),
  manufacturerOther: text("manufacturer_other"),
  customerName: text("customer_name").notNull(),
  jobSiteName: text("job_site_name").notNull(),
  jobSiteAddress: text("job_site_address").notNull(),
  jobSiteCity: text("job_site_city").notNull(),
  jobSiteState: text("job_site_state").notNull(), // "UT" | "ID"
  // Installing Contractor
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  // On-Site Contact (homeowner, facility manager, etc.)
  siteContactName: text("site_contact_name"),
  siteContactPhone: text("site_contact_phone"),
  siteContactEmail: text("site_contact_email"),
  productModel: text("product_model").notNull(),
  productSerial: text("product_serial"),
  installationDate: text("installation_date"),
  issueDescription: text("issue_description").notNull(),
  diagnosis: text("diagnosis"),
  resolution: text("resolution"),
  status: text("status").notNull().default("Scheduled"), // Scheduled | In Progress | Completed | Pending Parts | Escalated
  claimStatus: text("claim_status").notNull().default("Not Filed"), // Not Filed | Submitted | Approved | Denied | Pending Review
  claimNotes: text("claim_notes"),
  techNotes: text("tech_notes"),
  // Job logistics
  hoursOnJob: text("hours_on_job"),    // decimal as text, e.g. "2.5"
  milesTraveled: text("miles_traveled"), // decimal as text, e.g. "45"
  // Scheduling
  scheduledDate: text("scheduled_date"),  // ISO date string
  scheduledTime: text("scheduled_time"),  // e.g. "09:00" or "2:30 PM"
  latitude: text("latitude"),
  longitude: text("longitude"),
  parentCallId: integer("parent_call_id"),
  createdAt: text("created_at").notNull(),
});

export const insertServiceCallSchema = createInsertSchema(serviceCalls).omit({
  id: true,
  createdAt: true,
});

export type InsertServiceCall = z.infer<typeof insertServiceCallSchema>;
export type ServiceCall = typeof serviceCalls.$inferSelect;

// ─── Photos ──────────────────────────────────────────────────────────────────

export const photos = sqliteTable("photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  serviceCallId: integer("service_call_id").notNull(),
  photoUrl: text("photo_url").notNull(), // base64 data URL
  caption: text("caption"),
  photoType: text("photo_type").notNull().default("Other"), // Before | After | Product Label | Damage | Other
});

export const insertPhotoSchema = createInsertSchema(photos).omit({ id: true });
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photos.$inferSelect;

// ─── Parts Used ──────────────────────────────────────────────────────────────

export const partsUsed = sqliteTable("parts_used", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  serviceCallId: integer("service_call_id").notNull(),
  partNumber: text("part_number").notNull(),
  partDescription: text("part_description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  source: text("source"),
});

export const insertPartSchema = createInsertSchema(partsUsed).omit({ id: true });
export type InsertPart = z.infer<typeof insertPartSchema>;
export type Part = typeof partsUsed.$inferSelect;

// ─── Contacts ───────────────────────────────────────────────────────────

export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactType: text("contact_type").notNull(), // "customer" | "contractor" | "site_contact"
  companyName: text("company_name"),
  contactName: text("contact_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

// ─── Constants ───────────────────────────────────────────────────────────────

export const MANUFACTURERS = [
  "A.O. Smith Water Heaters",
  "American Water Heaters",
  "Powers Controls",
  "Sloan Valve Company",
  "State Water Heaters",
  "Watts ACV",
  "Watts Leak Defense",
  "Watts Water Technologies",
  "Other",
] as const;

export const SERVICE_STATUSES = [
  "Scheduled",
  "In Progress",
  "Completed",
  "Pending Parts",
  "Escalated",
] as const;

export const CLAIM_STATUSES = [
  "Not Filed",
  "Submitted",
  "Approved",
  "Denied",
  "Pending Review",
] as const;

export const PHOTO_TYPES = [
  "Before",
  "After",
  "Product Label",
  "Damage",
  "Other",
] as const;

export const JOB_STATES = ["UT", "ID"] as const;

export const WARRANTY_PERIODS: Record<string, number> = {
  "A.O. Smith Water Heaters": 6,
  "American Water Heaters": 6,
  "State Water Heaters": 6,
  "Powers Controls": 5,
  "Sloan Valve Company": 5,
  "Watts Water Technologies": 5,
  "Watts ACV": 5,
  "Watts Leak Defense": 5,
  "Other": 1,
};

export function getWarrantyStatus(installationDate: string | null | undefined, manufacturer: string): {
  status: "in-warranty" | "out-of-warranty" | "unknown";
  expiresDate: string | null;
  daysRemaining: number | null;
} {
  if (!installationDate) return { status: "unknown", expiresDate: null, daysRemaining: null };
  const years = WARRANTY_PERIODS[manufacturer] ?? 1;
  const install = new Date(installationDate);
  if (isNaN(install.getTime())) return { status: "unknown", expiresDate: null, daysRemaining: null };
  const expiry = new Date(install);
  expiry.setFullYear(expiry.getFullYear() + years);
  const now = new Date();
  const daysRemaining = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const expiresDate = expiry.toISOString().split("T")[0];
  if (daysRemaining > 0) {
    return { status: "in-warranty", expiresDate, daysRemaining };
  }
  return { status: "out-of-warranty", expiresDate, daysRemaining };
}
