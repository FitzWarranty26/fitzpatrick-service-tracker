import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
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
  productType: text("product_type"), // "Residential" | "Commercial" | "Tankless"
  installationDate: text("installation_date"),
  issueDescription: text("issue_description").notNull(),
  diagnosis: text("diagnosis"),
  resolution: text("resolution"),
  status: text("status").notNull().default("Scheduled"), // Scheduled | In Progress | Completed | Pending Parts | Escalated
  claimStatus: text("claim_status").notNull().default("Not Filed"), // Not Filed | Submitted | Approved | Denied | Pending Review
  claimNotes: text("claim_notes"),
  claimNumber: text("claim_number"),     // manufacturer's claim/reference number
  // Claim financials (all optional, stored as text for decimal precision)
  partsCost: text("parts_cost"),         // e.g. "125.50"
  laborCost: text("labor_cost"),         // e.g. "200.00"
  otherCost: text("other_cost"),         // mileage reimbursement, misc
  claimAmount: text("claim_amount"),     // total claim amount submitted/approved
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
  sortOrder: integer("sort_order").notNull().default(0),
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

// ─── Activity Log ──────────────────────────────────────────────────────────

export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  serviceCallId: integer("service_call_id").notNull(),
  note: text("note").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertActivityLogSchema = createInsertSchema(activityLog).omit({ id: true, createdAt: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLog.$inferSelect;

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

export const PRODUCT_TYPES = ["Residential", "Commercial", "Tankless"] as const;

// Water heater manufacturers
const WATER_HEATER_MANUFACTURERS = new Set([
  "A.O. Smith Water Heaters",
  "American Water Heaters",
  "State Water Heaters",
]);

// Warranty periods in years by manufacturer + product type
function getWarrantyYears(manufacturer: string, productType: string | null | undefined): number {
  // Water heater brands — warranty depends on product type
  if (WATER_HEATER_MANUFACTURERS.has(manufacturer)) {
    if (productType === "Tankless") return 15;
    if (productType === "Commercial") return 3;
    return 6; // Residential (default for water heaters)
  }
  // Sloan Valve Company — 3 year
  if (manufacturer === "Sloan Valve Company") return 3;
  // Watts brands & Powers Controls — 1 year
  if (
    manufacturer === "Watts Water Technologies" ||
    manufacturer === "Watts ACV" ||
    manufacturer === "Watts Leak Defense" ||
    manufacturer === "Powers Controls"
  ) return 1;
  // Other / unknown — 1 year
  return 1;
}

export function getWarrantyStatus(
  installationDate: string | null | undefined,
  manufacturer: string,
  productType?: string | null,
): {
  status: "in-warranty" | "out-of-warranty" | "unknown";
  expiresDate: string | null;
  daysRemaining: number | null;
  warrantyYears: number;
} {
  const years = getWarrantyYears(manufacturer, productType);
  if (!installationDate) return { status: "unknown", expiresDate: null, daysRemaining: null, warrantyYears: years };
  const install = new Date(installationDate);
  if (isNaN(install.getTime())) return { status: "unknown", expiresDate: null, daysRemaining: null, warrantyYears: years };
  const expiry = new Date(install);
  expiry.setFullYear(expiry.getFullYear() + years);
  const now = new Date();
  const daysRemaining = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const expiresDate = expiry.toISOString().split("T")[0];
  if (daysRemaining > 0) {
    return { status: "in-warranty", expiresDate, daysRemaining, warrantyYears: years };
  }
  return { status: "out-of-warranty", expiresDate, daysRemaining, warrantyYears: years };
}
