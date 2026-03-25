import { useState } from "react";
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
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlusCircle, Search, Filter, X, ChevronRight, ClipboardList, Image, Package
} from "lucide-react";
import { MANUFACTURERS, SERVICE_STATUSES, CLAIM_STATUSES } from "@shared/schema";
import type { ServiceCall } from "@shared/schema";

interface ServiceCallWithCounts extends ServiceCall {
  photoCount: number;
  partCount: number;
}

function getInitialFilter(): { status?: string; claimStatus?: string; preset?: string } {
  try {
    const hash = window.location.hash; // e.g. #/calls?filter=open
    const qIndex = hash.indexOf("?");
    if (qIndex === -1) return {};
    const params = new URLSearchParams(hash.slice(qIndex + 1));
    const filter = params.get("filter");
    if (filter === "open") return { preset: "open" };
    if (filter === "completed-month") return { preset: "completed-month" };
    if (filter === "pending-claims") return { preset: "pending-claims" };
    return {};
  } catch { return {}; }
}

export default function ServiceCallList() {
  const initial = getInitialFilter();
  const [search, setSearch] = useState("");
  const [filterManufacturer, setFilterManufacturer] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterClaimStatus, setFilterClaimStatus] = useState("");
  const [filterState, setFilterState] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [presetFilter, setPresetFilter] = useState(initial.preset || "");

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

  // Apply preset filters client-side
  const filteredCalls = (() => {
    if (!calls) return undefined;
    if (!presetFilter) return calls;
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-31`;
    switch (presetFilter) {
      case "open":
        return calls.filter(c => c.status !== "Completed");
      case "completed-month":
        return calls.filter(c => c.status === "Completed" && c.callDate >= monthStart && c.callDate <= monthEnd);
      case "pending-claims":
        return calls.filter(c => c.claimStatus === "Submitted" || c.claimStatus === "Pending Review");
      default:
        return calls;
    }
  })();

  const presetLabels: Record<string, string> = {
    "open": "Open Calls",
    "completed-month": "Completed This Month",
    "pending-claims": "Pending Claims",
  };

  const activeFilters = [filterManufacturer, filterStatus, filterClaimStatus, filterState, presetFilter].filter(Boolean).length;

  const clearFilters = () => {
    setFilterManufacturer("");
    setFilterStatus("");
    setFilterClaimStatus("");
    setFilterState("");
    setSearch("");
    setPresetFilter("");
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-bold">Service Calls</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filteredCalls ? `${filteredCalls.length} call${filteredCalls.length !== 1 ? "s" : ""}${presetFilter ? ` — ${presetLabels[presetFilter]}` : ""}` : "Loading…"}
          </p>
        </div>
        <Button asChild size="sm" data-testid="button-new-call">
          <Link href="/new">
            <PlusCircle className="w-4 h-4 mr-1.5" />
            New Call
          </Link>
        </Button>
      </div>

      {/* Search + Filter bar */}
      <div className="space-y-3 mb-5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer, site, model, serial…"
              className="pl-9"
              data-testid="input-search"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            className="gap-1.5 relative"
            data-testid="button-filters"
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilters > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary text-primary-foreground rounded-full text-[10px] flex items-center justify-center font-bold">
                {activeFilters}
              </span>
            )}
          </Button>
          {(activeFilters > 0 || search) && (
            <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 border border-border rounded-lg bg-muted/30">
            <Select value={filterManufacturer} onValueChange={setFilterManufacturer}>
              <SelectTrigger className="h-8 text-xs" data-testid="filter-manufacturer">
                <SelectValue placeholder="Manufacturer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Manufacturers</SelectItem>
                {MANUFACTURERS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 text-xs" data-testid="filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Statuses</SelectItem>
                {SERVICE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filterClaimStatus} onValueChange={setFilterClaimStatus}>
              <SelectTrigger className="h-8 text-xs" data-testid="filter-claim-status">
                <SelectValue placeholder="Claim Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Claim Statuses</SelectItem>
                {CLAIM_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filterState} onValueChange={setFilterState}>
              <SelectTrigger className="h-8 text-xs" data-testid="filter-state">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All States</SelectItem>
                <SelectItem value="UT">Utah</SelectItem>
                <SelectItem value="ID">Idaho</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !filteredCalls || filteredCalls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ClipboardList className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No service calls found.</p>
          {(activeFilters > 0 || search) && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="mt-2 text-primary">
              Clear filters
            </Button>
          )}
          {!activeFilters && !search && (
            <Button asChild size="sm" className="mt-3">
              <Link href="/new">Create first call</Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Customer / Site</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Manufacturer</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Model</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">City</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Claim</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Docs</th>
                      <th className="w-8 px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCalls.map((call) => (
                      <tr
                        key={call.id}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                        style={{ borderBottomWidth: '5px', borderBottomColor: 'transparent' }}
                        onClick={() => window.location.hash = `/calls/${call.id}`}
                        data-testid={`row-call-${call.id}`}
                      >
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">{formatDate(call.callDate)}</td>
                        <td className="px-4 py-3 min-w-[180px]">
                          <p className="font-medium text-foreground">{call.customerName}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[200px]">{call.jobSiteName}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{call.manufacturer}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{call.productModel}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{call.jobSiteCity}, {call.jobSiteState}</td>
                        <td className="px-4 py-3"><StatusBadge status={call.status} /></td>
                        <td className="px-4 py-3"><ClaimBadge status={call.claimStatus} /></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            {call.photoCount > 0 && (
                              <span className="flex items-center gap-0.5 text-xs">
                                <Image className="w-3 h-3" />{call.photoCount}
                              </span>
                            )}
                            {call.partCount > 0 && (
                              <span className="flex items-center gap-0.5 text-xs">
                                <Package className="w-3 h-3" />{call.partCount}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <ChevronRight className="w-4 h-4" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {filteredCalls.map((call) => (
              <Link
                key={call.id}
                href={`/calls/${call.id}`}
                data-testid={`card-call-${call.id}`}
              >
                <Card className="overflow-hidden hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <StatusBadge status={call.status} />
                          <span className="text-xs text-muted-foreground">{formatDate(call.callDate)}</span>
                        </div>
                        <p className="font-semibold text-sm text-foreground">{call.customerName}</p>
                        <p className="text-xs text-muted-foreground truncate">{call.jobSiteName}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {call.manufacturer} · <span className="font-mono">{call.productModel}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{call.jobSiteCity}, {call.jobSiteState}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        <ClaimBadge status={call.claimStatus} />
                        <div className="flex gap-2 text-muted-foreground">
                          {call.photoCount > 0 && (
                            <span className="flex items-center gap-0.5 text-xs">
                              <Image className="w-3 h-3" />{call.photoCount}
                            </span>
                          )}
                          {call.partCount > 0 && (
                            <span className="flex items-center gap-0.5 text-xs">
                              <Package className="w-3 h-3" />{call.partCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
