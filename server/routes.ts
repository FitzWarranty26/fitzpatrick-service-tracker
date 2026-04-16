import type { Express } from "express";
import express from "express";
import type { Server } from "http";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { storage, sqlite as sqliteHandle, DB_PATH } from "./storage";
import { insertServiceCallSchema, insertPhotoSchema, insertPartSchema, insertContactSchema, getWarrantyStatus } from "@shared/schema";
import { z } from "zod";

// Safe error response — never leak internal error details to the client
function safeError(e: any): string {
  if (e instanceof z.ZodError) return "Validation failed";
  if (process.env.NODE_ENV === "production") return "An error occurred";
  return e?.message || "An error occurred";
}

// ─── Rate Limiter (in-memory, no dependencies) ──────────────────────────────

// General API rate limit: 300 requests per minute per IP
// Blocks automated hammering while allowing normal app usage
const apiRequestCounts = new Map<string, { count: number; windowStart: number }>();
const API_RATE_LIMIT = 300;
const API_RATE_WINDOW_MS = 60 * 1000; // 1 minute

function isApiRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = apiRequestCounts.get(ip);
  if (!record || now - record.windowStart > API_RATE_WINDOW_MS) {
    apiRequestCounts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  record.count++;
  return record.count > API_RATE_LIMIT;
}

// Clean up the API rate limit map every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - API_RATE_WINDOW_MS;
  apiRequestCounts.forEach((record, ip) => {
    if (record.windowStart < cutoff) apiRequestCounts.delete(ip);
  });
}, 5 * 60 * 1000);

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
interface SessionData {
  createdAt: number;
  ip: string;
  userId: number;
  username: string;
  role: string;
}
const activeSessions = new Map<string, SessionData>();

