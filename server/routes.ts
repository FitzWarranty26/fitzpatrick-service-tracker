import type { Express } from "express";
import type { Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";
import { insertServiceCallSchema, insertPhotoSchema, insertPartSchema } from "@shared/schema";
import { z } from "zod";

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
    // Still do the comparison to keep constant time, but result is false
    crypto.timingSafeEqual(Buffer.from(a.padEnd(256, "\0")), Buffer.from(b.padEnd(256, "\0")));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function registerRoutes(httpServer: Server, app: Express) {
  // ─── Authentication ─────────────────────────────────────────────────────────

  const APP_PASSWORD = process.env.APP_PASSWORD || "fitzpatrick2026";

  app.post("/api/auth/login", (req, res) => {
    const ip = getClientIP(req);

    // Rate limiting: block after too many failed attempts
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
      return res.json({ success: true });
    }

    recordFailedLogin(ip);
    // Intentionally vague error message
    return res.status(401).json({ success: false, error: "Incorrect password" });
  });

  app.get("/api/auth/verify", (req, res) => {
    const authHeader = req.headers["x-app-password"] as string | undefined;
    if (authHeader && safeCompare(authHeader, APP_PASSWORD)) {
      return res.json({ authenticated: true });
    }
    return res.status(401).json({ authenticated: false });
  });

  // Middleware to protect all other API routes
  const requireAuth = (req: any, res: any, next: any) => {
    const authHeader = req.headers["x-app-password"] as string | undefined;
    if (authHeader && safeCompare(authHeader, APP_PASSWORD)) {
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
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/dashboard/recent", (_req, res) => {
    try {
      const calls = storage.getRecentServiceCalls(10);
      res.json(calls);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/service-calls", (req, res) => {
    try {
      const data = insertServiceCallSchema.parse(req.body);
      const call = storage.createServiceCall(data);
      res.status(201).json(call);
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: e.errors });
      }
      res.status(500).json({ error: e.message });
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
        return res.status(400).json({ error: "Validation failed", details: e.errors });
      }
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/service-calls/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      storage.deleteServiceCall(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
        return res.status(400).json({ error: "Validation failed", details: e.errors });
      }
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/photos/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      storage.deletePhoto(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
        return res.status(400).json({ error: "Validation failed", details: e.errors });
      }
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/parts/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      storage.deletePart(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Seed Data (development only) ────────────────────────────────────────────

  app.post("/api/seed", (_req, res) => {
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
      res.status(500).json({ error: e.message });
    }
  });
}
