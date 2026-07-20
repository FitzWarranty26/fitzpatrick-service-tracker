// Role-based route guards.
//
// Extracted from registerRoutes so the auth boundary is unit-testable (the code
// review flagged zero role-enforcement tests). Behavior is unchanged:
//   - requireManager: only role "manager" passes; everyone else gets 403.
//   - requireEditor:  role "staff" is blocked (403); manager/tech pass.
// req.user is populated by the session-auth middleware before these run.

export const requireManager = (req: any, res: any, next: any) => {
  if (req.user?.role !== "manager") {
    return res.status(403).json({ error: "Manager access required" });
  }
  return next();
};

export const requireEditor = (req: any, res: any, next: any) => {
  if (req.user?.role === "staff") {
    return res.status(403).json({ error: "Edit access required" });
  }
  return next();
};
