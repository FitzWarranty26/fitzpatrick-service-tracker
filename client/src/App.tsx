import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AppLayout } from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import ServiceCallList from "@/pages/ServiceCallList";
import NewServiceCall from "@/pages/NewServiceCall";
import ServiceCallDetail from "@/pages/ServiceCallDetail";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

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
        <Route path="/calls" component={ServiceCallList} />
        <Route path="/new" component={NewServiceCall} />
        <Route path="/calls/:id">
          {(params) => <ServiceCallDetail id={params.id} />}
        </Route>
        <Route component={NotFound} />
      </Switch>
      <PerplexityAttribution />
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <AppRouter />
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
