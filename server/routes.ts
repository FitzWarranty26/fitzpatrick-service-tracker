import type { Express } from "express";
import type { Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";
import { insertServiceCallSchema, insertPhotoSchema, insertPartSchema, insertContactSchema } from "@shared/schema";
import { z } from "zod";

// Safe error response — never leak internal error details to the client
function safeError(e: any): string {
  if (e instanceof z.ZodError) return "Validation failed";
  if (process.env.NODE_ENV === "production") return "An error occurred";
  return e?.message || "An error occurred";
}

// ─── Rate Limiter (in-memory, no dependencies) ──────────────────────────────
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function getClientIP(req: any): string {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "unknown";
}

function isRateLimited(ip: string): boolean {
  const record = loginAttempts.get(ip);
  if (!record) return false;
  if (Date.now() > record.resetAt) {
    loginAttempts.delete(ip);
    return false;
  }
  return record.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(ip: string) {
  const record = loginAttempts.get(ip);
  if (!record || Date.now() > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: Date.now() + LOCKOUT_MINUTES * 60 * 1000 });
  } else {
    record.count++;
  }
}

function clearFailedLogins(ip: string) {
  loginAttempts.delete(ip);
}

// Timing-safe string comparison to prevent timing attacks
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.from(a.padEnd(256, "\0")), Buffer.from(b.padEnd(256, "\0")));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── Session Token Management ─────────────────────────────────────────────
const SESSION_EXPIRY_HOURS = 24;
const activeSessions = new Map<string, { createdAt: number; ip: string }>();

function createSessionToken(ip: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  activeSessions.set(token, { createdAt: Date.now(), ip });
  return token;
}

