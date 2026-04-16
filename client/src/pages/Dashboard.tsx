import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate, formatTime } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { getPendingCount } from "@/lib/offline-queue";
import { syncPendingCalls } from "@/lib/sync-service";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getUser } from "@/lib/auth";
import {
  PlusCircle, CloudOff, RefreshCw, AlertTriangle, ChevronRight,
} from "lucide-react";
import type { ServiceCall } from "@shared/schema";

interface DashboardStats {
  totalCalls: number;
  openCalls: number;
  completedThisMonth: number;
  pendingClaims: number;
  followUpsDue: number;
  revenueThisMonth: number;
  outstandingBalance: number;
  firstTimeFixRate: number;
  avgDaysToPayment: number;
}

interface ServiceCallWithCounts extends ServiceCall {
  photoCount: number;
  partCount: number;
}

interface TodayData {
  todayScheduled: ServiceCallWithCounts[];
  todayCount: number;
  inProgressCount: number;
  overdueInvoices: number;
}

interface ActivityEntry {
  id: number;
  username: string;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: string | null;
  createdAt: string;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  billToName: string;
  status: string;
  dueDate: string | null;
  total: string;
}

function formatRelativeTime(isoStr: string): string {
  try {
    const then = new Date(isoStr);
    const now = new Date();
    const diffMs = now.getTime() - then.getTime();
    const diffMin = Math.floor(diffMs / (1000 * 60));
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return "yesterday";
    if (diffDay < 7) return `${diffDay} days ago`;
    return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function daysBetween(from: string, to: Date): number {
  const f = new Date(from + (from.length === 10 ? "T00:00:00" : ""));
  return Math.floor((to.getTime() - f.getTime()) / (1000 * 60 * 60 * 24));
}

export default function Dashboard() {
  const isOnline = useOnlineStatus();
  const { toast } = useToast();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const user = getUser();
  const isManager = user?.role === "manager";

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch {
      // IndexedDB may not be available
    }
  }, []);

  useEffect(() => {
    refreshPendingCount();
    const interval = setInterval(refreshPendingCount, 5000);
    return () => clearInterval(interval);
  }, [refreshPendingCount]);

  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      handleSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const handleSync = async () => {
    if (syncing || !isOnline) return;
    setSyncing(true);
    try {
      const result = await syncPendingCalls();
      await refreshPendingCount();
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/today"] });
      if (result.synced > 0) {
        toast({ title: "Synced", description: `${result.synced} service call${result.synced > 1 ? "s" : ""} synced.` });
      }
      if (result.failed > 0) {
        toast({ title: "Sync issue", description: `${result.failed} call${result.failed > 1 ? "s" : ""} failed to sync.`, variant: "destructive" });
      }
    } finally {
      setSyncing(false);
    }
  };

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: today, isLoading: todayLoading } = useQuery<TodayData>({
    queryKey: ["/api/dashboard/today"],
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: recent } = useQuery<ServiceCallWithCounts[]>({
    queryKey: ["/api/dashboard/recent"],
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: followUps } = useQuery<ServiceCallWithCounts[]>({
    queryKey: ["/api/dashboard/follow-ups"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/dashboard/follow-ups");
      return res.json();
    },
  });

  const { data: activity } = useQuery<ActivityEntry[]>({
    queryKey: ["/api/dashboard/activity"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/dashboard/activity");
      return res.json();
    },
    staleTime: 0,
  });

  const { data: invoices } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/invoices");
      return res.json();
    },
    enabled: isManager,
  });

  // Seed on first load
  useQuery({
    queryKey: ["/api/seed"],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/seed");
      return res.json();
    },
    staleTime: Infinity,
  });

  const now = new Date();
  const todayLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  }).format(now);
  const todayISO = now.toISOString().split("T")[0];

  // Overdue invoices (detailed, for Needs Attention)
  const overdueInvoices = (invoices || []).filter(inv => {
    if (inv.status === "Paid" || inv.status === "Draft") return false;
    if (!inv.dueDate) return false;
    return new Date(inv.dueDate) < now;
  });

  // Past-scheduled incomplete calls
  const pastScheduled = (recent || []).filter(c => {
    if (c.status === "Completed") return false;
    if (!c.scheduledDate) return false;
    return c.scheduledDate < todayISO;
  });

  // Build "Needs Attention" list
  const attentionItems: Array<{ key: string; accent: "red" | "amber"; title: string; subtitle: string; href: string }> = [];
  overdueInvoices.slice(0, 8).forEach(inv => {
    const days = daysBetween(inv.dueDate!, now);
    attentionItems.push({
      key: `inv-${inv.id}`,
      accent: "red",
      title: inv.invoiceNumber,
      subtitle: `${inv.billToName} · ${days} day${days !== 1 ? "s" : ""} overdue`,
      href: `/invoices/${inv.id}`,
    });
  });
  (followUps || []).slice(0, 8).forEach(c => {
    if (attentionItems.length >= 8) return;
    attentionItems.push({
      key: `fu-${c.id}`,
      accent: "amber",
      title: `Call #${c.id} · ${c.customerName || c.jobSiteName || "Unknown"}`,
      subtitle: `follow-up due ${formatDate(c.followUpDate!)}`,
      href: `/calls/${c.id}`,
    });
  });
  pastScheduled.slice(0, 8).forEach(c => {
    if (attentionItems.length >= 8) return;
    attentionItems.push({
      key: `past-${c.id}`,
      accent: "amber",
      title: `Call #${c.id} · ${c.customerName || c.jobSiteName || "Unknown"}`,
      subtitle: `scheduled ${formatDate(c.scheduledDate!)} — not completed`,
      href: `/calls/${c.id}`,
    });
  });

  // Today's schedule items — fall back to next upcoming if nothing today
  const scheduleItems = today?.todayScheduled ?? [];
  const fallbackUpcoming = (recent || [])
    .filter(c => c.status !== "Completed" && c.scheduledDate && c.scheduledDate > todayISO)
    .slice(0, 8);
  const showingFallback = scheduleItems.length === 0 && fallbackUpcoming.length > 0;
  const displayedSchedule = scheduleItems.length > 0 ? scheduleItems.slice(0, 8) : fallbackUpcoming;

  // KPI cards
  const ftfrDisplay = stats && stats.completedThisMonth > 0 && stats.firstTimeFixRate > 0
    ? `${stats.firstTimeFixRate}%`
    : "—";

  const baseCards: Array<{ label: string; value: string | number; color: string; href: string }> = [
    { label: "Open Calls", value: stats?.openCalls ?? 0, color: "border-l-blue-500", href: "/calls/filter/open" },
    { label: "Completed This Month", value: stats?.completedThisMonth ?? 0, color: "border-l-emerald-500", href: "/calls/filter/completed-month" },
    { label: "First-Time Fix Rate", value: ftfrDisplay, color: "border-l-amber-500", href: "/calls" },
  ];
  const managerCards: Array<{ label: string; value: string | number; color: string; href: string }> = [
    { label: "Revenue This Month", value: stats ? formatCurrency(stats.revenueThisMonth) : "—", color: "border-l-blue-500", href: "/invoices" },
    { label: "Outstanding Balance", value: stats ? formatCurrency(stats.outstandingBalance) : "—", color: "border-l-amber-500", href: "/invoices" },
    { label: "Avg Days to Payment", value: stats && stats.avgDaysToPayment > 0 ? `${stats.avgDaysToPayment}d` : "—", color: "border-l-emerald-500", href: "/invoices" },
  ];
  const cards = isManager ? [...baseCards, ...managerCards] : baseCards;
  const gridCols = isManager ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-6" : "grid-cols-1 md:grid-cols-3";

  const overdueCount = today?.overdueInvoices ?? 0;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Fitzpatrick Warranty Service, LLC</p>
        </div>
        <Button asChild size="sm" data-testid="button-new-call">
          <Link href="/new">
            <PlusCircle className="w-4 h-4 mr-1.5" />
            New Call
          </Link>
        </Button>
      </div>

      {/* Pending Sync */}
      {pendingCount > 0 && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20" data-testid="pending-sync-card">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40">
                <CloudOff className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  {pendingCount} pending service call{pendingCount > 1 ? "s" : ""}
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {isOnline ? "Ready to sync" : "Will sync when back online"}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!isOnline || syncing}
              onClick={handleSync}
              className="border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              data-testid="button-sync-dashboard"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync Now"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Row 1: Today's Snapshot */}
      <div
        className="bg-card rounded-lg border p-4 flex items-center justify-between flex-wrap gap-3"
        data-testid="today-snapshot"
      >
        <div className="flex items-center gap-2 text-sm md:text-base font-semibold text-foreground">
          <span>📅</span>
          <span>{todayLabel}</span>
        </div>
        <div className="hidden md:block h-4 w-px bg-border" />
        <div className="text-sm text-foreground">
          <span className="font-semibold">{todayLoading ? "…" : today?.todayCount ?? 0}</span>
          <span className="text-muted-foreground"> {(today?.todayCount ?? 0) === 1 ? "call" : "calls"} today</span>
        </div>
        <div className="hidden md:block h-4 w-px bg-border" />
        <div className="text-sm text-foreground">
          <span className="font-semibold">{todayLoading ? "…" : today?.inProgressCount ?? 0}</span>
          <span className="text-muted-foreground"> in progress</span>
        </div>
        {isManager && overdueCount > 0 && (
          <>
            <div className="hidden md:block h-4 w-px bg-border" />
            <div
              className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5 cursor-pointer"
              onClick={() => { window.location.hash = "/invoices"; }}
              data-testid="overdue-invoices"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>{overdueCount} overdue invoice{overdueCount !== 1 ? "s" : ""}</span>
            </div>
          </>
        )}
      </div>

      {/* Row 2: KPI Cards */}
      <div className={`grid ${gridCols} gap-3`}>
        {statsLoading ? (
          [...Array(isManager ? 6 : 3)].map((_, i) => (
            <div key={i} className="bg-card rounded-lg border p-4 border-l-4 border-l-muted">
              <Skeleton className="h-3 w-24 mb-2" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))
        ) : (
          cards.map((card) => (
            <div
              key={card.label}
              onClick={() => { window.location.hash = card.href; }}
              className={`bg-card rounded-lg border p-4 border-l-4 ${card.color} hover:shadow-md transition-all cursor-pointer`}
              data-testid={`kpi-${card.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">{card.label}</p>
              <p className="text-2xl font-bold text-foreground tracking-[-0.02em]">{card.value}</p>
            </div>
          ))
        )}
      </div>

      {/* Row 3: Two-column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Today's Schedule */}
        <Card data-testid="today-schedule">
          <CardContent className="p-4 md:p-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
              Today's Schedule
            </h2>
            {todayLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            ) : displayedSchedule.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No upcoming calls</p>
            ) : (
              <>
                {showingFallback && (
                  <p className="text-xs text-muted-foreground mb-3">Nothing scheduled today — next up:</p>
                )}
                <div className="space-y-1">
                  {displayedSchedule.map(call => (
                    <div
                      key={call.id}
                      onClick={() => { window.location.hash = `/calls/${call.id}`; }}
                      className="flex items-center gap-3 p-2 -mx-2 hover:bg-muted/50 transition-colors cursor-pointer rounded"
                      data-testid={`schedule-row-${call.id}`}
                    >
                      <StatusBadge status={call.status} />
                      {call.scheduledTime && (
                        <span className="text-xs font-medium text-muted-foreground tabular-nums whitespace-nowrap">
                          {formatTime(call.scheduledTime)}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {call.customerName || call.jobSiteName || `Call #${call.id}`}
                        </p>
                        {(call.jobSiteCity || call.jobSiteState) && (
                          <p className="text-xs text-muted-foreground truncate">
                            {[call.jobSiteCity, call.jobSiteState].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t">
                  <Link href="/scheduled" className="text-xs text-primary hover:underline">
                    View all →
                  </Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Needs Attention */}
        <Card data-testid="needs-attention">
          <CardContent className="p-4 md:p-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
              Needs Attention
            </h2>
            {attentionItems.length === 0 ? (
              <p className="text-sm text-emerald-600 dark:text-emerald-400 text-center py-8">
                All caught up ✓
              </p>
            ) : (
              <div className="space-y-1">
                {attentionItems.slice(0, 8).map(item => (
                  <div
                    key={item.key}
                    onClick={() => { window.location.hash = item.href; }}
                    className="flex items-center gap-3 p-2 -mx-2 hover:bg-muted/50 transition-colors cursor-pointer rounded"
                    data-testid={`attention-${item.key}`}
                  >
                    <div
                      className={`w-1 self-stretch rounded-full flex-shrink-0 ${item.accent === "red" ? "bg-red-500" : "bg-amber-500"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Recent Activity */}
      <Card data-testid="recent-activity">
        <CardContent className="p-4 md:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
            Recent Activity
          </h2>
          {!activity || activity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No recent activity</p>
          ) : (
            <div className="divide-y divide-border">
              {activity.map(entry => (
                <div
                  key={entry.id}
                  className="flex items-baseline gap-2 py-2 text-xs md:text-sm"
                  data-testid={`activity-${entry.id}`}
                >
                  <span className="font-medium text-foreground whitespace-nowrap">{entry.username}</span>
                  <span className="text-muted-foreground flex-1 truncate">
                    {entry.action}
                    {entry.entityType && entry.entityId ? ` · ${entry.entityType} #${entry.entityId}` : ""}
                  </span>
                  <span className="text-muted-foreground/70 whitespace-nowrap text-xs">
                    {formatRelativeTime(entry.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
