/**
 * Session token-based auth.
 * On login, the server returns a random session token (not the password).
 * The token is sent as a Bearer token on every API request.
 * The actual password is never stored client-side after login.
 * Token expires after 24 hours server-side.
 */

let _token: string | null = null;

export function getToken(): string | null {
  return _token;
}

export function setToken(token: string) {
  _token = token;
}

export function clearToken() {
  _token = null;
}

export function isAuthenticated(): boolean {
  return _token !== null;
}

export function getAuthHeaders(): Record<string, string> {
  if (_token) {
    return { "Authorization": `Bearer ${_token}` };
  }
  return {};
}
