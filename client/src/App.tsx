import { useState, useEffect, lazy, Suspense } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AppLayout } from "@/components/Layout";
import { LoginScreen } from "@/components/LoginScreen";
import { setToken, isAuthenticated } from "@/lib/auth";
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
        <Route path="/calls/:id">
          {(params) => (
            <Suspense fallback={<div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>}>
              <ServiceCallDetail id={params.id} />
            </Suspense>
          )}
        </Route>
        <Route component={NotFound} />
      </Switch>
      <PerplexityAttribution />
    </AppLayout>
  );
}

function App() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  // On mount, check if we already have a valid session
  // (won't persist across page refreshes since we can't use localStorage in iframe)
  useEffect(() => {
    setChecking(false);
    setAuthed(isAuthenticated());
  }, []);

  const handleLogin = async (pw: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (data.success && data.token) {
        setToken(data.token);
        setAuthed(true);
        queryClient.clear();
        return true;
      }
      return false;
    } catch {
      return false;
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
        <LoginScreen onLogin={handleLogin} />
      )}
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
