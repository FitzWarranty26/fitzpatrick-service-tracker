import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import { StatusBadge, ClaimBadge } from "@/components/StatusBadge";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { getPendingCount } from "@/lib/offline-queue";
import { syncPendingCalls } from "@/lib/sync-service";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlusCircle, ClipboardCheck, Clock, PackageSearch, FileCheck, ArrowRight, ChevronRight,
  CloudOff, RefreshCw, ShieldAlert
} from "lucide-react";
import type { ServiceCall } from "@shared/schema";
import { getWarrantyStatus } from "@shared/schema";

interface DashboardStats {
  totalCalls: number;
  openCalls: number;
  completedThisMonth: number;
  pendingClaims: number;
}

interface ServiceCallWithCounts extends ServiceCall {
  photoCount: number;
  partCount: number;
}

export default function Dashboard() {
  const isOnline = useOnlineStatus();
  const { toast } = useToast();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch {
      // IndexedDB may not be available
    }
  }, []);

  // Poll pending count
  useEffect(() => {
    refreshPendingCount();
    const interval = setInterval(refreshPendingCount, 5000);
    return () => clearInterval(interval);
  }, [refreshPendingCount]);

  // Auto-sync when coming back online
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
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent"] });
      if (result.synced > 0) {
        toast({
          title: "Synced",
          description: `${result.synced} service call${result.synced > 1 ? "s" : ""} synced.`,
        });
      }
      if (result.failed > 0) {
        toast({
          title: "Sync issue",
          description: `${result.failed} call${result.failed > 1 ? "s" : ""} failed to sync.`,
          variant: "destructive",
        });
      }
    } finally {
      setSyncing(false);
    }
  };

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: recent, isLoading: recentLoading } = useQuery<ServiceCallWithCounts[]>({
    queryKey: ["/api/dashboard/recent"],
  });

  // Fetch all calls to compute out-of-warranty count
  const { data: allCalls } = useQuery<ServiceCallWithCounts[]>({
    queryKey: ["/api/service-calls"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/service-calls");
      return res.json();
    },
  });

  const outOfWarrantyCount = allCalls
    ? allCalls.filter(c => c.status !== "Completed" && getWarrantyStatus(c.installationDate, c.manufacturer, c.productType).status === "out-of-warranty").length
    : 0;

  // Seed on first load
  useQuery({
    queryKey: ["/api/seed"],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/seed");
      return res.json();
    },
    staleTime: Infinity,
  });

  const summaryCards = [
    {
      title: "Total Service Calls",
      value: stats?.totalCalls ?? 0,
      icon: ClipboardCheck,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-900/20",
      testId: "stat-total",
      href: "/calls",
    },
    {
      title: "Open Calls",
      value: stats?.openCalls ?? 0,
      icon: Clock,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-900/20",
      testId: "stat-open",
      href: "/calls/filter/open",
    },
    {
      title: "Completed This Month",
      value: stats?.completedThisMonth ?? 0,
      icon: FileCheck,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-50 dark:bg-green-900/20",
      testId: "stat-completed",
      href: "/calls/filter/completed-month",
    },
    {
      title: "Pending Claims",
      value: stats?.pendingClaims ?? 0,
      icon: PackageSearch,
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-900/20",
      testId: "stat-claims",
      href: "/calls/filter/pending-claims",
    },
    ...(outOfWarrantyCount > 0 ? [{
      title: "Out of Warranty",
      value: outOfWarrantyCount,
      icon: ShieldAlert,
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-900/20",
      testId: "stat-out-of-warranty",
      href: "/calls/filter/out-of-warranty",
    }] : []),
  ];

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Fitzpatrick Warranty Service, LLC
          </p>
        </div>
        <Button asChild size="sm" data-testid="button-new-call">
          <Link href="/new">
            <PlusCircle className="w-4 h-4 mr-1.5" />
            New Call
          </Link>
        </Button>
      </div>

      {/* Pending Sync Card */}
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} onClick={() => { window.location.hash = card.href; }} className="cursor-pointer">
              <Card className="overflow-hidden hover:shadow-md hover:border-primary/30 transition-all" data-testid={card.testId}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium leading-tight mb-1">{card.title}</p>
                      {statsLoading ? (
                        <Skeleton className="h-8 w-12 mt-1" />
                      ) : (
                        <p className="text-2xl font-bold text-foreground" data-testid={`${card.testId}-value`}>
                          {card.value}
                        </p>
                      )}
                    </div>
                    <div className={`p-2 rounded-lg ${card.bg}`}>
                      <Icon className={`w-4 h-4 ${card.color}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>

      {/* Recent Service Calls */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">Recent Service Calls</CardTitle>
          <Button variant="ghost" size="sm" asChild className="text-xs text-muted-foreground">
            <Link href="/calls">
              View all <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {recentLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !recent || recent.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ClipboardCheck className="w-10 h-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No service calls yet.</p>
              <Button asChild size="sm" className="mt-3" data-testid="button-new-call-empty">
                <Link href="/new">Create your first call</Link>
              </Button>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Date</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Customer / Site</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Manufacturer</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Model</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Claim</th>
                      <th className="w-8 px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((call) => (
                      <tr
                        key={call.id}
                        className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
                        style={{ borderBottomWidth: '5px', borderBottomColor: 'transparent' }}
                        onClick={() => window.location.hash = `/calls/${call.id}`}
                        data-testid={`row-call-${call.id}`}
                      >
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(call.callDate)}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{call.customerName}</p>
                          <p className="text-xs text-muted-foreground">{call.jobSiteName}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{call.manufacturer}</td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{call.productModel}</td>
                        <td className="px-4 py-3"><StatusBadge status={call.status} /></td>
                        <td className="px-4 py-3"><ClaimBadge status={call.claimStatus} /></td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <ChevronRight className="w-4 h-4" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {recent.map((call) => (
                  <Link
                    key={call.id}
                    href={`/calls/${call.id}`}
                    className="flex items-start gap-3 p-4 hover:bg-muted/40 transition-colors border-b border-border last:border-0"
                    data-testid={`card-call-${call.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBadge status={call.status} />
                        <span className="text-xs text-muted-foreground">{formatDate(call.callDate)}</span>
                      </div>
                      <p className="font-medium text-sm text-foreground truncate">{call.customerName}</p>
                      <p className="text-xs text-muted-foreground truncate">{call.manufacturer} · {call.productModel}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                  </Link>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
