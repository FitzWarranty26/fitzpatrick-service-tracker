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
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
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
