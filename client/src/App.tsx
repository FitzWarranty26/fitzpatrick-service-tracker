import { useState, useEffect, lazy, Suspense } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AppLayout } from "@/components/Layout";
import { LoginScreen } from "@/components/LoginScreen";
import { setAuth, isAuthenticated, getUser } from "@/lib/auth";
import Dashboard from "@/pages/Dashboard";
import ServiceCallList from "@/pages/ServiceCallList";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

// Lazy-load heavy pages — keeps initial bundle small for fast first load
const NewServiceCall = lazy(() => import("@/pages/NewServiceCall"));
const ServiceCallDetail = lazy(() => import("@/pages/ServiceCallDetail"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const ServiceMap = lazy(() => import("@/pages/ServiceMap"));
const Contacts = lazy(() => import("@/pages/Contacts"));
const Reports = lazy(() => import("@/pages/Reports"));
const CalendarPage = lazy(() => import("@/pages/Calendar"));
const Invoices = lazy(() => import("@/pages/Invoices"));
const InvoiceDetail = lazy(() => import("@/pages/InvoiceDetail"));
const NewInvoice = lazy(() => import("@/pages/NewInvoice"));
const EquipmentHistory = lazy(() => import("@/pages/EquipmentHistory"));
const Team = lazy(() => import("@/pages/Team"));
const AuditLog = lazy(() => import("@/pages/AuditLog"));

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <h1 className="text-xl font-bold">Page Not Found</h1>
      <p className="text-muted-foreground text-sm">The page you're looking for doesn't exist.</p>
    </div>
  );
}

function AppRouter() {
  const user = getUser();

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/calls">{() => <ServiceCallList />}</Route>
        <Route path="/calls/filter/:preset">
          {(params) => <ServiceCallList preset={params.preset} />}
        </Route>
        <Route path="/scheduled">{() => <ServiceCallList preset="scheduled" />}</Route>
        <Route path="/new">
          {() => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>}>
              <NewServiceCall />
            </Suspense>
          )}
        </Route>
        <Route path="/new/followup/:parentId">
          {(params) => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>}>
              <NewServiceCall followUpId={params.parentId} />
            </Suspense>
          )}
        </Route>
        <Route path="/analytics">
          {() => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading analytics...</div>}>
              <Analytics />
            </Suspense>
          )}
        </Route>
        <Route path="/reports">
          {() => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading reports...</div>}>
              <Reports />
            </Suspense>
          )}
        </Route>
        <Route path="/contacts">
          {() => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading contacts...</div>}>
              <Contacts />
            </Suspense>
          )}
        </Route>
        <Route path="/map">
          {() => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading map...</div>}>
              <ServiceMap />
            </Suspense>
          )}
        </Route>
        <Route path="/invoices/new">
          {() => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>}>
              <NewInvoice />
            </Suspense>
          )}
        </Route>
        <Route path="/invoices/:id">
          {(params) => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>}>
              <InvoiceDetail id={params.id} />
            </Suspense>
          )}
        </Route>
        <Route path="/invoices">
          {() => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading invoices...</div>}>
              <Invoices />
            </Suspense>
          )}
        </Route>
        <Route path="/calendar">
          {() => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading calendar...</div>}>
              <CalendarPage />
            </Suspense>
          )}
        </Route>
        <Route path="/equipment">
          {() => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>}>
              <EquipmentHistory />
            </Suspense>
          )}
        </Route>
        <Route path="/calls/:id">
          {(params) => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>}>
              <ServiceCallDetail id={params.id} />
            </Suspense>
          )}
        </Route>
        {user?.role === "manager" && (
          <>
            <Route path="/team">
              {() => (
                <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>}>
                  <Team />
                </Suspense>
              )}
            </Route>
            <Route path="/audit-log">
              {() => (
                <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>}>
                  <AuditLog />
                </Suspense>
              )}
            </Route>
          </>
        )}
        <Route component={NotFound} />
      </Switch>
      <PerplexityAttribution />
    </AppLayout>
  );
}

function App() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    setChecking(false);
    setAuthed(isAuthenticated());
  }, []);

  const handleLogin = async (username: string, password: string): Promise<{ success: boolean; mustChangePassword?: boolean; error?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success && data.token && data.user) {
        setAuth(data.token, data.user);
        if (data.user.mustChangePassword) {
          return { success: true, mustChangePassword: true };
        }
        setAuthed(true);
        queryClient.clear();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch {
      return { success: false, error: "Connection error" };
    }
  };

  const handleChangePassword = async (currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { getAuthHeaders } = await import("@/lib/auth");
      const res = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setAuthed(true);
        queryClient.clear();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch {
      return { success: false, error: "Connection error" };
    }
  };

  if (checking) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[hsl(217,32%,12%)]">
        <div className="text-white text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {authed ? (
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      ) : (
        <LoginScreen onLogin={handleLogin} onChangePassword={handleChangePassword} />
      )}
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
