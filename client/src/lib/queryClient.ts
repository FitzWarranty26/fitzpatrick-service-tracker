import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getAuthHeaders, clearToken } from "./auth";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// Module-scope guard — prevents firing the 'session expired' redirect+toast
// dozens of times when a wave of parallel queries all return 401 at once.
let expiredHandled = false;

/**
 * Centralized 401-handling. The session token is invalid or expired. Clear
 * local auth, set a flag the login page can read so it shows the right
 * message, then redirect. Form drafts are preserved automatically by the
 * useFormDraft hook — the user can sign back in and resume.
 */
function handleSessionExpired() {
  if (expiredHandled) return;
  expiredHandled = true;
  clearToken();
  try {
    sessionStorage.setItem("sessionExpired", "1");
  } catch {
    // private mode — no-op
  }
  // Skip if we're already on /login (user is already signing in).
  const currentHash = window.location.hash || "";
  if (!currentHash.includes("/login") && !window.location.pathname.endsWith("/login")) {
    window.location.href = "/login";
  }
}

async function throwIfResNotOk(res: Response) {
  if (res.status === 401) {
    handleSessionExpired();
    throw new Error("401: session expired");
  }
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
  };
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = `${API_BASE}${queryKey[0]}`;
    const res = await fetch(url, {
      headers: getAuthHeaders(),
    });

    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") return null;
      handleSessionExpired();
      throw new Error("401: session expired");
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      // Refetch when the user returns to the tab — important for techs in
      // the field whose dashboard might have stale schedules after a
      // dispatcher/manager rescheduled from another device.
      refetchOnWindowFocus: true,
      // Refetch when network drops and reconnects (common on job sites).
      refetchOnReconnect: true,
      // Allow data to live for ~30s before being considered stale; window
      // focus refetches give us correctness without thrashing the network.
      staleTime: 30000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