function createSessionToken(ip: string, user: { id: number; username: string; role: string }): string {
  const token = crypto.randomBytes(32).toString("hex");
  activeSessions.set(token, { createdAt: Date.now(), ip, userId: user.id, username: user.username, role: user.role });
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

function getSessionUser(token: string): SessionData | null {
  const session = activeSessions.get(token);
  if (!session) return null;
  const age = Date.now() - session.createdAt;
  if (age > SESSION_EXPIRY_HOURS * 60 * 60 * 1000) {
    activeSessions.delete(token);
    return null;
  }
  return session;
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

  app.post("/api/auth/login", (req, res) => {
    try {
      const ip = getClientIP(req);

      if (isRateLimited(ip)) {
        return res.status(429).json({
          success: false,
          error: `Too many login attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
        });
      }

      const { username, password } = req.body;
      if (typeof username !== "string" || !username || typeof password !== "string" || !password) {
        return res.status(400).json({ success: false, error: "Username and password required" });
      }

      const user = storage.getUserByUsername(username);
      if (!user || !user.active) {
        recordFailedLogin(ip);
        storage.createAuditEntry({ userId: null, username: username, action: "login_failed", details: "Unknown user or inactive" });
        return res.status(401).json({ success: false, error: "Invalid username or password" });
      }

      if (!storage.verifyPassword(password, user.password)) {
        recordFailedLogin(ip);
        storage.createAuditEntry({ userId: user.id, username: user.username, action: "login_failed", details: "Wrong password" });
        return res.status(401).json({ success: false, error: "Invalid username or password" });
      }

      clearFailedLogins(ip);
      const token = createSessionToken(ip, { id: user.id, username: user.username, role: user.role });
      storage.createAuditEntry({ userId: user.id, username: user.username, action: "login" });
      return res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        },
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: safeError(e) });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    try {
      const token = (req.headers.authorization || "").replace("Bearer ", "");
      if (token) activeSessions.delete(token);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/auth/verify", (req, res) => {
    try {
      const token = (req.headers.authorization || "").replace("Bearer ", "");
      const session = token ? getSessionUser(token) : null;
      if (session) {
        return res.json({
          authenticated: true,
          user: { id: session.userId, username: session.username, role: session.role },
        });
      }
      return res.status(401).json({ authenticated: false });
    } catch (e: any) {
      return res.status(500).json({ authenticated: false, error: safeError(e) });
    }
  });

  // Middleware to protect all other API routes — Bearer token only
  // Attach user info to every authenticated request
  const requireAuth = (req: any, res: any, next: any) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const session = token ? getSessionUser(token) : null;
    if (session) {
      req.user = { id: session.userId, username: session.username, role: session.role };
      return next();
    }
    return res.status(401).json({ error: "Unauthorized" });
  };

  // Manager-only middleware
  const requireManager = (req: any, res: any, next: any) => {
    if (req.user?.role !== "manager") {
      return res.status(403).json({ error: "Manager access required" });
    }
    return next();
  };

  // Manager or Tech middleware (not staff)
  const requireEditor = (req: any, res: any, next: any) => {
    if (req.user?.role === "staff") {
      return res.status(403).json({ error: "Edit access required" });
    }
    return next();
  };

  // Helper to log audit entries from route handlers
  function logAudit(req: any, action: string, entityType?: string, entityId?: number, details?: string) {
    try {
      storage.createAuditEntry({
        userId: req.user?.id || null,
        username: req.user?.username || "system",
        action,
        entityType,
        entityId,
        details,
      });
    } catch (e) {
      console.error("[audit] Failed to log:", e);
    }
  }

  // Apply auth middleware to all API routes except auth and backup endpoints
  // (backup routes have their own requireBackupAuth middleware)
  // Also apply general rate limiting to all API routes
  app.use("/api", (req, res, next) => {
    const ip = getClientIP(req);
    if (isApiRateLimited(ip)) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }
    if (req.path.startsWith("/auth")) return next();
    if (req.path.startsWith("/backup")) return next();
    return requireAuth(req, res, next);
  });

  // ─── Password Change ──────────────────────────────────────────────────────
  app.post("/api/auth/change-password", requireAuth, (req: any, res: any) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current and new password required" });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      const user = storage.getUserById(req.user.id);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!storage.verifyPassword(currentPassword, user.password)) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
      storage.updateUser(user.id, { password: newPassword, mustChangePassword: 0 });
      logAudit(req, "password_changed", "user", user.id);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── User Management (Manager Only) ───────────────────────────────────────

  // Lightweight names list — any authenticated user can read (used for dropdowns)
  app.get("/api/users/names", (req: any, res: any) => {
    try {
      const rows = storage.getAllUsers().filter((u: any) => u.active);
      res.json(rows.map((u: any) => ({ id: u.id, displayName: u.displayName, role: u.role })));
    } catch (e: any) { res.status(500).json({ error: safeError(e) }); }
  });

  app.get("/api/users", requireManager, (_req, res) => {
    try {
      const users = storage.getAllUsers();
      res.json(users);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.post("/api/users", requireManager, (req, res) => {
    try {
      const { username, password, displayName, email, role } = req.body;
      if (!username || !password || !displayName || !role) {
        return res.status(400).json({ error: "Username, password, display name, and role are required" });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      if (!["manager", "tech", "sales", "staff"].includes(role)) {
        return res.status(400).json({ error: "Role must be manager, tech, sales, or staff" });
      }
      const existing = storage.getUserByUsername(username);
      if (existing) return res.status(409).json({ error: "Username already exists" });
      const user = storage.createUser({ username, password, displayName, email, role });
      logAudit(req, "created_user", "user", user.id, JSON.stringify({ username, displayName, role }));
      res.status(201).json(user);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.patch("/api/users/:id", requireManager, (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const { displayName, email, role, active, password } = req.body;
      const updates: any = {};
      if (displayName !== undefined) updates.displayName = displayName;
      if (email !== undefined) updates.email = email;
      if (role !== undefined) {
        if (!["manager", "tech", "sales", "staff"].includes(role)) {
          return res.status(400).json({ error: "Role must be manager, tech, sales, or staff" });
        }
        updates.role = role;
      }
      if (active !== undefined) updates.active = active ? 1 : 0;
      if (password !== undefined) {
        if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
        updates.password = password;
      }
      const user = storage.updateUser(id, updates);
      if (!user) return res.status(404).json({ error: "User not found" });
      const action = active === 0 ? "deactivated_user" : "edited_user";
      logAudit(req, action, "user", id, JSON.stringify(updates));
      // If this user has active sessions and was deactivated, invalidate them
      if (active === 0 || active === false) {
        activeSessions.forEach((session, token) => {
          if (session.userId === id) activeSessions.delete(token);
        });
      }
      res.json(user);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.delete("/api/users/:id", requireManager, (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      // Cannot delete yourself
      if (req.user?.id === id) {
        return res.status(400).json({ error: "You cannot delete your own account" });
      }

      const target = storage.getUserById(id);
      if (!target) return res.status(404).json({ error: "User not found" });

      // Cannot delete the last active manager
      if (target.role === "manager") {
        const allUsers = storage.getAllUsers();
        const activeManagers = allUsers.filter((u: any) => u.role === "manager" && u.active && u.id !== id);
        if (activeManagers.length === 0) {
          return res.status(400).json({ error: "Cannot delete the last manager account" });
        }
      }

      // Invalidate any active sessions for this user
      activeSessions.forEach((session, token) => {
        if (session.userId === id) activeSessions.delete(token);
      });

      logAudit(req, "deleted_user", "user", id, JSON.stringify({ username: target.username, displayName: target.displayName, role: target.role }));
      storage.deleteUser(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── System Audit Log (Manager Only) ──────────────────────────────────────

  app.get("/api/audit-log", requireManager, (req, res) => {
    try {
      const filters: any = {};
      if (req.query.userId) filters.userId = parseInt(req.query.userId as string);
      if (req.query.action) filters.action = req.query.action;
      if (req.query.entityType) filters.entityType = req.query.entityType;
      if (req.query.limit) filters.limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      if (req.query.offset) filters.offset = parseInt(req.query.offset as string) || 0;
      const result = storage.getAuditLog(filters);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
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

  app.post("/api/service-calls", requireEditor, (req, res) => {
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
      logAudit(req, "created_call", "service_call", call.id, `${data.customerName || ""} - ${data.manufacturer}`);
      res.status(201).json(call);
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed" });
      }
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.patch("/api/service-calls/:id", requireEditor, (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const data = insertServiceCallSchema.partial().parse(req.body);
      const call = storage.updateServiceCall(id, data);
      if (!call) return res.status(404).json({ error: "Not found" });
      logAudit(req, "edited_call", "service_call", id);
      res.json(call);
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed" });
      }
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.delete("/api/service-calls/:id", requireEditor, (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      storage.deleteServiceCall(id);
      logAudit(req, "deleted_call", "service_call", id);
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

  app.post("/api/contacts", requireEditor, (req, res) => {
    try {
      const data = insertContactSchema.parse(req.body);
      const contact = storage.createContact(data);
      logAudit(req, "created_contact", "contact", contact.id, data.contactName);
      res.status(201).json(contact);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Validation failed" });
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.patch("/api/contacts/:id", requireEditor, (req, res) => {
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

  app.delete("/api/contacts/:id", requireManager, (req, res) => {
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

  app.post("/api/service-calls/:id/photos", express.json({ limit: "20mb" }), requireEditor, (req, res) => {
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
      logAudit(req, "added_photo", "service_call", id, data.photoType);
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

  app.post("/api/service-calls/:id/parts", requireEditor, (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const data = insertPartSchema.parse({ ...req.body, serviceCallId: id });
      const part = storage.createPart(data);
      logAudit(req, "added_part", "service_call", id, data.partNumber);
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
      logAudit(req, "added_note", "service_call", id, note.trim().substring(0, 100));
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

  // ─── Analytics Dashboard (consolidated) ─────────────────────────────────────

  app.get("/api/analytics/dashboard", (req: any, res: any) => {
    // Role-based field filtering: revenue, team workload, payment speed are manager-only
    const isManager = req.user?.role === "manager";
    const isEditor = req.user?.role !== "staff";
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      const dateFrom = from || "2000-01-01";
      const dateTo = to || "2099-12-31";

      // ── Revenue ──────────────────────────────────────────────────────────
      const invoiceRows = sqliteHandle.prepare(`
        SELECT status, total, issue_date, paid_date
        FROM invoices
        WHERE status != 'Draft' AND issue_date BETWEEN ? AND ?
      `).all(dateFrom, dateTo) as Array<{ status: string; total: string; issue_date: string; paid_date: string | null }>;

      let totalBilled = 0;
      let totalCollected = 0;
      const billedByMonthMap = new Map<string, number>();
      const collectedByMonthMap = new Map<string, number>();

      for (const inv of invoiceRows) {
        const amt = parseFloat(inv.total) || 0;
        totalBilled += amt;
        const month = inv.issue_date.slice(0, 7);
        billedByMonthMap.set(month, (billedByMonthMap.get(month) || 0) + amt);
        if (inv.status === "Paid") {
          totalCollected += amt;
          collectedByMonthMap.set(month, (collectedByMonthMap.get(month) || 0) + amt);
        }
      }

      const allMonths = new Set([...billedByMonthMap.keys(), ...collectedByMonthMap.keys()]);
      const billedByMonth = Array.from(allMonths).sort().map(m => ({ month: m, amount: Math.round((billedByMonthMap.get(m) || 0) * 100) / 100 }));
      const collectedByMonth = Array.from(allMonths).sort().map(m => ({ month: m, amount: Math.round((collectedByMonthMap.get(m) || 0) * 100) / 100 }));

      // ── Service calls in date range ──────────────────────────────────────
      const calls = storage.getAllServiceCalls({ dateFrom, dateTo });

      // ── Tech Productivity ────────────────────────────────────────────────
      let totalHours = 0;
      let totalMiles = 0;
      const hoursByMonthMap = new Map<string, number>();
      const milesByMonthMap = new Map<string, number>();

      for (const c of calls) {
        const hrs = c.hoursOnJob ? parseFloat(c.hoursOnJob) || 0 : 0;
        const mi = c.milesTraveled ? parseFloat(c.milesTraveled) || 0 : 0;
        totalHours += hrs;
        totalMiles += mi;
        const month = c.callDate.slice(0, 7);
        hoursByMonthMap.set(month, (hoursByMonthMap.get(month) || 0) + hrs);
        milesByMonthMap.set(month, (milesByMonthMap.get(month) || 0) + mi);
      }

      // Also add visit-level hours/miles
      const visitRows = sqliteHandle.prepare(`
        SELECT scv.hours_on_job, scv.miles_traveled, sc.call_date
        FROM service_call_visits scv
        JOIN service_calls sc ON scv.service_call_id = sc.id
        WHERE sc.call_date BETWEEN ? AND ?
      `).all(dateFrom, dateTo) as Array<{ hours_on_job: string | null; miles_traveled: string | null; call_date: string }>;

      for (const v of visitRows) {
        const hrs = v.hours_on_job ? parseFloat(v.hours_on_job) || 0 : 0;
        const mi = v.miles_traveled ? parseFloat(v.miles_traveled) || 0 : 0;
        totalHours += hrs;
        totalMiles += mi;
        const month = v.call_date.slice(0, 7);
        hoursByMonthMap.set(month, (hoursByMonthMap.get(month) || 0) + hrs);
        milesByMonthMap.set(month, (milesByMonthMap.get(month) || 0) + mi);
      }

      const callCount = calls.length || 1;
      const productivityMonths = new Set([...hoursByMonthMap.keys(), ...milesByMonthMap.keys()]);
      const hoursByMonth = Array.from(productivityMonths).sort().map(m => ({ month: m, hours: Math.round((hoursByMonthMap.get(m) || 0) * 100) / 100 }));
      const milesByMonth = Array.from(productivityMonths).sort().map(m => ({ month: m, miles: Math.round((milesByMonthMap.get(m) || 0) * 100) / 100 }));

      // ── First-Time Fix Rate ──────────────────────────────────────────────
      const visitCountRows = sqliteHandle.prepare(`
        SELECT sc.id, COUNT(scv.id) as visit_count
        FROM service_calls sc
        LEFT JOIN service_call_visits scv ON scv.service_call_id = sc.id
        WHERE sc.call_date BETWEEN ? AND ?
        GROUP BY sc.id
      `).all(dateFrom, dateTo) as Array<{ id: number; visit_count: number }>;

      const totalCallsForFix = visitCountRows.length;
      const singleVisitCalls = visitCountRows.filter(r => r.visit_count === 0).length;
      const multiVisitCalls = totalCallsForFix - singleVisitCalls;
      const firstTimeFixRate = totalCallsForFix > 0 ? Math.round((singleVisitCalls / totalCallsForFix) * 10000) / 100 : 0;

      // ── Parts Spend ──────────────────────────────────────────────────────
      const partsRows = sqliteHandle.prepare(`
        SELECT pu.part_description, pu.quantity, pu.unit_cost, sc.manufacturer
        FROM parts_used pu
        JOIN service_calls sc ON pu.service_call_id = sc.id
        WHERE sc.call_date BETWEEN ? AND ?
          AND pu.unit_cost IS NOT NULL AND pu.unit_cost != ''
      `).all(dateFrom, dateTo) as Array<{ part_description: string; quantity: number; unit_cost: string; manufacturer: string }>;

      let totalPartsCost = 0;
      const partsByMfg = new Map<string, { cost: number; count: number }>();
      const topPartsMap = new Map<string, { totalCost: number; totalQty: number }>();

      for (const p of partsRows) {
        const cost = (p.quantity || 1) * (parseFloat(p.unit_cost) || 0);
        totalPartsCost += cost;
        if (!partsByMfg.has(p.manufacturer)) partsByMfg.set(p.manufacturer, { cost: 0, count: 0 });
        const mfgEntry = partsByMfg.get(p.manufacturer)!;
        mfgEntry.cost += cost;
        mfgEntry.count += p.quantity || 1;

        const desc = p.part_description || "Unknown Part";
        if (!topPartsMap.has(desc)) topPartsMap.set(desc, { totalCost: 0, totalQty: 0 });
        const partEntry = topPartsMap.get(desc)!;
        partEntry.totalCost += cost;
        partEntry.totalQty += p.quantity || 1;
      }

      const byManufacturerParts = Array.from(partsByMfg.entries())
        .map(([manufacturer, data]) => ({ manufacturer, cost: Math.round(data.cost * 100) / 100, count: data.count }))
        .sort((a, b) => b.cost - a.cost);

      const topParts = Array.from(topPartsMap.entries())
        .map(([partDescription, data]) => ({ partDescription, totalCost: Math.round(data.totalCost * 100) / 100, totalQty: data.totalQty }))
        .sort((a, b) => b.totalCost - a.totalCost)
        .slice(0, 10);

      // ── Manufacturer Analysis ────────────────────────────────────────────
      const mfgCallMap = new Map<string, { count: number; totalHours: number }>();
      for (const c of calls) {
        if (!mfgCallMap.has(c.manufacturer)) mfgCallMap.set(c.manufacturer, { count: 0, totalHours: 0 });
        const entry = mfgCallMap.get(c.manufacturer)!;
        entry.count++;
        entry.totalHours += c.hoursOnJob ? parseFloat(c.hoursOnJob) || 0 : 0;
      }

      const callsByManufacturer = Array.from(mfgCallMap.entries())
        .map(([manufacturer, data]) => ({ manufacturer, count: data.count }))
        .sort((a, b) => b.count - a.count);

      const avgHoursByManufacturer = Array.from(mfgCallMap.entries())
        .map(([manufacturer, data]) => ({ manufacturer, avgHours: data.count > 0 ? Math.round((data.totalHours / data.count) * 100) / 100 : 0 }))
        .sort((a, b) => b.avgHours - a.avgHours);

      // ── Wholesaler Volume ────────────────────────────────────────────────
      const wholesalerMap = new Map<string, number>();
      for (const c of calls) {
        if (c.wholesalerName) {
          wholesalerMap.set(c.wholesalerName, (wholesalerMap.get(c.wholesalerName) || 0) + 1);
        }
      }
      const wholesalerVolume = Array.from(wholesalerMap.entries())
        .map(([wholesalerName, callCount]) => ({ wholesalerName, callCount }))
        .sort((a, b) => b.callCount - a.callCount);

      // ── Team Workload ────────────────────────────────────────────────────
      const teamRows = sqliteHandle.prepare(`
        SELECT u.display_name as user_name, COUNT(sc.id) as call_count,
          COALESCE(SUM(CASE WHEN sc.hours_on_job != '' AND sc.hours_on_job IS NOT NULL THEN CAST(sc.hours_on_job AS REAL) ELSE 0 END), 0) as total_hours,
          COALESCE(SUM(CASE WHEN sc.miles_traveled != '' AND sc.miles_traveled IS NOT NULL THEN CAST(sc.miles_traveled AS REAL) ELSE 0 END), 0) as total_miles
        FROM service_calls sc
        JOIN users u ON sc.created_by = u.id
        WHERE sc.call_date BETWEEN ? AND ? AND sc.created_by IS NOT NULL
        GROUP BY sc.created_by
        ORDER BY call_count DESC
      `).all(dateFrom, dateTo) as Array<{ user_name: string; call_count: number; total_hours: number; total_miles: number }>;

      const teamWorkload = teamRows.map(r => ({
        userName: r.user_name,
        callCount: r.call_count,
        totalHours: Math.round(r.total_hours * 100) / 100,
        totalMiles: Math.round(r.total_miles * 100) / 100,
      }));

      // ── Warranty Mix ─────────────────────────────────────────────────────
      let inWarranty = 0;
      let outOfWarranty = 0;
      let unknown = 0;

      for (const c of calls) {
        const ws = getWarrantyStatus(c.installationDate, c.manufacturer, c.productType);
        if (ws.status === "in-warranty") inWarranty++;
        else if (ws.status === "out-of-warranty") outOfWarranty++;
        else unknown++;
      }

      // ── Repeat Failures ──────────────────────────────────────────────────
      const serialMap = new Map<string, { address: string; customerName: string; manufacturer: string; callCount: number }>();
      for (const c of calls) {
        if (c.productSerial) {
          if (!serialMap.has(c.productSerial)) {
            serialMap.set(c.productSerial, {
              address: c.jobSiteAddress || "",
              customerName: c.customerName || "",
              manufacturer: c.manufacturer,
              callCount: 0,
            });
          }
          serialMap.get(c.productSerial)!.callCount++;
        }
      }
      const repeatFailures = Array.from(serialMap.entries())
        .filter(([_, data]) => data.callCount > 1)
        .map(([serialNumber, data]) => ({ serialNumber, ...data }))
        .sort((a, b) => b.callCount - a.callCount)
        .slice(0, 10);

      // ── Seasonal Trends ──────────────────────────────────────────────────
      const callsByMonthMap = new Map<string, number>();
      for (const c of calls) {
        const month = c.callDate.slice(0, 7);
        callsByMonthMap.set(month, (callsByMonthMap.get(month) || 0) + 1);
      }
      const callsByMonth = Array.from(callsByMonthMap.entries())
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month));

      // ── Payment Speed ────────────────────────────────────────────────────
      const paidInvoices = sqliteHandle.prepare(`
        SELECT AVG(julianday(paid_date) - julianday(issue_date)) as avg_days
        FROM invoices
        WHERE status = 'Paid' AND paid_date IS NOT NULL
          AND issue_date BETWEEN ? AND ?
      `).get(dateFrom, dateTo) as { avg_days: number | null } | undefined;

      const avgDaysToPayment = Math.round((paidInvoices?.avg_days || 0) * 100) / 100;

      res.json({
        // Manager only: revenue, payment speed
        revenue: isManager ? {
          totalBilled: Math.round(totalBilled * 100) / 100,
          totalCollected: Math.round(totalCollected * 100) / 100,
          totalOutstanding: Math.round((totalBilled - totalCollected) * 100) / 100,
          billedByMonth,
          collectedByMonth,
        } : null,
        techProductivity: {
          totalHours: Math.round(totalHours * 100) / 100,
          totalMiles: Math.round(totalMiles * 100) / 100,
          avgHoursPerCall: Math.round((totalHours / callCount) * 100) / 100,
          avgMilesPerCall: Math.round((totalMiles / callCount) * 100) / 100,
          hoursByMonth,
          milesByMonth,
        },
        fixRate: {
          totalCalls: totalCallsForFix,
          singleVisitCalls,
          multiVisitCalls,
          firstTimeFixRate,
        },
        // Manager + Editor only: parts spend
        partsSpend: isEditor ? {
          totalPartsCost: Math.round(totalPartsCost * 100) / 100,
          byManufacturer: byManufacturerParts,
          topParts,
        } : null,
        manufacturerAnalysis: {
          callsByManufacturer,
          avgHoursByManufacturer,
        },
        wholesalerVolume,
        // Manager only: team workload
        teamWorkload: isManager ? teamWorkload : null,
        warrantyMix: { inWarranty, outOfWarranty, unknown },
        repeatFailures,
        callsByMonth,
        // Manager only: payment speed
        avgDaysToPayment: isManager ? avgDaysToPayment : null,
      });
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Analytics (legacy) ────────────────────────────────────────────────────

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

        case "invoice-aging": {
          const allInvoices = sqliteHandle.prepare(`
            SELECT i.*,
              (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.id) as item_count
            FROM invoices i
            WHERE i.status NOT IN ('Paid', 'Draft')
            ORDER BY i.due_date ASC
          `).all() as any[];

          const today = new Date();
          const todayStr = today.toISOString().split("T")[0];
          let current = 0, days31to60 = 0, days61to90 = 0, over90 = 0;
          const invoices = allInvoices.map((inv: any) => {
            const dueDate = inv.due_date || inv.issue_date;
            const due = new Date(dueDate + "T00:00:00");
            const daysOut = Math.max(0, Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
            const total = parseFloat(inv.total) || 0;
            let bucket: string;
            if (daysOut <= 30) { bucket = "current"; current += total; }
            else if (daysOut <= 60) { bucket = "31-60"; days31to60 += total; }
            else if (daysOut <= 90) { bucket = "61-90"; days61to90 += total; }
            else { bucket = "90+"; over90 += total; }
            return {
              id: inv.id,
              invoiceNumber: inv.invoice_number,
              billToName: inv.bill_to_name,
              issueDate: inv.issue_date,
              dueDate: dueDate,
              total: inv.total,
              daysOutstanding: daysOut,
              bucket,
            };
          });
          return res.json({
            summary: {
              current,
              days31to60,
              days61to90,
              over90,
              totalOutstanding: current + days31to60 + days61to90 + over90,
            },
            invoices,
          });
        }

        default:
          return res.status(400).json({ error: "Unknown report type" });
      }
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Invoices ───────────────────────────────────────────────────────────────

  // Generate next invoice number — must be BEFORE /api/invoices/:id to avoid route collision
  app.get("/api/invoices/next-number", (req: any, res: any) => {
    try {
      res.json({ invoiceNumber: storage.generateInvoiceNumber() });
    } catch (e: any) { res.status(500).json({ error: safeError(e) }); }
  });

  app.get("/api/invoices", (req: any, res: any) => {
    try {
      // Auto-mark overdue: any Sent invoice past its due date becomes Overdue
      const today = new Date().toISOString().split("T")[0];
      storage.markOverdueInvoices(today);

      const filters: any = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.billToType) filters.billToType = req.query.billToType;
      if (req.query.search) filters.search = req.query.search;
      res.json(storage.getAllInvoices(Object.keys(filters).length ? filters : undefined));
    } catch (e: any) { res.status(500).json({ error: safeError(e) }); }
  });

  app.get("/api/invoices/:id", (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const invoice = storage.getInvoiceById(id);
      if (!invoice) return res.status(404).json({ error: "Not found" });
      res.json(invoice);
    } catch (e: any) { res.status(500).json({ error: safeError(e) }); }
  });

  app.get("/api/service-calls/:id/invoices", (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      res.json(storage.getInvoicesByServiceCallId(id));
    } catch (e: any) { res.status(500).json({ error: safeError(e) }); }
  });

  app.post("/api/invoices", requireEditor, (req: any, res: any) => {
    try {
      const data = req.body;
      if (!data.billToName || !data.issueDate) {
        return res.status(400).json({ error: "Bill To Name and Issue Date are required" });
      }
      data.invoiceNumber = data.invoiceNumber || storage.generateInvoiceNumber();
      data.createdBy = req.user?.id || null;
      const items = data.items || [];
      delete data.items;
      const invoice = storage.createInvoice(data);
      if (items.length) {
        storage.replaceInvoiceItems(invoice.id, items.map((item: any) => ({ ...item, invoiceId: invoice.id })));
      }
      logAudit(req, "created_invoice", "invoice", invoice.id, `${invoice.invoiceNumber} - ${invoice.billToName}`);
      res.status(201).json(storage.getInvoiceById(invoice.id));
    } catch (e: any) { res.status(500).json({ error: safeError(e) }); }
  });

  app.patch("/api/invoices/:id", requireEditor, (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const { items, ...data } = req.body;
      const invoice = storage.updateInvoice(id, data);
      if (!invoice) return res.status(404).json({ error: "Not found" });
      if (items !== undefined) {
        storage.replaceInvoiceItems(id, items.map((item: any) => ({ ...item, invoiceId: id })));
      }
      // Auto-set paid_date when status changes to Paid
      if (data.status === "Paid" && !invoice.paidDate) {
        storage.updateInvoice(id, { paidDate: new Date().toISOString().split("T")[0] });
      }
      logAudit(req, "edited_invoice", "invoice", id, data.status ? `Status: ${data.status}` : undefined);
      res.json(storage.getInvoiceById(id));
    } catch (e: any) { res.status(500).json({ error: safeError(e) }); }
  });

  app.delete("/api/invoices/:id", requireManager, (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const invoice = storage.getInvoiceById(id);
      if (!invoice) return res.status(404).json({ error: "Not found" });
      storage.deleteInvoice(id);
      logAudit(req, "deleted_invoice", "invoice", id, invoice.invoiceNumber);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: safeError(e) }); }
  });

  // ─── Service Call Visits (Return Visits) ──────────────────────────────────

  app.get("/api/service-calls/:id/visits", (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      res.json(storage.getVisitsForCall(id));
    } catch (e: any) { res.status(500).json({ error: safeError(e) }); }
  });

  app.post("/api/service-calls/:id/visits", requireEditor, (req: any, res: any) => {
    try {
      const callId = parseInt(req.params.id);
      if (isNaN(callId)) return res.status(400).json({ error: "Invalid ID" });
      const { visitDate, status, technicianId, notes, hoursOnJob, milesTraveled } = req.body;
      if (!visitDate || isNaN(new Date(visitDate).getTime())) {
        return res.status(400).json({ error: "Valid visit date is required" });
      }
      const visitData = {
        serviceCallId: callId,
        visitNumber: 0, // auto-assigned by storage
        visitDate,
        status: status || "Scheduled",
        technicianId: technicianId || null,
        notes: notes || null,
        hoursOnJob: hoursOnJob || null,
        milesTraveled: milesTraveled || null,
      };
      const visit = storage.createVisit(visitData);
      // Propagate visit status + date to parent service call so it surfaces on dashboard/scheduled/calendar
      const statusesToPropagate = ['Scheduled', 'In Progress', 'Needs Return Visit'];
      if (statusesToPropagate.includes(visitData.status)) {
        storage.updateServiceCall(callId, { status: visitData.status, scheduledDate: visitData.visitDate });
      }
      logAudit(req, "create_visit", "service_call", callId, `Visit ${visit.visitNumber} added to call #${callId}`);
      res.status(201).json(visit);
    } catch (e: any) { res.status(500).json({ error: safeError(e) }); }
  });

  app.put("/api/service-calls/:id/visits/:vid", requireEditor, (req: any, res: any) => {
    try {
      const callId = parseInt(req.params.id);
      const vid = parseInt(req.params.vid);
      if (isNaN(vid)) return res.status(400).json({ error: "Invalid visit ID" });
      const { visitDate, notes, status, technicianId, hoursOnJob, milesTraveled } = req.body;
      const data: any = {};
      if (visitDate !== undefined) data.visitDate = visitDate;
      if (notes !== undefined) data.notes = notes;
      if (status !== undefined) data.status = status;
      if (technicianId !== undefined) data.technicianId = technicianId;
      if (hoursOnJob !== undefined) data.hoursOnJob = hoursOnJob;
      if (milesTraveled !== undefined) data.milesTraveled = milesTraveled;
      const visit = storage.updateVisit(vid, data);
      if (!visit) return res.status(404).json({ error: "Visit not found" });
      // Propagate visit status + date to parent service call
      if (status !== undefined && !isNaN(callId)) {
        const statusesToPropagate = ['Scheduled', 'In Progress', 'Needs Return Visit'];
        if (statusesToPropagate.includes(status)) {
          const updatePayload: any = { status };
          if (visitDate !== undefined) updatePayload.scheduledDate = visitDate;
          storage.updateServiceCall(callId, updatePayload);
        }
      }
      res.json(visit);
    } catch (e: any) { res.status(500).json({ error: safeError(e) }); }
  });

  app.delete("/api/service-calls/:id/visits/:vid", requireManager, (req: any, res: any) => {
    try {
      const callId = parseInt(req.params.id);
      const vid = parseInt(req.params.vid);
      if (isNaN(vid)) return res.status(400).json({ error: "Invalid visit ID" });
      const visit = storage.getVisitById(vid);
      if (!visit) return res.status(404).json({ error: "Visit not found" });
      storage.deleteVisit(vid);
      logAudit(req, "delete_visit", "service_call", callId, `Visit ${visit.visitNumber} deleted from call #${callId}`);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: safeError(e) }); }
  });

  // ─── Calendar ───────────────────────────────────────────────────────────────

  app.get("/api/calendar", (req, res) => {
    try {
      const from = req.query.from as string;
      const to = req.query.to as string;

      // Get all service calls in the date range — always use call_date for calendar placement
      // (return visits handle their own dates as separate events below)
      const calls = sqliteHandle
        .prepare(`
          SELECT
            sc.id, sc.call_date, sc.scheduled_date, sc.scheduled_time,
            sc.customer_name, sc.job_site_name, sc.job_site_city, sc.job_site_state,
            sc.manufacturer, sc.status, sc.created_by,
            u.username as created_by_username,
            (SELECT COUNT(*) FROM service_call_visits scv2 WHERE scv2.service_call_id = sc.id) as visit_count
          FROM service_calls sc
          LEFT JOIN users u ON sc.created_by = u.id
          WHERE
            sc.call_date >= ? AND sc.call_date <= ?
          ORDER BY sc.call_date ASC, sc.scheduled_time ASC
        `)
        .all(from || "1900-01-01", to || "2999-12-31") as any[];

      const result = calls.map(c => ({
        id: c.id,
        callDate: c.call_date,
        // For calendar placement: use call_date if call has return visits (so Visit 1 stays on its original date)
        // Otherwise use scheduled_date if set (for single-visit calls scheduled ahead of time)
        scheduledDate: (c.visit_count > 0) ? c.call_date : c.scheduled_date,
        scheduledTime: c.scheduled_time,
        customerName: c.customer_name,
        jobSiteName: c.job_site_name,
        jobSiteCity: c.job_site_city,
        jobSiteState: c.job_site_state,
        manufacturer: c.manufacturer,
        status: c.status,
        createdByUsername: c.created_by_username,
        isReturnVisit: false,
        visitNumber: 1,
      }));

      // Also include return visits (visit_number >= 2) in the date range
      const returnVisits = sqliteHandle
        .prepare(`
          SELECT
            sc.id as service_call_id,
            scv.visit_number,
            scv.visit_date,
            scv.status,
            sc.customer_name, sc.job_site_name, sc.job_site_city, sc.job_site_state,
            sc.manufacturer,
            u.display_name as technician_name
          FROM service_call_visits scv
          JOIN service_calls sc ON sc.id = scv.service_call_id
          LEFT JOIN users u ON scv.technician_id = u.id
          WHERE scv.visit_date >= ? AND scv.visit_date <= ?
          ORDER BY scv.visit_date ASC
        `)
        .all(from || "1900-01-01", to || "2999-12-31") as any[];

      const visitEvents = returnVisits.map(v => ({
        id: v.service_call_id,           // navigate to parent call
        callDate: v.visit_date,
        scheduledDate: v.visit_date,
        scheduledTime: null,
        customerName: v.customer_name,
        jobSiteName: v.job_site_name,
        jobSiteCity: v.job_site_city,
        jobSiteState: v.job_site_state,
        manufacturer: v.manufacturer,
        status: v.status,
        createdByUsername: v.technician_name,
        isReturnVisit: true,
        visitNumber: v.visit_number,
      }));

      // Merge and sort by date
      const allEvents = [...result, ...visitEvents].sort((a, b) =>
        (a.scheduledDate || a.callDate).localeCompare(b.scheduledDate || b.callDate)
      );

      res.json(allEvents);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Database Backup ─────────────────────────────────────────────────────────
  // Uses SQLite's built-in .backup() API for a safe, consistent point-in-time copy
  // even while the database is being written to. Twice-daily rolling backups:
  //   backup-am.db  (morning run)
  //   backup-pm.db  (evening run)
  // Plus day-of-week backups for 7-day retention:
  //   backup-mon.db through backup-sun.db
  //
  // Intended to be called by a Render Cron Job (e.g. every 12 hours).
  // Also callable manually for an on-demand backup.

  // ─── Equipment History Search ─────────────────────────────────────────────

  app.get("/api/equipment/search", (req: any, res: any) => {
    try {
      const q = (req.query.q as string || "").trim();
      if (q.length < 2) return res.json([]);

      const pattern = `%${q}%`;
      const rows = sqliteHandle.prepare(`
        SELECT
          id, call_date, customer_name, job_site_name, job_site_address,
          job_site_city, job_site_state, job_site_zip,
          manufacturer, product_model, product_serial, product_type,
          installation_date, status, issue_description, diagnosis, resolution,
          tech_notes, hours_on_job, miles_traveled
        FROM service_calls
        WHERE product_serial LIKE ? OR job_site_address LIKE ? OR customer_name LIKE ?
        ORDER BY call_date DESC
      `).all(pattern, pattern, pattern) as any[];

      // Group by serial number + address combo
      const groups = new Map<string, {
        serialNumber: string;
        manufacturer: string;
        productModel: string;
        productType: string;
        address: string;
        city: string;
        state: string;
        zip: string;
        customerName: string;
        installationDate: string | null;
        firstCallDate: string;
        lastCallDate: string;
        calls: any[];
      }>();

      for (const row of rows) {
        const serial = row.product_serial || "";
        const addr = row.job_site_address || "";
        const key = `${serial}||${addr}`;

        if (!groups.has(key)) {
          groups.set(key, {
            serialNumber: serial,
            manufacturer: row.manufacturer,
            productModel: row.product_model || "",
            productType: row.product_type || "",
            address: addr,
            city: row.job_site_city || "",
            state: row.job_site_state || "",
            zip: row.job_site_zip || "",
            customerName: row.customer_name || "",
            installationDate: row.installation_date,
            firstCallDate: row.call_date,
            lastCallDate: row.call_date,
            calls: [],
          });
        }

        const group = groups.get(key)!;
        if (row.call_date < group.firstCallDate) group.firstCallDate = row.call_date;
        if (row.call_date > group.lastCallDate) group.lastCallDate = row.call_date;
        if (row.installation_date && !group.installationDate) group.installationDate = row.installation_date;

        // Count visits for this call
        const visitCount = (sqliteHandle.prepare(
          `SELECT COUNT(*) as c FROM service_call_visits WHERE service_call_id = ?`
        ).get(row.id) as any).c;

        group.calls.push({
          id: row.id,
          callDate: row.call_date,
          status: row.status,
          issueDescription: row.issue_description || "",
          diagnosis: row.diagnosis || "",
          resolution: row.resolution || "",
          techNotes: row.tech_notes || "",
          hoursOnJob: row.hours_on_job || "",
          milesTraveled: row.miles_traveled || "",
          visitCount: 1 + visitCount,
        });
      }

      const results = Array.from(groups.values()).map(g => ({
        ...g,
        totalCalls: g.calls.length,
      }));

      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: safeError(e) });
    }
  });

  // ─── Backup ──────────────────────────────────────────────────────────────────
  const BACKUP_SECRET = process.env.BACKUP_SECRET || "";

  // Middleware: backup endpoints accept either the session Bearer token
  // OR a dedicated BACKUP_SECRET via x-backup-secret header (for cron jobs)
  const requireBackupAuth = (req: any, res: any, next: any) => {
    // Try session token first
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (token && isValidSession(token)) return next();
    // Try backup secret (for Render Cron Job)
    const secret = req.headers["x-backup-secret"] || req.query.secret;
    if (BACKUP_SECRET && secret === BACKUP_SECRET) return next();
    return res.status(401).json({ error: "Unauthorized" });
  };

  app.post("/api/backup", requireBackupAuth, async (req, res) => {
    try {
      const dbDir = path.dirname(path.resolve(DB_PATH));
      const now = new Date();
      const hour = now.getUTCHours();
      const amPm = hour < 12 ? "am" : "pm";
      const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const dayName = dayNames[now.getUTCDay()];

      // Create two backups:
      //   1. AM/PM slot (overwritten each half-day)
      //   2. Day-of-week slot (overwritten weekly → 7-day retention)
      const slotFile = path.join(dbDir, `backup-${amPm}.db`);
      const dayFile = path.join(dbDir, `backup-${dayName}.db`);

      // Use SQLite's .backup() API — safe even during concurrent writes
      await sqliteHandle.backup(slotFile);
      await sqliteHandle.backup(dayFile);

      const slotSize = fs.statSync(slotFile).size;
      const daySize = fs.statSync(dayFile).size;

      logAudit(req, "ran_backup", undefined, undefined, `${amPm} + ${dayName}`);
      console.log(`[backup] Created ${slotFile} (${(slotSize / 1024).toFixed(0)}KB) and ${dayFile} (${(daySize / 1024).toFixed(0)}KB)`);

      res.json({
        success: true,
        backups: [
          { file: `backup-${amPm}.db`, size: slotSize, timestamp: now.toISOString() },
          { file: `backup-${dayName}.db`, size: daySize, timestamp: now.toISOString() },
        ],
      });
    } catch (e: any) {
      console.error("[backup] Failed:", e);
      res.status(500).json({ error: safeError(e) });
    }
  });

  app.get("/api/backup/status", requireBackupAuth, (_req, res) => {
    try {
      const dbDir = path.dirname(path.resolve(DB_PATH));
      const backupFiles = [
        "backup-am.db", "backup-pm.db",
        "backup-sun.db", "backup-mon.db", "backup-tue.db",
        "backup-wed.db", "backup-thu.db", "backup-fri.db", "backup-sat.db",
      ];

      const backups = backupFiles
        .map(f => {
          const fullPath = path.join(dbDir, f);
          try {
            const stat = fs.statSync(fullPath);
            return {
              file: f,
              size: stat.size,
              lastModified: stat.mtime.toISOString(),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      // Main database info
      const mainStat = fs.statSync(path.resolve(DB_PATH));

      res.json({
        database: {
          file: path.basename(DB_PATH),
          size: mainStat.size,
          lastModified: mainStat.mtime.toISOString(),
        },
        backups,
      });
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
