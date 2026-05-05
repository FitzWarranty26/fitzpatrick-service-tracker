import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { PageHero } from "@/components/PageHero";
import { formatDate } from "@/lib/utils";
import { getUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlusCircle, Search, SlidersHorizontal, X, ChevronRight, ClipboardList,
  MapPin, ArrowRight, Calendar as CalendarIcon, ChevronUp, ChevronDown,
  Clock, Wrench, Package as PackageIcon, AlertTriangle, FileText, DollarSign,
} from "lucide-react";
import { MANUFACTURERS, SERVICE_STATUSES, getWarrantyStatus } from "@shared/schema";
import type { ServiceCall } from "@shared/schema";

// ─── Types ──────────────────────────────────────────────────────────────────
interface ServiceCallRow extends ServiceCall {
  photoCount: number;
  partCount: number;
  visitCount: number;
  primaryTechnicianId: number | null;
  primaryTechnicianName: string | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;     // Draft | Sent | Paid | Overdue
  invoiceTotal: string | null;
  invoiceDueDate: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function ageDays(call: ServiceCallRow): number {
  // Count from call_date to today (closed calls clamp to call_date->updatedAt-ish, but we
  // visually treat completed as "closed" so age isn't shown)
  return daysBetween(call.callDate, todayISO());
}

function fmtMoney(n: string | null | undefined): string {
  if (!n) return "$0";
  const num = parseFloat(n);
  if (isNaN(num)) return "$0";
  if (num >= 10000) return `$${(num / 1000).toFixed(1)}k`;
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic color from a tech id so the same tech gets the same avatar color
const AVATAR_GRADIENTS = [
  "from-sky-500 to-blue-600",
  "from-emerald-500 to-teal-600",
  "from-violet-500 to-purple-600",
  "from-orange-500 to-amber-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-blue-500",
  "from-lime-500 to-emerald-500",
  "from-fuchsia-500 to-violet-500",
];
function avatarGradient(id: number | null): string {
  if (id == null) return "from-muted to-muted";
  return AVATAR_GRADIENTS[Math.abs(id) % AVATAR_GRADIENTS.length];
}

// ─── Status chip ────────────────────────────────────────────────────────────
function StatusChip({ status }: { status: string }) {
  const cfg: Record<string, { cls: string; dot?: string }> = {
    "Scheduled":     { cls: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30" },
    "In Progress":   { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30" },
    "Completed":     { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30" },
    "Pending Parts": { cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30" },
    "Escalated":     { cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30" },
  };
  const c = cfg[status] || { cls: "bg-muted text-muted-foreground border border-border" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.cls}`}
      data-testid={`status-chip-${status.toLowerCase().replace(/\s+/g, "-")}`}>
      {status === "Scheduled" && <CalendarIcon className="w-3 h-3" />}
      {status === "In Progress" && <Wrench className="w-3 h-3" />}
      {status === "Completed" && <span className="text-[10px]">✓</span>}
      {status === "Pending Parts" && <PackageIcon className="w-3 h-3" />}
      {status === "Escalated" && <AlertTriangle className="w-3 h-3" />}
      {status}
    </span>
  );
}

// ─── Aging cell ─────────────────────────────────────────────────────────────
function AgingCell({ call }: { call: ServiceCallRow }) {
  if (call.status === "Completed") {
    return (
      <div>
        <p className="text-[12px] font-semibold text-muted-foreground">closed</p>
        <p className="text-[10.5px] text-muted-foreground/70 mt-0.5">{formatDate(call.callDate)}</p>
      </div>
    );
  }
  const days = ageDays(call);
  const tone = days >= 14 ? "text-rose-600 dark:text-rose-400"
             : days >= 7  ? "text-amber-600 dark:text-amber-400"
             :              "text-foreground";
  const label = days === 0 ? "today" : `${days}d`;
  return (
    <div>
      <p className={`text-[13px] font-bold tabular-nums leading-none ${tone}`} data-testid={`aging-${call.id}`}>
        {label}
      </p>
      <p className="text-[10.5px] text-muted-foreground/70 mt-1">since {formatDate(call.callDate)}</p>
    </div>
  );
}

// ─── Tech avatar ────────────────────────────────────────────────────────────
function TechCell({ call }: { call: ServiceCallRow }) {
  if (!call.primaryTechnicianId) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full border border-dashed border-border flex items-center justify-center text-muted-foreground/60 text-[11px] font-bold">
          ?
        </div>
        <span className="text-[12px] text-muted-foreground/70">Unassigned</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${avatarGradient(call.primaryTechnicianId)} flex items-center justify-center text-white text-[10.5px] font-bold ring-1 ring-background`}>
        {initials(call.primaryTechnicianName)}
      </div>
      <span className="text-[12px] text-foreground/80 truncate max-w-[110px]">
        {call.primaryTechnicianName?.split(" ")[0]}
      </span>
    </div>
  );
}

// ─── Invoice chip ───────────────────────────────────────────────────────────
function InvoiceCell({ call }: { call: ServiceCallRow }) {
  // For non-completed calls without an invoice, show em-dash
  if (!call.invoiceId) {
    if (call.status === "Completed") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-muted/60 text-muted-foreground/80 border border-border">
          Unbilled
        </span>
      );
    }
    return <span className="text-muted-foreground/40 text-xs">—</span>;
  }
  const today = todayISO();
  const isOverdue = call.invoiceStatus === "Overdue" || (
    call.invoiceStatus === "Sent" && call.invoiceDueDate && call.invoiceDueDate < today
  );
  let cls = "bg-muted/60 text-muted-foreground border-border";
  let label = call.invoiceStatus || "Invoice";
  if (call.invoiceStatus === "Paid") {
    cls = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
    label = "Paid";
  } else if (isOverdue) {
    cls = "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30";
    label = "Overdue";
  } else if (call.invoiceStatus === "Sent") {
    cls = "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30";
    label = "Sent";
  } else if (call.invoiceStatus === "Draft") {
    cls = "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30";
    label = "Draft";
  }
  return (
    <Link href={`/invoices/${call.invoiceId}`} onClick={(e) => e.stopPropagation()}>
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${cls} hover:brightness-110 cursor-pointer whitespace-nowrap`}
        data-testid={`invoice-chip-${call.id}`}
        title={`${call.invoiceNumber} · ${formatDate(call.invoiceDueDate)}`}
      >
        {label}
        {call.invoiceTotal && <span className="font-semibold">· {fmtMoney(call.invoiceTotal)}</span>}
      </span>
    </Link>
  );
}

// ─── Saved Views (preset chips) ─────────────────────────────────────────────
type ViewKey =
  | "all-open" | "in-progress" | "my-calls" | "today" | "overdue-aging" | "awaiting-parts"
  | "unbilled" | "scheduled" | "completed-month" | "all";

interface ViewDef {
  key: ViewKey;
  label: string;
  filter: (c: ServiceCallRow, ctx: { userId: number | null; today: string }) => boolean;
}

const VIEWS: ViewDef[] = [
  { key: "all-open",        label: "All Open",       filter: (c) => c.status !== "Completed" },
  { key: "in-progress",     label: "In Progress",    filter: (c) => c.status === "In Progress" },
  { key: "my-calls",        label: "My Calls",       filter: (c, { userId }) => userId != null && c.primaryTechnicianId === userId && c.status !== "Completed" },
  { key: "today",           label: "Today",          filter: (c, { today }) => c.scheduledDate === today && c.status !== "Completed" },
  { key: "overdue-aging",   label: "Overdue",        filter: (c) => c.status !== "Completed" && ageDays(c) >= 14 },
  { key: "awaiting-parts",  label: "Awaiting Parts", filter: (c) => c.status === "Pending Parts" },
  { key: "unbilled",        label: "Unbilled",       filter: (c) => c.status === "Completed" && !c.invoiceId },
  { key: "scheduled",       label: "Scheduled",      filter: (c, { today }) => c.scheduledDate != null && c.scheduledDate >= today && c.status !== "Completed" },
  { key: "completed-month", label: "Completed (MTD)", filter: (c, { today }) => {
    if (c.status !== "Completed") return false;
    return c.callDate.slice(0, 7) === today.slice(0, 7);
  } },
  { key: "all",             label: "All",            filter: () => true },
];

// Map app's :preset URL slugs to view keys
function presetToView(p?: string): ViewKey | null {
  if (!p) return null;
  const map: Record<string, ViewKey> = {
    "open":             "all-open",
    "in-progress":      "in-progress",
    "scheduled":        "scheduled",
    "completed":        "completed-month",
    "completed-month":  "completed-month",
    "pending-claims":   "all",             // claims handled separately
    "out-of-warranty":  "all",
    "follow-ups-due":   "all-open",
  };
  return map[p] || null;
}

// ─── Stat cards ────────────────────────────────────────────────────────────
// KPI cards — clicking each one filters the table to the matching view.
// `viewKey` references the saved-views chips below the strip, so the active
// state is shared (clicking 'Open' here is the same as clicking 'All Open').
const STAT_CARDS = [
  { key: "open",        viewKey: "all-open" as ViewKey,        label: "Open",        accent: "border-l-sky-500",       hoverAccent: "hover:border-l-sky-400",       num: "text-sky-600 dark:text-sky-400",       filter: (c: ServiceCallRow) => c.status !== "Completed" },
  { key: "in-progress", viewKey: "in-progress" as ViewKey,     label: "In Progress", accent: "border-l-amber-500",     hoverAccent: "hover:border-l-amber-400",     num: "text-amber-600 dark:text-amber-400",   filter: (c: ServiceCallRow) => c.status === "In Progress" },
  { key: "scheduled",   viewKey: "scheduled" as ViewKey,       label: "Scheduled",   accent: "border-l-cyan-500",      hoverAccent: "hover:border-l-cyan-400",      num: "text-cyan-600 dark:text-cyan-400",     filter: (c: ServiceCallRow) => c.status === "Scheduled" },
  { key: "completed",   viewKey: "completed-month" as ViewKey, label: "Completed",   accent: "border-l-emerald-500",   hoverAccent: "hover:border-l-emerald-400",   num: "text-emerald-600 dark:text-emerald-400", filter: (c: ServiceCallRow) => c.status === "Completed" },
] as const;

// ─── Sort ───────────────────────────────────────────────────────────────────
type SortKey = "date" | "customer" | "status" | "age";
type SortDir = "asc" | "desc";

function sortCalls(arr: ServiceCallRow[], key: SortKey, dir: SortDir): ServiceCallRow[] {
  const mult = dir === "asc" ? 1 : -1;
  const cmpStr = (a: string | null | undefined, b: string | null | undefined) =>
    (a || "").localeCompare(b || "") * mult;
  const cmpNum = (a: number, b: number) => (a - b) * mult;
  const out = [...arr];
  out.sort((a, b) => {
    if (key === "date")     return cmpStr(a.callDate, b.callDate);
    if (key === "customer") return cmpStr(a.customerName, b.customerName);
    if (key === "status")   return cmpStr(a.status, b.status);
    if (key === "age") {
      // closed last; otherwise by age desc visually
      const A = a.status === "Completed" ? -1 : ageDays(a);
      const B = b.status === "Completed" ? -1 : ageDays(b);
      return cmpNum(A, B);
    }
    return 0;
  });
  return out;
}

function SortHeader({ label, sortKey, current, dir, onClick, className = "" }:
  { label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onClick: (k: SortKey) => void; className?: string }) {
  const active = current === sortKey;
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] font-semibold transition-colors ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"} ${className}`}
      data-testid={`sort-${sortKey}`}
    >
      {label}
      {active ? (dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
    </button>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function ServiceCallList({ preset: presetProp }: { preset?: string }) {
  const currentUser = getUser();
  const userId = currentUser?.id ?? null;
  const today = todayISO();

  // View / search / filters
  const [activeView, setActiveView] = useState<ViewKey>(() => presetToView(presetProp) || "all-open");
  const [search, setSearch] = useState("");
  const [filterManufacturer, setFilterManufacturer] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterState, setFilterState] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    setActiveView(presetToView(presetProp) || "all-open");
    setSearch("");
    setFilterManufacturer("");
    setFilterStatus("");
    setFilterState("");
    setShowFilters(false);
  }, [presetProp]);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (filterManufacturer) params.set("manufacturer", filterManufacturer);
  if (filterStatus) params.set("status", filterStatus);
  if (filterState) params.set("state", filterState);
  const queryString = params.toString();

  const { data: calls, isLoading } = useQuery<ServiceCallRow[]>({
    queryKey: ["/api/service-calls", queryString],
    queryFn: async () => {
      const url = queryString ? `/api/service-calls?${queryString}` : "/api/service-calls";
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  // Apply view filter
  const filtered = useMemo(() => {
    if (!calls) return undefined;
    const view = VIEWS.find(v => v.key === activeView) || VIEWS[0];
    return calls.filter(c => view.filter(c, { userId, today }));
  }, [calls, activeView, userId, today]);

  // Apply sort
  const sorted = useMemo(() => {
    if (!filtered) return undefined;
    return sortCalls(filtered, sortKey, sortDir);
  }, [filtered, sortKey, sortDir]);

  // KPI counts (against unfiltered set so totals are stable)
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    STAT_CARDS.forEach(s => { out[s.key] = 0; });
    (calls ?? []).forEach(c => {
      STAT_CARDS.forEach(s => { if (s.filter(c)) out[s.key] += 1; });
    });
    return out;
  }, [calls]);

  // View counts
  const viewCounts = useMemo(() => {
    const out: Record<ViewKey, number> = {
      "all-open": 0, "in-progress": 0, "my-calls": 0, "today": 0, "overdue-aging": 0,
      "awaiting-parts": 0, "unbilled": 0, "scheduled": 0, "completed-month": 0, "all": 0,
    };
    (calls ?? []).forEach(c => {
      VIEWS.forEach(v => { if (v.filter(c, { userId, today })) out[v.key] += 1; });
    });
    return out;
  }, [calls, userId, today]);

  const activeDropdownFilters = [filterManufacturer, filterStatus, filterState].filter(Boolean).length;
  const clearFilters = () => {
    setFilterManufacturer("");
    setFilterStatus("");
    setFilterState("");
    setSearch("");
    setActiveView("all-open");
    if (presetProp) window.location.hash = "/calls";
  };

  const handleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "customer" ? "asc" : "desc");
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-24 md:pb-6 space-y-4">
      <PageHero
        title="Service Calls"
        subtitle={
          sorted
            ? <span>{sorted.length} call{sorted.length !== 1 ? "s" : ""} · operational view</span>
            : <span>Loading…</span>
        }
        actions={
          <Button asChild size="sm" className="shadow-sm" data-testid="button-new-call">
            <Link href="/new">
              <PlusCircle className="w-4 h-4 mr-1.5" />
              New Call
            </Link>
          </Button>
        }
      />

      {/* ── KPI Strip (clickable filters) ────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STAT_CARDS.map(stat => {
          const isActive = activeView === stat.viewKey;
          return (
            <button
              key={stat.key}
              type="button"
              onClick={() => setActiveView(stat.viewKey)}
              className={`text-left rounded-xl border bg-card p-4 border-l-[3px] transition-all cursor-pointer hover:shadow-sm ${stat.accent} ${
                isActive
                  ? "border-primary/40 ring-2 ring-primary/15 shadow-sm"
                  : "border-border/50 hover:border-border"
              }`}
              data-testid={`kpi-card-${stat.key}`}
              aria-pressed={isActive}
            >
              <p className={`text-2xl font-bold tabular-nums leading-none ${stat.num}`} data-testid={`kpi-${stat.key}`}>
                {counts[stat.key] ?? 0}
              </p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-2">{stat.label}</p>
            </button>
          );
        })}
      </div>

      {/* ── Saved Views ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 p-1 rounded-xl border border-border/50 bg-card overflow-x-auto" data-testid="saved-views">
        {VIEWS.map(v => {
          const isActive = activeView === v.key;
          const c = viewCounts[v.key];
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setActiveView(v.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
              data-testid={`view-${v.key}`}
            >
              {v.label}
              <span className={`text-[10.5px] px-1.5 py-0.5 rounded-md tabular-nums ${isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                {c}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Search + Filters ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
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
        {(activeDropdownFilters > 0 || search || activeView !== "all-open") && (
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

      {showFilters && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-4 bg-card rounded-xl border border-border/50">
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

      {/* ── List ────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : !sorted || sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-card rounded-xl border border-border/50">
          <ClipboardList className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-base font-semibold text-foreground mb-1">No service calls found</p>
          <p className="text-sm text-muted-foreground">
            {(activeDropdownFilters > 0 || search || activeView !== "all-open") ? "Try adjusting your filters or search." : "Create your first service call to get started."}
          </p>
          {(activeDropdownFilters > 0 || search || activeView !== "all-open") && (
            <button type="button" onClick={clearFilters} className="mt-3 text-sm text-primary hover:underline">
              Clear all filters
            </button>
          )}
          {!activeDropdownFilters && !search && activeView === "all-open" && (
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
            <div className="grid grid-cols-[60px_1.55fr_1.35fr_115px_95px_115px_115px_36px] gap-4 px-5 py-3 bg-muted/30 border-b border-border/50">
              <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground">Call</div>
              <SortHeader label="Customer / Site" sortKey="customer" current={sortKey} dir={sortDir} onClick={handleSort} />
              <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground">Equipment</div>
              <SortHeader label="Status" sortKey="status" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Age" sortKey="age" current={sortKey} dir={sortDir} onClick={handleSort} />
              <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground">Tech</div>
              <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground">Invoice</div>
              <div></div>
            </div>
            {sorted.map((call) => (
              <div
                key={call.id}
                role="button"
                tabIndex={0}
                onClick={() => window.location.hash = `/calls/${call.id}`}
                onKeyDown={(e) => { if (e.key === "Enter") window.location.hash = `/calls/${call.id}`; }}
                className="group grid grid-cols-[60px_1.55fr_1.35fr_115px_95px_115px_115px_36px] gap-4 px-5 py-4 items-center border-b border-border/30 last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
                data-testid={`row-call-${call.id}`}
              >
                {/* Call # + status dot */}
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    call.status === "Completed" ? "bg-emerald-500"
                    : call.status === "In Progress" ? "bg-amber-500"
                    : call.status === "Scheduled" ? "bg-cyan-500"
                    : call.status === "Pending Parts" ? "bg-violet-500"
                    : "bg-rose-500"
                  }`} />
                  <span className="text-[11.5px] text-muted-foreground font-mono tabular-nums">#{call.id}</span>
                </div>

                {/* Customer / Site */}
                <div className="min-w-0">
                  <p className="font-semibold text-[14px] text-foreground leading-tight truncate">
                    {call.customerName || "Unnamed"}
                  </p>
                  <div className="flex items-center gap-1 mt-1 text-[11.5px] text-muted-foreground truncate">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">
                      {call.jobSiteName ? `${call.jobSiteName}` : (call.callType === "commercial" ? "Commercial" : "Residential")}
                      {call.jobSiteCity ? ` · ${call.jobSiteCity}${call.jobSiteState ? `, ${call.jobSiteState}` : ""}` : ""}
                    </span>
                  </div>
                </div>

                {/* Equipment */}
                <div className="min-w-0">
                  <p className="text-[13px] text-foreground/90 leading-tight truncate">{call.manufacturer}</p>
                  <p className="font-mono text-[11px] text-muted-foreground mt-1 truncate">
                    {call.productModel || "—"}
                  </p>
                </div>

                {/* Status (+ scheduled date inline) */}
                <div>
                  <StatusChip status={call.status} />
                  {call.status === "Scheduled" && call.scheduledDate && (
                    <p className="text-[10.5px] text-muted-foreground mt-1.5 tabular-nums">
                      {formatDate(call.scheduledDate)}{call.scheduledTime ? ` · ${call.scheduledTime}` : ""}
                    </p>
                  )}
                  {call.status === "Pending Parts" && (
                    <p className="text-[10.5px] text-muted-foreground mt-1.5">awaiting parts</p>
                  )}
                  {call.status === "In Progress" && call.scheduledDate && call.scheduledDate >= today && (
                    <p className="text-[10.5px] text-muted-foreground mt-1.5 tabular-nums">
                      next: {formatDate(call.scheduledDate)}
                    </p>
                  )}
                </div>

                {/* Aging */}
                <AgingCell call={call} />

                {/* Tech */}
                <TechCell call={call} />

                {/* Invoice */}
                <InvoiceCell call={call} />

                {/* Caret */}
                <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-foreground transition-colors" />
              </div>
            ))}
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-2.5">
            {sorted.map((call) => (
              <Link
                key={call.id}
                href={`/calls/${call.id}`}
                data-testid={`card-call-${call.id}`}
              >
                <div className="bg-card rounded-xl border border-border/50 p-4 cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11.5px] text-muted-foreground font-mono tabular-nums">#{call.id}</span>
                      <StatusChip status={call.status} />
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                  </div>
                  <p className="font-semibold text-sm text-foreground">{call.customerName || "Unnamed"}</p>
                  <div className="flex items-center gap-1 mt-1 text-[11.5px] text-muted-foreground">
                    <MapPin className="w-3 h-3" />
                    <span className="truncate">
                      {call.jobSiteName || (call.callType === "commercial" ? "Commercial" : "Residential")}
                      {call.jobSiteCity ? ` · ${call.jobSiteCity}${call.jobSiteState ? `, ${call.jobSiteState}` : ""}` : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2.5 pt-2.5 border-t border-border/30">
                    <div>
                      <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Age</p>
                      {call.status === "Completed" ? (
                        <p className="text-[12px] text-muted-foreground">closed</p>
                      ) : (
                        <p className={`text-[13px] font-bold tabular-nums ${
                          ageDays(call) >= 14 ? "text-rose-600 dark:text-rose-400"
                          : ageDays(call) >= 7 ? "text-amber-600 dark:text-amber-400"
                          : "text-foreground"
                        }`}>
                          {ageDays(call) === 0 ? "today" : `${ageDays(call)}d`}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Tech</p>
                      {call.primaryTechnicianId ? (
                        <p className="text-[12px] text-foreground/80 truncate">{call.primaryTechnicianName?.split(" ")[0]}</p>
                      ) : (
                        <p className="text-[12px] text-muted-foreground/60">—</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Invoice</p>
                      <InvoiceCell call={call} />
                    </div>
                  </div>
                  {call.status === "Scheduled" && call.scheduledDate && (
                    <div className="flex items-center gap-1 mt-2 text-[11px] text-cyan-600 dark:text-cyan-400">
                      <Clock className="w-3 h-3" />
                      Scheduled {formatDate(call.scheduledDate)}{call.scheduledTime ? ` · ${call.scheduledTime}` : ""}
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
