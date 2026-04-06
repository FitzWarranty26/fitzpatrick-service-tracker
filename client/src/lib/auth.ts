/**
 * Session token-based auth with user info.
 * On login, the server returns a random session token + user object.
 * The token is sent as a Bearer token on every API request.
 * The actual password is never stored client-side after login.
 * Token expires after 24 hours server-side.
 */

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: "manager" | "tech" | "sales" | "staff";
  mustChangePassword?: number;
}

let _token: string | null = null;
let _user: AuthUser | null = null;

export function getToken(): string | null {
  return _token;
}

export function getUser(): AuthUser | null {
  return _user;
}

export function setAuth(token: string, user: AuthUser) {
  _token = token;
  _user = user;
}

// Keep backward compat
export function setToken(token: string) {
  _token = token;
}

export function clearToken() {
  _token = null;
  _user = null;
}

export function isAuthenticated(): boolean {
  return _token !== null;
}

export function isManager(): boolean {
  return _user?.role === "manager";
}

export function isStaff(): boolean {
  return _user?.role === "staff";
}

export function getAuthHeaders(): Record<string, string> {
  if (_token) {
    return { "Authorization": `Bearer ${_token}` };
  }
  return {};
}

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

export async function logout(): Promise<void> {
  try {
    if (_token) {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${_token}` },
      });
    }
  } catch {
    // Best-effort — clear client state regardless
  } finally {
    clearToken();
  }
}
