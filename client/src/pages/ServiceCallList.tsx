import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import { StatusBadge, ClaimBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlusCircle, Search, SlidersHorizontal, X, ChevronRight, ClipboardList,
  Image, Package, MapPin, ArrowRight, Video, PhoneCall, UserCheck,
} from "lucide-react";

function ServiceMethodIcon({ method }: { method: string | null | undefined }) {
  if (!method || method === "In-Person") {
    return <UserCheck className="w-3 h-3 text-muted-foreground/60" aria-label="In-Person" />;
  }
  if (method === "Phone Call") {
    return <PhoneCall className="w-3 h-3 text-[#1a7fad]" aria-label="Phone Call" />;
  }
  if (method === "Video Call") {
    return <Video className="w-3 h-3 text-purple-600 dark:text-purple-400" aria-label="Video Call" />;
  }
  return null;
}
import { MANUFACTURERS, SERVICE_STATUSES, CLAIM_STATUSES, getWarrantyStatus } from "@shared/schema";
import type { ServiceCall } from "@shared/schema";

interface ServiceCallWithCounts extends ServiceCall {
  photoCount: number;
  partCount: number;
}

function WarrantyDot({ installationDate, manufacturer, productType }: { installationDate: string | null | undefined; manufacturer: string; productType?: string | null }) {
  const warranty = getWarrantyStatus(installationDate, manufacturer, productType);
  if (warranty.status === "in-warranty") {
    return <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="In Warranty" data-testid="warranty-dot-in" />;
  }
  if (warranty.status === "out-of-warranty") {
    return <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title="Out of Warranty" data-testid="warranty-dot-out" />;
  }
  return <span className="w-2 h-2 rounded-full bg-gray-400 flex-shrink-0" title="Warranty Unknown" data-testid="warranty-dot-unknown" />;
}

// Status segment config
const STATUS_SEGMENTS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "in-progress", label: "In Progress" },
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "pending-claims", label: "Pending Claims" },
] as const;

// Stat card config
const STAT_CARDS: {
  key: string;
  label: string;
  border: string;
  text: string;
  filter: (c: ServiceCallWithCounts) => boolean;
}[] = [
  {
    key: "open",
    label: "Open",
    border: "border-l-[#1a7fad]",
    text: "text-[#1a7fad]",
    filter: (c) => c.status !== "Completed",
  },
  {
    key: "in-progress",
    label: "In Progress",
    border: "border-l-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    filter: (c) => c.status === "In Progress",
  },
  {
    key: "scheduled",
    label: "Scheduled",
    border: "border-l-purple-500",
    text: "text-purple-600 dark:text-purple-400",
    filter: (c) => c.status === "Scheduled",
  },
  {
    key: "completed",
    label: "Completed",
    border: "border-l-green-500",
    text: "text-green-600 dark:text-green-400",
    filter: (c) => c.status === "Completed",
  },
];

