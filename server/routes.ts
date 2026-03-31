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
  });

  app.get("/api/auth/verify", (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (token && isValidSession(token)) {
      return res.json({ authenticated: true });
    }
    return res.status(401).json({ authenticated: false });
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

  app.get("/api/dashboard/recent", (_req, res) => {
    try {
      const calls = storage.getRecentServiceCalls(10);
      res.json(calls);
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
      // Geocode in background (don't block the response)
      geocodeAddress(data.jobSiteAddress, data.jobSiteCity, data.jobSiteState).then(coords => {
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
      const photo = storage.createPhoto(data);
      res.status(201).json(photo);
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed" });
      }
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

      for (const c of calls) {
        totalByStatus[c.status] = (totalByStatus[c.status] || 0) + 1;
        totalByClaimStatus[c.claimStatus] = (totalByClaimStatus[c.claimStatus] || 0) + 1;
        models.add(c.productModel);
        customers.add(c.customerName);
      }

      res.json({
        totalCalls: calls.length,
        totalByStatus,
        totalByClaimStatus,
        uniqueModels: models.size,
        uniqueCustomers: customers.size,
        dateRange: { from: dateFrom || null, to: dateTo || null },
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
        entry.models.set(c.productModel, (entry.models.get(c.productModel) || 0) + 1);
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
        entry.customers.add(c.customerName);
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
            model: c.productModel,
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
        "Hours on Job", "Miles Traveled",
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
          c.hoursOnJob, c.milesTraveled,
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

  // ─── Map & Geocoding ───────────────────────────────────────────────────────

  app.post("/api/geocode-all", async (_req, res) => {
    try {
      const calls = storage.getAllServiceCalls();
      let geocoded = 0;
      for (const call of calls) {
        if (!call.latitude && call.jobSiteAddress) {
          const coords = await geocodeAddress(call.jobSiteAddress, call.jobSiteCity, call.jobSiteState);
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

      const call3 = storage.createServiceCall({
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
