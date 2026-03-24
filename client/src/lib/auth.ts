/**
 * Simple password-based auth.
 * Password is stored in a module-level variable (survives SPA navigation).
 * Since localStorage is blocked in sandboxed iframes, we use a global variable
 * and React state for persistence during the session.
 */

let _password: string | null = null;

export function getPassword(): string | null {
  return _password;
}

export function setPassword(pw: string) {
  _password = pw;
}

export function clearPassword() {
  _password = null;
}

export function isAuthenticated(): boolean {
  return _password !== null;
}

export function getAuthHeaders(): Record<string, string> {
  if (_password) {
    return { "x-app-password": _password };
  }
  return {};
}