export default function ServiceCallList({ preset: presetProp }: { preset?: string }) {
  const [search, setSearch] = useState("");
  const [filterManufacturer, setFilterManufacturer] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterClaimStatus, setFilterClaimStatus] = useState("");
  const [filterState, setFilterState] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [presetFilter, setPresetFilter] = useState(presetProp || "");

  useEffect(() => {
    setPresetFilter(presetProp || "");
    setSearch("");
    setFilterManufacturer("");
    setFilterStatus("");
    setFilterClaimStatus("");
    setFilterState("");
    setShowFilters(false);
  }, [presetProp]);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (filterManufacturer) params.set("manufacturer", filterManufacturer);
  if (filterStatus) params.set("status", filterStatus);
  if (filterClaimStatus) params.set("claimStatus", filterClaimStatus);
  if (filterState) params.set("state", filterState);

  const queryString = params.toString();

  const { data: calls, isLoading } = useQuery<ServiceCallWithCounts[]>({
    queryKey: ["/api/service-calls", queryString],
    queryFn: async () => {
      const url = queryString ? `/api/service-calls?${queryString}` : "/api/service-calls";
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  // Apply preset / segment filters client-side
  const filteredCalls = useMemo(() => {
    if (!calls) return undefined;
    if (!presetFilter) return calls;
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-31`;
    switch (presetFilter) {
      case "open":
        return calls.filter(c => c.status !== "Completed");
      case "in-progress":
        return calls.filter(c => c.status === "In Progress");
      case "completed":
        return calls.filter(c => c.status === "Completed");
      case "completed-month":
        return calls.filter(c => c.status === "Completed" && c.callDate >= monthStart && c.callDate <= monthEnd);
      case "pending-claims":
        return calls.filter(c => c.claimStatus === "Submitted" || c.claimStatus === "Pending Review");
      case "out-of-warranty":
        return calls.filter(c => c.status !== "Completed" && getWarrantyStatus(c.installationDate, c.manufacturer, c.productType).status === "out-of-warranty");
      case "follow-ups-due": {
        const todayFU = new Date().toISOString().split("T")[0];
        return calls.filter(c => c.followUpDate && c.followUpDate <= todayFU && c.status !== "Completed");
      }
      case "scheduled": {
        const today = new Date().toISOString().split("T")[0];
        return calls.filter(c => c.scheduledDate && c.scheduledDate >= today);
      }
      default:
        return calls;
    }
  }, [calls, presetFilter]);

  // Counts for stat cards (always based on unfiltered calls)
  const counts = useMemo(() => {
    const base: Record<string, number> = {};
    STAT_CARDS.forEach(s => { base[s.key] = 0; });
    (calls ?? []).forEach(c => {
      STAT_CARDS.forEach(s => {
        if (s.filter(c as ServiceCallWithCounts)) base[s.key] += 1;
      });
    });
    return base;
  }, [calls]);

  const presetLabels: Record<string, string> = {
    "open": "Open Calls",
    "in-progress": "In Progress",
    "completed": "Completed",
    "completed-month": "Completed This Month",
    "pending-claims": "Pending Claims",
    "out-of-warranty": "Out of Warranty",
    "follow-ups-due": "Follow-ups Due",
    "scheduled": "Scheduled Calls",
  };

  const activeDropdownFilters = [filterManufacturer, filterStatus, filterClaimStatus, filterState].filter(Boolean).length;

  const clearFilters = () => {
    setFilterManufacturer("");
    setFilterStatus("");
    setFilterClaimStatus("");
    setFilterState("");
    setSearch("");
    setPresetFilter("");
    if (presetProp) {
      window.location.hash = "/calls";
    }
  };

  const handleSegmentClick = (value: string) => {
    if (presetFilter === value) {
      setPresetFilter("");
      if (presetProp) window.location.hash = "/calls";
    } else {
      setPresetFilter(value);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-24 md:pb-6">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Service Calls</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filteredCalls
              ? `${filteredCalls.length} call${filteredCalls.length !== 1 ? "s" : ""}${presetFilter && presetLabels[presetFilter] ? ` — ${presetLabels[presetFilter]}` : ""}`
              : "Loading…"}
          </p>
        </div>
        <Button asChild size="sm" className="shadow-sm" data-testid="button-new-call">
          <Link href="/new">
            <PlusCircle className="w-4 h-4 mr-1.5" />
            New Call
          </Link>
        </Button>
      </div>

      {/* ── Stat Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {STAT_CARDS.map(stat => {
          const active = presetFilter === stat.key;
          return (
            <button
              key={stat.key}
              type="button"
              onClick={() => handleSegmentClick(stat.key)}
              className={`text-left rounded-xl border border-border/50 bg-card p-4 border-l-[3px] ${stat.border} cursor-pointer transition-all hover:shadow-md ${active ? "ring-2 ring-primary/30 shadow-md" : ""}`}
              data-testid={`stat-card-${stat.key}`}
            >
              <p className={`text-2xl font-bold tabular-nums leading-none ${stat.text}`}>{counts[stat.key] ?? 0}</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-2">{stat.label}</p>
            </button>
          );
        })}
      </div>

      {/* ── Search + Filters ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer, site, model, serial…"
            className="bg-card rounded-xl border border-border/50 pl-11 pr-4 py-3 h-auto text-sm shadow-sm"
            data-testid="input-search"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters((v) => !v)}
          className={`gap-1.5 relative rounded-lg h-9 ${showFilters ? "bg-primary/10 border-primary/30" : ""}`}
          data-testid="button-filters"
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeDropdownFilters > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary text-primary-foreground rounded-full text-[10px] flex items-center justify-center font-bold">
              {activeDropdownFilters}
            </span>
          )}
        </Button>
        {(activeDropdownFilters > 0 || search || presetFilter) && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-xs text-muted-foreground transition-colors"
            data-testid="button-clear-filters"
          >
            <X className="w-3 h-3" />
            Clear all
          </button>
        )}
      </div>

      {/* ── Expanded Filter Dropdowns ─────────────────────────────────────── */}
      {showFilters && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 p-4 bg-card rounded-xl border border-border/50">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1.5 block">Manufacturer</label>
            <Select value={filterManufacturer || "__all__"} onValueChange={v => setFilterManufacturer(v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-9 text-xs rounded-lg" data-testid="filter-manufacturer">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Manufacturers</SelectItem>
                {MANUFACTURERS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1.5 block">Status</label>
            <Select value={filterStatus || "__all__"} onValueChange={v => setFilterStatus(v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-9 text-xs rounded-lg" data-testid="filter-status">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Statuses</SelectItem>
                {SERVICE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1.5 block">Claim Status</label>
            <Select value={filterClaimStatus || "__all__"} onValueChange={v => setFilterClaimStatus(v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-9 text-xs rounded-lg" data-testid="filter-claim-status">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Claims</SelectItem>
                {CLAIM_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1.5 block">State</label>
            <Select value={filterState || "__all__"} onValueChange={v => setFilterState(v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-9 text-xs rounded-lg" data-testid="filter-state">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All States</SelectItem>
                <SelectItem value="UT">Utah</SelectItem>
                <SelectItem value="ID">Idaho</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* ── Call List ─────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : !filteredCalls || filteredCalls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-card rounded-xl border border-border/50">
          <ClipboardList className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-base font-semibold text-foreground mb-1">No service calls found</p>
          <p className="text-sm text-muted-foreground">
            {(activeDropdownFilters > 0 || search || presetFilter) ? "Try adjusting your filters or search." : "Create your first service call to get started."}
          </p>
          {(activeDropdownFilters > 0 || search || presetFilter) && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 text-sm text-primary hover:underline"
            >
              Clear all filters
            </button>
          )}
          {!activeDropdownFilters && !search && !presetFilter && (
            <Button asChild size="sm" className="mt-4">
              <Link href="/new">
                <PlusCircle className="w-4 h-4 mr-1.5" />
                New Call
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-card rounded-xl border border-border/50 overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/30 border-b border-border/50">
                  <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-5 py-3">Date</th>
                  <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-5 py-3">Customer / Site</th>
                  <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-5 py-3">Equipment</th>
                  <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-5 py-3">Status</th>
                  <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-5 py-3">Claim</th>
                  <th className="w-10 px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filteredCalls.map((call) => (
                  <tr
                    key={call.id}
                    className="text-sm hover:bg-muted/40 transition-colors cursor-pointer border-b border-border/30 last:border-0"
                    onClick={() => window.location.hash = `/calls/${call.id}`}
                    data-testid={`row-call-${call.id}`}
                  >
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                        <WarrantyDot installationDate={call.installationDate} manufacturer={call.manufacturer} productType={call.productType} />
                        <ServiceMethodIcon method={(call as any).serviceMethod} />
                        {formatDate(call.scheduledDate || call.callDate)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 min-w-[200px]">
                      <p className="font-semibold text-sm text-foreground leading-tight">{call.customerName}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-muted-foreground truncate max-w-[180px]">{call.jobSiteName}</span>
                        {call.jobSiteCity && (
                          <>
                            <span className="text-border">·</span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {call.jobSiteCity}{call.jobSiteState ? `, ${call.jobSiteState}` : ""}
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-xs text-muted-foreground">{call.manufacturer}</p>
                      <p className="font-mono text-xs text-foreground/80 mt-0.5">{call.productModel}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={call.status} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <ClaimBadge status={call.claimStatus} />
                        {(call.photoCount > 0 || call.partCount > 0) && (
                          <div className="flex items-center gap-1.5 text-muted-foreground/60">
                            {call.photoCount > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px]">
                                <Image className="w-3 h-3" />{call.photoCount}
                              </span>
                            )}
                            {call.partCount > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px]">
                                <Package className="w-3 h-3" />{call.partCount}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-muted-foreground/40">
                      <ChevronRight className="w-4 h-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-2.5">
            {filteredCalls.map((call) => (
              <Link
                key={call.id}
                href={`/calls/${call.id}`}
                data-testid={`card-call-${call.id}`}
              >
                <div className="bg-card rounded-xl border border-border/50 p-4 cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <WarrantyDot installationDate={call.installationDate} manufacturer={call.manufacturer} productType={call.productType} />
                      <ServiceMethodIcon method={(call as any).serviceMethod} />
                      <StatusBadge status={call.status} />
                      <span className="text-xs text-muted-foreground">{formatDate(call.scheduledDate || call.callDate)}</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                  </div>
                  <p className="font-semibold text-sm text-foreground">{call.customerName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{call.jobSiteName}</p>
                  <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-border/30">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{call.manufacturer}</span>
                      {call.productModel && (
                        <>
                          <span className="text-border">·</span>
                          <span className="font-mono">{call.productModel}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <ClaimBadge status={call.claimStatus} />
                      {(call.photoCount > 0 || call.partCount > 0) && (
                        <div className="flex items-center gap-1.5 text-muted-foreground/60">
                          {call.photoCount > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px]">
                              <Image className="w-3 h-3" />{call.photoCount}
                            </span>
                          )}
                          {call.partCount > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px]">
                              <Package className="w-3 h-3" />{call.partCount}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {call.jobSiteCity && (
                    <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground/60">
                      <MapPin className="w-2.5 h-2.5" />
                      {call.jobSiteCity}{call.jobSiteState ? `, ${call.jobSiteState}` : ""}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
