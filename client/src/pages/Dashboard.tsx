import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate, formatTime } from "@/lib/utils";
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
  CloudOff, RefreshCw, ShieldAlert, Bell
} from "lucide-react";
import type { ServiceCall } from "@shared/schema";
import { getWarrantyStatus } from "@shared/schema";

interface DashboardStats {
  totalCalls: number;
  openCalls: number;
  completedThisMonth: number;
  pendingClaims: number;
  followUpsDue: number;
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

  // Fetch follow-ups due
  const { data: followUps } = useQuery<ServiceCallWithCounts[]>({
    queryKey: ["/api/dashboard/follow-ups"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/dashboard/follow-ups");
      return res.json();
    },
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

  const summaryCards = [
    {
      title: "TOTAL SERVICE CALLS",
      value: stats?.totalCalls ?? 0,
      icon: ClipboardCheck,
      color: "text-cyan-700 dark:text-cyan-400",
      bg: "bg-cyan-50 dark:bg-cyan-900/20",
      testId: "stat-total",
      href: "/calls",
    },
    {
      title: "OPEN CALLS",
      value: stats?.openCalls ?? 0,
      icon: Clock,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-900/20",
      testId: "stat-open",
      href: "/calls/filter/open",
    },
    {
      title: "COMPLETED THIS MONTH",
      value: stats?.completedThisMonth ?? 0,
      icon: FileCheck,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-900/20",
      testId: "stat-completed",
      href: "/calls/filter/completed-month",
    },
    {
      title: "PENDING CLAIMS",
      value: stats?.pendingClaims ?? 0,
      icon: PackageSearch,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-900/20",
      testId: "stat-claims",
      href: "/calls/filter/pending-claims",
    },
    ...((stats?.followUpsDue ?? 0) > 0 ? [{
      title: "FOLLOW-UPS DUE",
      value: stats?.followUpsDue ?? 0,
      icon: Bell,
      color: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-50 dark:bg-orange-900/20",
      testId: "stat-followups-due",
      href: "/calls/filter/follow-ups-due",
    }] : []),
    ...(outOfWarrantyCount > 0 ? [{
      title: "OUT OF WARRANTY",
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statsLoading ? (
          [...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-8 w-14" />
                  </div>
                  <Skeleton className="h-10 w-10 rounded-xl" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.title} onClick={() => { window.location.hash = card.href; }} className="cursor-pointer">
                <Card className="overflow-hidden hover:shadow-md hover:border-primary/30 transition-all" data-testid={card.testId}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[10px] tracking-widest text-muted-foreground font-semibold leading-tight mb-2">{card.title}</p>
                        <p className="text-2xl font-bold text-foreground tracking-[-0.02em]" data-testid={`${card.testId}-value`}>
                          {card.value}
                        </p>
                      </div>
                      <div className={`p-2.5 rounded-xl ${card.bg}`}>
                        <Icon className={`w-5 h-5 ${card.color}`} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })
        )}
      </div>

      {/* Follow-ups Due Alert */}
      {followUps && followUps.length > 0 && (
        <Card className="border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20" data-testid="followups-due-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-orange-800 dark:text-orange-300">
              <Bell className="w-4 h-4" />
              {followUps.length} Follow-up{followUps.length !== 1 ? "s" : ""} Due
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-orange-200 dark:divide-orange-800">
              {followUps.slice(0, 5).map(c => (
                <div
                  key={c.id}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-orange-100 dark:hover:bg-orange-900/40 cursor-pointer transition-colors"
                  onClick={() => { window.location.hash = `/calls/${c.id}`; }}
                  data-testid={`followup-row-${c.id}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{c.customerName || `Call #${c.id}`}</p>
                    <p className="text-xs text-muted-foreground">{c.manufacturer} · {formatDate(c.followUpDate!)}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </div>
              ))}
            </div>
            {followUps.length > 5 && (
              <div className="px-4 py-2 text-center">
                <Button variant="ghost" size="sm" className="text-xs text-orange-700 dark:text-orange-300" onClick={() => { window.location.hash = "/calls/filter/follow-ups-due"; }} data-testid="button-view-all-followups">
                  View all {followUps.length} follow-ups
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Service Calls */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold tracking-[-0.01em]">Service Calls</CardTitle>
          <Button variant="ghost" size="sm" asChild className="text-xs text-muted-foreground">
            <Link href="/calls">
              View all <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {recentLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-2">
                  <Skeleton className="h-4 w-20" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
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
                      <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Date</th>
                      <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Customer / Site</th>
                      <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Status</th>
                      <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Scheduled</th>
                      <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Manufacturer</th>
                      <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Model</th>
                      <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Claim</th>
                      <th className="w-8 px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((call) => (
                      <tr
                        key={call.id}
                        className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"

                        onClick={() => window.location.hash = `/calls/${call.id}`}
                        data-testid={`row-call-${call.id}`}
                      >
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap text-xs">{formatDate(call.callDate)}</td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-sm text-foreground">{call.customerName}</p>
                          <p className="text-xs text-muted-foreground">{call.jobSiteName}</p>
                          {(call.jobSiteCity || call.jobSiteState) && (
                            <p className="text-[10px] text-muted-foreground/60">{[call.jobSiteCity, call.jobSiteState].filter(Boolean).join(", ")}</p>
                          )}
                        </td>
                        <td className="px-4 py-2.5"><StatusBadge status={call.status} /></td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                          {call.scheduledDate ? (
                            <>
                              {formatDate(call.scheduledDate)}
                              {call.scheduledTime && (
                                <span className="block text-[10px] text-muted-foreground/70">{formatTime(call.scheduledTime)}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-sm whitespace-nowrap">{call.manufacturer}</td>
                        <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{call.productModel}</td>
                        <td className="px-4 py-2.5"><ClaimBadge status={call.claimStatus} /></td>
                        <td className="px-4 py-2.5 text-muted-foreground">
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
                      <div className="flex items-center gap-2 mb-0.5">
                        <StatusBadge status={call.status} />
                        <span className="text-[10px] text-muted-foreground/70">{formatDate(call.callDate)}</span>
                      </div>
                      <p className="font-medium text-sm text-foreground truncate">{call.customerName}</p>
                      <p className="text-xs text-muted-foreground truncate">{call.manufacturer} · {call.productModel}</p>
                    </div>
                    <div className="flex flex-col items-end flex-shrink-0 gap-1">
                      <ClaimBadge status={call.claimStatus} />
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                    </div>
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