function isValidSession(token: string): boolean {
  const session = activeSessions.get(token);
  if (!session) return false;
  const age = Date.now() - session.createdAt;
  if (age > SESSION_EXPIRY_HOURS * 60 * 60 * 1000) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

// Clean expired sessions and stale rate-limit records every hour
setInterval(() => {
  const now = Date.now();
  const maxAge = SESSION_EXPIRY_HOURS * 60 * 60 * 1000;
  activeSessions.forEach((session, token) => {
    if (now - session.createdAt > maxAge) {
      activeSessions.delete(token);
    }
  });
  loginAttempts.forEach((record, ip) => {
    if (now > record.resetAt) {
      loginAttempts.delete(ip);
    }
  });
}, 60 * 60 * 1000);

// ─── Geocoding Helper ─────────────────────────────────────────────────────
async function geocodeAddress(address: string, city: string, state: string): Promise<{lat: string, lng: string} | null> {
  try {
    const query = encodeURIComponent(`${address}, ${city}, ${state}`);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`, {
      headers: { "User-Agent": "FitzpatrickServiceTracker/1.0" }
    });
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: data[0].lat, lng: data[0].lon };
    }
    return null;
  } catch { return null; }
}

export function registerRoutes(httpServer: Server, app: Express) {
  // ─── Authentication ─────────────────────────────────────────────────────────

  const APP_PASSWORD = process.env.APP_PASSWORD || "fitzpatrick2026";

  app.post("/api/auth/login", (req, res) => {
    try {
      const ip = getClientIP(req);

      if (isRateLimited(ip)) {
        return res.status(429).json({
          success: false,
          error: `Too many login attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
        });
      }

      const { password } = req.body;
      if (typeof password !== "string" || !password) {
        return res.status(400).json({ success: false, error: "Password required" });
      }

      if (safeCompare(password, APP_PASSWORD)) {
        clearFailedLogins(ip);
        const token = createSessionToken(ip);
        return res.json({ success: true, token });
      }

      recordFailedLogin(ip);
      return res.status(401).json({ success: false, error: "Incorrect password" });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: safeError(e) });
    }
  });

  app.get("/api/auth/verify", (req, res) => {
    try {
      const token = (req.headers.authorization || "").replace("Bearer ", "");
      if (token && isValidSession(token)) {
        return res.json({ authenticated: true });
      }
      return res.status(401).json({ authenticated: false });
    } catch (e: any) {
      return res.status(500).json({ authenticated: false, error: safeError(e) });
    }
  });

  // Middleware to protect all other API routes — Bearer token only
  const requireAuth = (req: any, res: any, next: any) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (token && isValidSession(token)) {
      return next();
    }
    return res.status(401).json({ error: "Unauthorized" });
  };

  // Apply auth middleware to all API routes except auth endpoints
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/auth")) return next();
    return requireAuth(req, res, next);
  });

  // ─── Dashboard ──────────────────────────────────────────────────────────────

  app.get("/api/dashboard/stats", (_req, res) => {
    try {
      const stats = storage.getDashboardStats();
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/dashboard/follow-ups", (_req, res) => {
    try {
      const calls = storage.getFollowUpsDue();
      res.json(calls);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/dashboard/recent", (_req, res) => {
    try {
      const calls = storage.getRecentServiceCalls(10);
      res.json(calls);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Global Search ──────────────────────────────────────────────────────────

  app.get("/api/search", (req, res) => {
    try {
      const q = req.query.q as string;
      if (!q || q.length < 2) return res.json({ calls: [], contacts: [], activities: [] });
      // Cap search length to prevent expensive LIKE queries
      if (q.length > 200) return res.status(400).json({ error: "Search query too long" });
      const results = storage.globalSearch(q);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Service Calls ──────────────────────────────────────────────────────────

  app.get("/api/service-calls", (req, res) => {
    try {
      const filters = {
        manufacturer: req.query.manufacturer as string | undefined,
        status: req.query.status as string | undefined,
        claimStatus: req.query.claimStatus as string | undefined,
        city: req.query.city as string | undefined,
        state: req.query.state as string | undefined,
        search: req.query.search as string | undefined,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
      };
      // Remove undefined filters
      Object.keys(filters).forEach(key => {
        if (!filters[key as keyof typeof filters]) delete filters[key as keyof typeof filters];
      });
      const calls = storage.getAllServiceCalls(Object.keys(filters).length ? filters : undefined);
      res.json(calls);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/service-calls/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const call = storage.getServiceCallById(id);
      if (!call) return res.status(404).json({ error: "Not found" });
      res.json(call);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.post("/api/service-calls", (req, res) => {
    try {
      const data = insertServiceCallSchema.parse(req.body);
      const call = storage.createServiceCall(data);

      // Auto-save contacts to directory (won't duplicate existing ones)
      try {
        // Customer
        if (data.customerName) {
          storage.findOrCreateContact("customer", data.customerName, {
            address: data.jobSiteAddress,
            city: data.jobSiteCity,
            state: data.jobSiteState,
          });
        }
        // Installing Contractor
        if (data.contactName) {
          storage.findOrCreateContact("contractor", data.contactName, {
            phone: data.contactPhone,
            email: data.contactEmail,
          });
        }
        // On-Site Contact
        if (data.siteContactName) {
          storage.findOrCreateContact("site_contact", data.siteContactName, {
            phone: data.siteContactPhone,
            email: data.siteContactEmail,
          });
        }
      } catch (e) {
        // Don't fail the call creation if contact saving fails
        console.error("Auto-save contacts error:", e);
      }

      // Geocode in background (don't block the response)
      geocodeAddress(data.jobSiteAddress || "", data.jobSiteCity || "", data.jobSiteState || "").then(coords => {
        if (coords) {
          storage.updateServiceCall(call.id, { latitude: coords.lat, longitude: coords.lng } as any);
        }
      });
      res.status(201).json(call);
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed" });
      }
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.patch("/api/service-calls/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const data = insertServiceCallSchema.partial().parse(req.body);
      const call = storage.updateServiceCall(id, data);
      if (!call) return res.status(404).json({ error: "Not found" });
      res.json(call);
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed" });
      }
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.delete("/api/service-calls/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      storage.deleteServiceCall(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Related Calls (Follow-up chain) ────────────────────────────────────────

  app.get("/api/service-calls/:id/related", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const related = storage.getRelatedCalls(id);
      res.json(related);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Contacts ──────────────────────────────────────────────────────────────

  app.get("/api/contacts/suggest", (req, res) => {
    try {
      const type = req.query.type as string;
      const q = req.query.q as string;
      if (!type || !q) return res.json([]);
      const results = storage.suggestContacts(type, q);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/contacts", (req, res) => {
    try {
      const filters: { type?: string; search?: string } = {};
      if (req.query.type) filters.type = req.query.type as string;
      if (req.query.search) filters.search = req.query.search as string;
      const contactsList = storage.getAllContacts(Object.keys(filters).length ? filters : undefined);
      res.json(contactsList);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/contacts/export", (req, res) => {
    try {
      const filters: { type?: string; search?: string } = {};
      if (req.query.type) filters.type = req.query.type as string;
      if (req.query.search) filters.search = req.query.search as string;
      const contactsList = storage.getAllContacts(Object.keys(filters).length ? filters : undefined);

      const headers = ["Type", "Company Name", "Contact Name", "Phone", "Email", "Address", "City", "State", "Notes"];
      const escapeCSV = (val: string | null | undefined): string => {
        if (val == null) return "";
        const s = String(val);
        if (s.includes('"') || s.includes(',') || s.includes('\n')) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      };

      const typeLabels: Record<string, string> = { customer: "Customer", contractor: "Contractor", site_contact: "Site Contact" };
      const rows = contactsList.map(c => [
        typeLabels[c.contactType] || c.contactType,
        c.companyName, c.contactName, c.phone, c.email,
        c.address, c.city, c.state, c.notes,
      ].map(v => escapeCSV(v)).join(","));

      const csv = [headers.join(","), ...rows].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=contacts-export.csv");
      res.send(csv);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/contacts/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const contact = storage.getContactById(id);
      if (!contact) return res.status(404).json({ error: "Not found" });
      res.json(contact);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.post("/api/contacts", (req, res) => {
    try {
      const data = insertContactSchema.parse(req.body);
      const contact = storage.createContact(data);
      res.status(201).json(contact);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Validation failed" });
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.patch("/api/contacts/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const data = insertContactSchema.partial().parse(req.body);
      const contact = storage.updateContact(id, data);
      if (!contact) return res.status(404).json({ error: "Not found" });
      res.json(contact);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Validation failed" });
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.delete("/api/contacts/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      storage.deleteContact(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Photos ─────────────────────────────────────────────────────────────────

  app.get("/api/service-calls/:id/photos", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const callPhotos = storage.getPhotosByServiceCallId(id);
      res.json(callPhotos);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.post("/api/service-calls/:id/photos", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const data = insertPhotoSchema.parse({ ...req.body, serviceCallId: id });
      // Only allow data: URLs for photos — reject external URLs that could be used for SSRF or tracking
      if (!data.photoUrl.startsWith("data:")) {
        return res.status(400).json({ error: "Photo must be a data URL" });
      }
      // Reject unreasonably large photos (>10MB base64)
      if (data.photoUrl.length > 10 * 1024 * 1024 * 1.37) {
        return res.status(400).json({ error: "Photo too large (max 10MB)" });
      }
      const photo = storage.createPhoto(data);
      res.status(201).json(photo);
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed" });
      }
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.put("/api/service-calls/:id/photos/reorder", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const { photoIds } = req.body;
      if (!Array.isArray(photoIds)) return res.status(400).json({ error: "photoIds array required" });
      // Validate every element is a finite integer to prevent injection or junk data
      for (let i = 0; i < photoIds.length; i++) {
        const pid = Number(photoIds[i]);
        if (!Number.isFinite(pid) || !Number.isInteger(pid) || pid < 1) {
          return res.status(400).json({ error: "photoIds must contain positive integers" });
        }
        storage.updatePhotoSortOrder(pid, i);
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.delete("/api/photos/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      storage.deletePhoto(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Parts ──────────────────────────────────────────────────────────────────

  app.get("/api/service-calls/:id/parts", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const parts = storage.getPartsByServiceCallId(id);
      res.json(parts);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.post("/api/service-calls/:id/parts", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const data = insertPartSchema.parse({ ...req.body, serviceCallId: id });
      const part = storage.createPart(data);
      res.status(201).json(part);
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed" });
      }
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.patch("/api/parts/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const data = insertPartSchema.partial().parse(req.body);
      const part = storage.updatePart(id, data);
      if (!part) return res.status(404).json({ error: "Not found" });
      res.json(part);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.delete("/api/parts/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      storage.deletePart(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Activity Log ──────────────────────────────────────────────────────────

  app.post("/api/service-calls/:id/activities", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const { note } = req.body;
      if (typeof note !== "string" || !note.trim()) {
        return res.status(400).json({ error: "Note is required" });
      }
      if (note.length > 10000) {
        return res.status(400).json({ error: "Note too long (max 10,000 characters)" });
      }
      const activity = storage.createActivity({ serviceCallId: id, note: note.trim() });
      res.status(201).json(activity);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.delete("/api/activities/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      storage.deleteActivity(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Analytics ──────────────────────────────────────────────────────────────

  app.get("/api/analytics/summary", (req, res) => {
    try {
      const { dateFrom, dateTo, manufacturer } = req.query as { dateFrom?: string; dateTo?: string; manufacturer?: string };
      const filters: any = {};
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;
      if (manufacturer) filters.manufacturer = manufacturer;
      const calls = storage.getAllServiceCalls(Object.keys(filters).length ? filters : undefined);

      const totalByStatus: Record<string, number> = {};
      const totalByClaimStatus: Record<string, number> = {};
      const models = new Set<string>();
      const customers = new Set<string>();

      let totalPartsCost = 0;
      let totalLaborCost = 0;
      let totalOtherCost = 0;
      let totalClaimAmount = 0;
      let totalHours = 0;
      let totalMiles = 0;

      // Monthly breakdown for hours/miles
      const monthlyLogistics = new Map<string, { hours: number; miles: number; calls: number }>();

      for (const c of calls) {
        totalByStatus[c.status] = (totalByStatus[c.status] || 0) + 1;
        totalByClaimStatus[c.claimStatus] = (totalByClaimStatus[c.claimStatus] || 0) + 1;
        if (c.productModel) models.add(c.productModel);
        if (c.customerName) customers.add(c.customerName);
        if (c.partsCost) totalPartsCost += parseFloat(c.partsCost) || 0;
        if (c.laborCost) totalLaborCost += parseFloat(c.laborCost) || 0;
        if (c.otherCost) totalOtherCost += parseFloat(c.otherCost) || 0;
        if (c.claimAmount) totalClaimAmount += parseFloat(c.claimAmount) || 0;
        const hrs = c.hoursOnJob ? parseFloat(c.hoursOnJob) || 0 : 0;
        const mi = c.milesTraveled ? parseFloat(c.milesTraveled) || 0 : 0;
        totalHours += hrs;
        totalMiles += mi;
        // Group by month
        const month = c.callDate.slice(0, 7); // "2026-03"
        if (!monthlyLogistics.has(month)) monthlyLogistics.set(month, { hours: 0, miles: 0, calls: 0 });
        const entry = monthlyLogistics.get(month)!;
        entry.hours += hrs;
        entry.miles += mi;
        entry.calls++;
      }

      const monthlyBreakdown = Array.from(monthlyLogistics.entries())
        .map(([month, data]) => ({
          month,
          hours: Math.round(data.hours * 100) / 100,
          miles: Math.round(data.miles * 100) / 100,
          calls: data.calls,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));

      res.json({
        totalCalls: calls.length,
        totalByStatus,
        totalByClaimStatus,
        uniqueModels: models.size,
        uniqueCustomers: customers.size,
        dateRange: { from: dateFrom || null, to: dateTo || null },
        financials: {
          totalPartsCost: Math.round(totalPartsCost * 100) / 100,
          totalLaborCost: Math.round(totalLaborCost * 100) / 100,
          totalOtherCost: Math.round(totalOtherCost * 100) / 100,
          totalClaimAmount: Math.round(totalClaimAmount * 100) / 100,
          totalCosts: Math.round((totalPartsCost + totalLaborCost + totalOtherCost) * 100) / 100,
        },
        logistics: {
          totalHours: Math.round(totalHours * 100) / 100,
          totalMiles: Math.round(totalMiles * 100) / 100,
          monthlyBreakdown,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/analytics/by-manufacturer", (req, res) => {
    try {
      const { dateFrom, dateTo, manufacturer } = req.query as { dateFrom?: string; dateTo?: string; manufacturer?: string };
      const filters: any = {};
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;
      if (manufacturer) filters.manufacturer = manufacturer;
      const calls = storage.getAllServiceCalls(Object.keys(filters).length ? filters : undefined);

      const mfgMap = new Map<string, { count: number; models: Map<string, number> }>();
      for (const c of calls) {
        if (!mfgMap.has(c.manufacturer)) {
          mfgMap.set(c.manufacturer, { count: 0, models: new Map() });
        }
        const entry = mfgMap.get(c.manufacturer)!;
        entry.count++;
        if (c.productModel) entry.models.set(c.productModel, (entry.models.get(c.productModel) || 0) + 1);
      }

      const result = Array.from(mfgMap.entries()).map(([manufacturer, data]) => ({
        manufacturer,
        count: data.count,
        models: Array.from(data.models.entries()).map(([model, count]) => ({ model, count })),
      }));
      result.sort((a, b) => b.count - a.count);

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/analytics/by-model", (req, res) => {
    try {
      const { dateFrom, dateTo, manufacturer } = req.query as { dateFrom?: string; dateTo?: string; manufacturer?: string };
      const filters: any = {};
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;
      if (manufacturer) filters.manufacturer = manufacturer;
      const calls = storage.getAllServiceCalls(Object.keys(filters).length ? filters : undefined);

      const modelMap = new Map<string, {
        manufacturer: string;
        count: number;
        serialNumbers: Set<string>;
        lastServiceDate: string;
        customers: Set<string>;
      }>();

      for (const c of calls) {
        const key = `${c.manufacturer}||${c.productModel}`;
        if (!modelMap.has(key)) {
          modelMap.set(key, {
            manufacturer: c.manufacturer,
            count: 0,
            serialNumbers: new Set(),
            lastServiceDate: c.callDate,
            customers: new Set(),
          });
        }
        const entry = modelMap.get(key)!;
        entry.count++;
        if (c.productSerial) entry.serialNumbers.add(c.productSerial);
        if (c.callDate > entry.lastServiceDate) entry.lastServiceDate = c.callDate;
        if (c.customerName) entry.customers.add(c.customerName);
      }

      const result = Array.from(modelMap.entries()).map(([key, data]) => ({
        manufacturer: data.manufacturer,
        model: key.split("||")[1] || "",
        count: data.count,
        serialNumbers: Array.from(data.serialNumbers),
        lastServiceDate: data.lastServiceDate,
        customers: Array.from(data.customers),
      }));
      result.sort((a, b) => b.count - a.count);

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/analytics/trends", (req, res) => {
    try {
      const { dateFrom, dateTo, manufacturer } = req.query as { dateFrom?: string; dateTo?: string; manufacturer?: string };
      const filters: any = {};
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;
      if (manufacturer) filters.manufacturer = manufacturer;
      const calls = storage.getAllServiceCalls(Object.keys(filters).length ? filters : undefined);

      const monthMap = new Map<string, { count: number; completed: number; open: number }>();
      for (const c of calls) {
        const month = c.callDate.slice(0, 7); // "2026-03"
        if (!monthMap.has(month)) {
          monthMap.set(month, { count: 0, completed: 0, open: 0 });
        }
        const entry = monthMap.get(month)!;
        entry.count++;
        if (c.status === "Completed") {
          entry.completed++;
        } else {
          entry.open++;
        }
      }

      const result = Array.from(monthMap.entries())
        .map(([month, data]) => ({ month, ...data }))
        .sort((a, b) => a.month.localeCompare(b.month));

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/analytics/repeat-failures", (req, res) => {
    try {
      const { dateFrom, dateTo, manufacturer } = req.query as { dateFrom?: string; dateTo?: string; manufacturer?: string };
      const filters: any = {};
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;
      if (manufacturer) filters.manufacturer = manufacturer;
      const calls = storage.getAllServiceCalls(Object.keys(filters).length ? filters : undefined);

      const modelMap = new Map<string, {
        model: string;
        manufacturer: string;
        count: number;
        serialNumbers: Set<string>;
      }>();

      for (const c of calls) {
        const key = `${c.manufacturer}||${c.productModel}`;
        if (!modelMap.has(key)) {
          modelMap.set(key, {
            model: c.productModel || "Unknown",
            manufacturer: c.manufacturer,
            count: 0,
            serialNumbers: new Set(),
          });
        }
        const entry = modelMap.get(key)!;
        entry.count++;
        if (c.productSerial) entry.serialNumbers.add(c.productSerial);
      }

      const result = Array.from(modelMap.values())
        .filter(e => e.count > 1)
        .map(e => ({
          model: e.model,
          manufacturer: e.manufacturer,
          count: e.count,
          serialNumbers: Array.from(e.serialNumbers),
        }))
        .sort((a, b) => b.count - a.count);

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/analytics/export", (req, res) => {
    try {
      const { dateFrom, dateTo, manufacturer } = req.query as { dateFrom?: string; dateTo?: string; manufacturer?: string };
      const filters: any = {};
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;
      if (manufacturer) filters.manufacturer = manufacturer;
      const calls = storage.getAllServiceCalls(Object.keys(filters).length ? filters : undefined);

      // Build CSV — fetch parts in bulk to avoid N+1 queries
      const headers = [
        "Call ID", "Date", "Scheduled Date", "Scheduled Time", "Manufacturer", "Customer", "Job Site",
        "Address", "City", "State", "Contractor Name", "Contractor Phone", "Site Contact",
        "Model", "Serial", "Install Date", "Status", "Claim Status",
        "Hours on Job", "Miles Traveled", "Claim Number",
        "Parts Cost", "Labor Cost", "Other Cost", "Claim Amount",
        "Issue", "Diagnosis", "Resolution", "Parts Used", "Tech Notes"
      ];

      const escapeCSV = (val: string | null | undefined): string => {
        if (val == null) return "";
        const s = String(val);
        if (s.includes('"') || s.includes(',') || s.includes('\n')) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      };

      // Pre-fetch all parts grouped by service call ID to avoid N+1
      const allParts = calls.length > 0
        ? calls.map(c => ({ id: c.id, parts: storage.getPartsByServiceCallId(c.id) }))
        : [];
      const partsMap = new Map(allParts.map(p => [p.id, p.parts]));

      const rows = calls.map(c => {
        const parts = partsMap.get(c.id) ?? [];
        const partsStr = parts.map(p => `${p.partDescription} (${p.partNumber}) x${p.quantity}`).join("; ");
        return [
          c.id, c.callDate, c.scheduledDate, c.scheduledTime,
          c.manufacturer, c.customerName, c.jobSiteName,
          c.jobSiteAddress, c.jobSiteCity, c.jobSiteState,
          c.contactName, c.contactPhone, c.siteContactName,
          c.productModel, c.productSerial, c.installationDate,
          c.status, c.claimStatus,
          c.hoursOnJob, c.milesTraveled, c.claimNumber,
          c.partsCost, c.laborCost, c.otherCost, c.claimAmount,
          c.issueDescription, c.diagnosis, c.resolution,
          partsStr, c.techNotes
        ].map(v => escapeCSV(v as any)).join(",");
      });

      const csv = [headers.join(","), ...rows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=service-calls-export.csv");
      res.send(csv);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Backfill contacts from existing service calls ─────────────────────────

  app.post("/api/contacts/backfill", (_req, res) => {
    try {
      const calls = storage.getAllServiceCalls();
      let created = 0;
      for (const call of calls) {
        // Customer
        if (call.customerName) {
          const c = storage.findOrCreateContact("customer", call.customerName, {
            address: call.jobSiteAddress,
            city: call.jobSiteCity,
            state: call.jobSiteState,
          });
          if (c) created++;
        }
        // Installing Contractor
        if (call.contactName) {
          const c = storage.findOrCreateContact("contractor", call.contactName, {
            phone: call.contactPhone,
            email: call.contactEmail,
          });
          if (c) created++;
        }
        // On-Site Contact
        if (call.siteContactName) {
          const c = storage.findOrCreateContact("site_contact", call.siteContactName, {
            phone: call.siteContactPhone,
            email: call.siteContactEmail,
          });
          if (c) created++;
        }
      }
      res.json({ message: `Processed ${calls.length} calls`, contactsProcessed: created });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Map & Geocoding ───────────────────────────────────────────────────────

  app.post("/api/geocode-all", async (_req, res) => {
    try {
      const calls = storage.getAllServiceCalls();
      let geocoded = 0;
      for (const call of calls) {
        if (!call.latitude && call.jobSiteAddress) {
          const coords = await geocodeAddress(call.jobSiteAddress || "", call.jobSiteCity || "", call.jobSiteState || "");
          if (coords) {
            storage.updateServiceCall(call.id, { latitude: coords.lat, longitude: coords.lng } as any);
            geocoded++;
          }
          // Respect Nominatim rate limit: 1 request per second
          await new Promise(r => setTimeout(r, 1100));
        }
      }
      res.json({ geocoded, total: calls.length });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/analytics/map-data", (req, res) => {
    try {
      const { dateFrom, dateTo, manufacturer, status } = req.query as {
        dateFrom?: string;
        dateTo?: string;
        manufacturer?: string;
        status?: string;
      };
      const filters: any = {};
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;
      if (manufacturer) filters.manufacturer = manufacturer;
      if (status) filters.status = status;
      const calls = storage.getAllServiceCalls(Object.keys(filters).length ? filters : undefined);
      const mapData = calls
        .filter(c => c.latitude && c.longitude)
        .map(c => ({
          id: c.id,
          lat: parseFloat(c.latitude!),
          lng: parseFloat(c.longitude!),
          manufacturer: c.manufacturer,
          status: c.status,
          customerName: c.customerName,
          jobSiteName: c.jobSiteName,
          jobSiteCity: c.jobSiteCity,
          jobSiteState: c.jobSiteState,
          productModel: c.productModel,
          callDate: c.callDate,
        }));
      res.json(mapData);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Reports ────────────────────────────────────────────────────────────────

  app.get("/api/reports/:type", (req, res) => {
    try {
      const reportType = req.params.type;
      const { dateFrom, dateTo, manufacturer, customer, claimStatus, minCount } = req.query as Record<string, string | undefined>;

      switch (reportType) {
        case "manufacturer-summary": {
          if (!manufacturer) return res.status(400).json({ error: "manufacturer is required" });
          const filters: any = { manufacturer };
          if (dateFrom) filters.dateFrom = dateFrom;
          if (dateTo) filters.dateTo = dateTo;
          const calls = storage.getAllServiceCalls(filters);

          const models = new Set<string>();
          const customers = new Set<string>();
          let totalPartsCost = 0, totalLaborCost = 0, totalClaimAmount = 0;

          for (const c of calls) {
            if (c.productModel) models.add(c.productModel);
            if (c.customerName) customers.add(c.customerName);
            if (c.partsCost) totalPartsCost += parseFloat(c.partsCost) || 0;
            if (c.laborCost) totalLaborCost += parseFloat(c.laborCost) || 0;
            if (c.claimAmount) totalClaimAmount += parseFloat(c.claimAmount) || 0;
          }

          return res.json({
            manufacturer,
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
            summary: {
              totalCalls: calls.length,
              uniqueModels: models.size,
              uniqueCustomers: customers.size,
              totalPartsCost: Math.round(totalPartsCost * 100) / 100,
              totalLaborCost: Math.round(totalLaborCost * 100) / 100,
              totalClaimAmount: Math.round(totalClaimAmount * 100) / 100,
            },
            calls: calls.map(c => ({
              id: c.id,
              callDate: c.callDate,
              customerName: c.customerName,
              jobSiteName: c.jobSiteName,
              productModel: c.productModel,
              productSerial: c.productSerial,
              status: c.status,
              claimStatus: c.claimStatus,
              claimNumber: c.claimNumber,
              partsCost: c.partsCost,
              laborCost: c.laborCost,
              claimAmount: c.claimAmount,
            })),
          });
        }

        case "monthly-expense": {
          const filters: any = {};
          if (dateFrom) filters.dateFrom = dateFrom;
          if (dateTo) filters.dateTo = dateTo;
          const calls = storage.getAllServiceCalls(Object.keys(filters).length ? filters : undefined);

          const monthMap = new Map<string, {
            calls: number; hours: number; miles: number;
            partsCost: number; laborCost: number; otherCost: number; claimAmount: number;
          }>();

          let totalHours = 0, totalMiles = 0, totalPartsCost = 0, totalLaborCost = 0, totalOtherCost = 0, totalClaimAmount = 0;

          for (const c of calls) {
            const month = c.callDate.slice(0, 7);
            if (!monthMap.has(month)) monthMap.set(month, { calls: 0, hours: 0, miles: 0, partsCost: 0, laborCost: 0, otherCost: 0, claimAmount: 0 });
            const entry = monthMap.get(month)!;
            entry.calls++;
            const hrs = c.hoursOnJob ? parseFloat(c.hoursOnJob) || 0 : 0;
            const mi = c.milesTraveled ? parseFloat(c.milesTraveled) || 0 : 0;
            const pc = c.partsCost ? parseFloat(c.partsCost) || 0 : 0;
            const lc = c.laborCost ? parseFloat(c.laborCost) || 0 : 0;
            const oc = c.otherCost ? parseFloat(c.otherCost) || 0 : 0;
            const ca = c.claimAmount ? parseFloat(c.claimAmount) || 0 : 0;
            entry.hours += hrs; entry.miles += mi;
            entry.partsCost += pc; entry.laborCost += lc; entry.otherCost += oc; entry.claimAmount += ca;
            totalHours += hrs; totalMiles += mi;
            totalPartsCost += pc; totalLaborCost += lc; totalOtherCost += oc; totalClaimAmount += ca;
          }

          const MILEAGE_RATE = 0.70;
          const months = Array.from(monthMap.entries())
            .map(([month, d]) => ({
              month,
              calls: d.calls,
              hours: Math.round(d.hours * 100) / 100,
              miles: Math.round(d.miles * 100) / 100,
              mileageCost: Math.round(d.miles * MILEAGE_RATE * 100) / 100,
              partsCost: Math.round(d.partsCost * 100) / 100,
              laborCost: Math.round(d.laborCost * 100) / 100,
              otherCost: Math.round(d.otherCost * 100) / 100,
              totalCosts: Math.round((d.partsCost + d.laborCost + d.otherCost + d.miles * MILEAGE_RATE) * 100) / 100,
              claimAmount: Math.round(d.claimAmount * 100) / 100,
            }))
            .sort((a, b) => a.month.localeCompare(b.month));

          const totalMileageCost = Math.round(totalMiles * MILEAGE_RATE * 100) / 100;
          const totalCosts = Math.round((totalPartsCost + totalLaborCost + totalOtherCost + totalMileageCost) * 100) / 100;

          return res.json({
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
            summary: {
              totalHours: Math.round(totalHours * 100) / 100,
              totalMiles: Math.round(totalMiles * 100) / 100,
              totalMileageCost,
              totalPartsCost: Math.round(totalPartsCost * 100) / 100,
              totalLaborCost: Math.round(totalLaborCost * 100) / 100,
              totalOtherCost: Math.round(totalOtherCost * 100) / 100,
              totalCosts,
              totalClaimAmount: Math.round(totalClaimAmount * 100) / 100,
              net: Math.round((totalClaimAmount - totalCosts) * 100) / 100,
            },
            months,
          });
        }

        case "customer-history": {
          if (!customer) return res.status(400).json({ error: "customer is required" });
          const filters: any = { search: customer };
          if (dateFrom) filters.dateFrom = dateFrom;
          if (dateTo) filters.dateTo = dateTo;
          // Get all calls, then filter by exact customer name
          const allCalls = storage.getAllServiceCalls(Object.keys(filters).length > 1 ? { dateFrom, dateTo } as any : undefined);
          const calls = allCalls.filter(c => (c.customerName || "").toLowerCase() === customer.toLowerCase());

          let totalPartsCost = 0, totalLaborCost = 0, totalClaimAmount = 0;
          for (const c of calls) {
            if (c.partsCost) totalPartsCost += parseFloat(c.partsCost) || 0;
            if (c.laborCost) totalLaborCost += parseFloat(c.laborCost) || 0;
            if (c.claimAmount) totalClaimAmount += parseFloat(c.claimAmount) || 0;
          }

          // Try to find contact info
          const contactResults = storage.getAllContacts({ type: "customer", search: customer });
          const contact = contactResults.find(c => c.contactName.toLowerCase() === customer.toLowerCase()) || contactResults[0] || null;

          return res.json({
            customer,
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
            contact: contact ? {
              contactName: contact.contactName,
              companyName: contact.companyName,
              phone: contact.phone,
              email: contact.email,
              address: contact.address,
              city: contact.city,
              state: contact.state,
            } : null,
            summary: {
              totalCalls: calls.length,
              totalPartsCost: Math.round(totalPartsCost * 100) / 100,
              totalLaborCost: Math.round(totalLaborCost * 100) / 100,
              totalClaimAmount: Math.round(totalClaimAmount * 100) / 100,
            },
            calls: calls.map(c => ({
              id: c.id,
              callDate: c.callDate,
              jobSiteName: c.jobSiteName,
              manufacturer: c.manufacturer,
              productModel: c.productModel,
              productSerial: c.productSerial,
              issueDescription: c.issueDescription,
              status: c.status,
              claimStatus: c.claimStatus,
              claimAmount: c.claimAmount,
            })),
          });
        }

        case "claim-status": {
          const filters: any = {};
          if (dateFrom) filters.dateFrom = dateFrom;
          if (dateTo) filters.dateTo = dateTo;
          if (manufacturer) filters.manufacturer = manufacturer;
          if (claimStatus && claimStatus !== "__all__") filters.claimStatus = claimStatus;
          const allCalls = storage.getAllServiceCalls(Object.keys(filters).length ? filters : undefined);

          // Default: show Submitted + Pending Review unless a specific status is requested or __all__
          const calls = (!claimStatus || claimStatus === "__default__")
            ? allCalls.filter(c => c.claimStatus === "Submitted" || c.claimStatus === "Pending Review")
            : allCalls;

          const now = new Date();
          const statusCounts: Record<string, { count: number; amount: number }> = {};

          const rows = calls.map(c => {
            const callDate = new Date(c.callDate + "T00:00:00");
            const daysPending = Math.ceil((now.getTime() - callDate.getTime()) / (1000 * 60 * 60 * 24));
            const amt = c.claimAmount ? parseFloat(c.claimAmount) || 0 : 0;

            if (!statusCounts[c.claimStatus]) statusCounts[c.claimStatus] = { count: 0, amount: 0 };
            statusCounts[c.claimStatus].count++;
            statusCounts[c.claimStatus].amount += amt;

            return {
              id: c.id,
              callDate: c.callDate,
              customerName: c.customerName,
              manufacturer: c.manufacturer,
              productModel: c.productModel,
              claimNumber: c.claimNumber,
              claimStatus: c.claimStatus,
              claimAmount: c.claimAmount,
              daysPending,
            };
          }).sort((a, b) => b.daysPending - a.daysPending);

          // Round amounts
          for (const key of Object.keys(statusCounts)) {
            statusCounts[key].amount = Math.round(statusCounts[key].amount * 100) / 100;
          }

          return res.json({
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
            manufacturer: manufacturer || null,
            statusCounts,
            calls: rows,
          });
        }

        case "product-failure": {
          const filters: any = {};
          if (dateFrom) filters.dateFrom = dateFrom;
          if (dateTo) filters.dateTo = dateTo;
          if (manufacturer) filters.manufacturer = manufacturer;
          const calls = storage.getAllServiceCalls(Object.keys(filters).length ? filters : undefined);

          const min = parseInt(minCount || "2") || 2;

          const modelMap = new Map<string, {
            manufacturer: string; model: string; count: number;
            serials: Set<string>; customers: Set<string>;
            lastDate: string; issues: Set<string>;
          }>();

          for (const c of calls) {
            const key = `${c.manufacturer}||${c.productModel}`;
            if (!modelMap.has(key)) {
              modelMap.set(key, {
                manufacturer: c.manufacturer, model: c.productModel || "Unknown",
                count: 0, serials: new Set(), customers: new Set(),
                lastDate: c.callDate, issues: new Set(),
              });
            }
            const entry = modelMap.get(key)!;
            entry.count++;
            if (c.productSerial) entry.serials.add(c.productSerial);
            if (c.customerName) entry.customers.add(c.customerName);
            if (c.callDate > entry.lastDate) entry.lastDate = c.callDate;
            if (c.issueDescription) entry.issues.add(c.issueDescription);
          }

          const models = Array.from(modelMap.values())
            .filter(e => e.count >= min)
            .map(e => ({
              manufacturer: e.manufacturer,
              model: e.model,
              count: e.count,
              uniqueSerials: e.serials.size,
              uniqueCustomers: e.customers.size,
              lastServiceDate: e.lastDate,
              issues: Array.from(e.issues),
            }))
            .sort((a, b) => b.count - a.count);

          return res.json({
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
            manufacturer: manufacturer || null,
            minCount: min,
            models,
          });
        }

        default:
          return res.status(400).json({ error: "Unknown report type" });
      }
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Seed Data (development only) ────────────────────────────────────────────

  app.post("/api/seed", (_req, res) => {
    // Disabled in production — no sample data injection
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }
    try {
      const calls = storage.getAllServiceCalls();
      if (calls.length > 0) {
        return res.json({ message: "Already seeded" });
      }
      // Seed a couple sample calls
      const call1 = storage.createServiceCall({
        callDate: "2026-03-20",
        manufacturer: "A.O. Smith Water Heaters",
        customerName: "Mountain West Plumbing Supply",
        jobSiteName: "Riverview Apartments Phase 2",
        jobSiteAddress: "1425 West Temple St",
        jobSiteCity: "Salt Lake City",
        jobSiteState: "UT",
        contactName: "Brad Sorensen",
        contactPhone: "801-555-0142",
        productModel: "HVHPT-50-240-PE",
        productSerial: "AOS2024031501",
        installationDate: "2025-11-10",
        issueDescription: "Unit not heating — pilot light won't stay lit. Residents reporting cold water for 3 days.",
        diagnosis: "Faulty thermocouple. Pilot assembly shows signs of premature wear.",
        resolution: "Replaced thermocouple and pilot assembly. Tested for 30 minutes. Unit operating normally.",
        status: "Completed",
        claimStatus: "Submitted",
        claimNotes: "Claim submitted 3/22/26. Awaiting approval from AO Smith warranty dept.",
        techNotes: "Unit is in a tight mechanical room. Access panel rusted — owner should address.",
      });

      const call2 = storage.createServiceCall({
        callDate: "2026-03-22",
        manufacturer: "Watts Water Technologies",
        customerName: "Hansen Plumbing LLC",
        jobSiteName: "Provo Medical Center Expansion",
        jobSiteAddress: "500 North University Ave",
        jobSiteCity: "Provo",
        jobSiteState: "UT",
        contactName: "Jill Torres",
        contactPhone: "801-555-0298",
        productModel: "RV-M12-LF",
        productSerial: "WWT202503220",
        installationDate: "2026-01-15",
        issueDescription: "Pressure reducing valve leaking at union connection. Building owner noticed water damage.",
        diagnosis: "Union gasket degraded — possibly installed without thread sealant.",
        resolution: null,
        status: "Pending Parts",
        claimStatus: "Not Filed",
        claimNotes: null,
        techNotes: "Replacement union kit on order. Estimated 3-5 day lead time from Utah Pipe & Supply.",
      });

      storage.createServiceCall({
        callDate: "2026-03-24",
        manufacturer: "State Water Heaters",
        customerName: "Desert Sun Construction",
        jobSiteName: "New Single-Family Warranty Call",
        jobSiteAddress: "842 Cottonwood Canyon Rd",
        jobSiteCity: "Boise",
        jobSiteState: "ID",
        contactName: "Mike Petersen",
        contactPhone: "208-555-0177",
        productModel: "GPX-50-YBVIT",
        productSerial: "SWH2025120412",
        installationDate: "2025-12-04",
        issueDescription: "Water heater not reaching set temperature. Customer reports lukewarm at best.",
        diagnosis: null,
        resolution: null,
        status: "Scheduled",
        claimStatus: "Not Filed",
        claimNotes: null,
        techNotes: null,
      });

      // Add parts to call 1
      storage.createPart({ serviceCallId: call1.id, partNumber: "9004450005", partDescription: "Thermocouple Assembly, 24\"", quantity: 1, source: "A.O. Smith Parts Warehouse" });
      storage.createPart({ serviceCallId: call1.id, partNumber: "9004454005", partDescription: "Pilot Assembly Kit", quantity: 1, source: "A.O. Smith Parts Warehouse" });

      // Add parts to call 2
      storage.createPart({ serviceCallId: call2.id, partNumber: "RV-M12-UK", partDescription: "Union Kit with Gasket Set", quantity: 1, source: "Utah Pipe & Supply — On Order" });

      res.json({ message: "Seeded successfully", count: 3 });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });
}
