import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PageHero } from "@/components/PageHero";
import { getUser } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { format, parseISO } from "date-fns";

// ── Chart color palette ─────────────────────────────────────────────────────
const BLUE = "#1a7fad";
const EMERALD = "#10b981";
const AMBER = "#f59e0b";
const PURPLE = "#8b5cf6";
const RED = "#ef4444";
const GRAY = "#6b7280";

const SERIES_COLORS = [BLUE, EMERALD, AMBER, PURPLE, RED, GRAY];

// ── Types ───────────────────────────────────────────────────────────────────
interface DashboardData {
  revenue: {
    totalBilled: number;
    totalCollected: number;
    totalOutstanding: number;
    billedByMonth: Array<{ month: string; amount: number }>;
    collectedByMonth: Array<{ month: string; amount: number }>;
  };
  techProductivity: {
    totalHours: number;
    totalMiles: number;
    avgHoursPerCall: number;
    avgMilesPerCall: number;
    hoursByMonth: Array<{ month: string; hours: number }>;
    milesByMonth: Array<{ month: string; miles: number }>;
  };
  fixRate: {
    totalCalls: number;
    singleVisitCalls: number;
    multiVisitCalls: number;
    firstTimeFixRate: number;
  };
  partsSpend: {
    totalPartsCost: number;
    byManufacturer: Array<{ manufacturer: string; cost: number; count: number }>;
    topParts: Array<{ partDescription: string; totalCost: number; totalQty: number }>;
  };
  manufacturerAnalysis: {
    callsByManufacturer: Array<{ manufacturer: string; count: number }>;
    avgHoursByManufacturer: Array<{ manufacturer: string; avgHours: number }>;
  };
  wholesalerVolume: Array<{ wholesalerName: string; callCount: number }>;
  contractorAnalysis: Array<{ contractorName: string; callCount: number; totalHours: number; totalMiles: number; totalBilled: number }>;
  callTypeBreakdown: Array<{ type: string; count: number }>;
  serviceMethodBreakdown: Array<{ method: string; count: number }>;
  teamWorkload: Array<{ userName: string; callCount: number; totalHours: number; totalMiles: number }>;
  warrantyMix: { inWarranty: number; outOfWarranty: number; unknown: number };
  repeatFailures: Array<{ serialNumber: string; address: string; customerName: string; manufacturer: string; callCount: number }>;
  callsByMonth: Array<{ month: string; count: number }>;
  avgDaysToPayment: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmtMonth(m: string): string {
  try { return format(parseISO(m + "-01"), "MMM yyyy"); } catch { return m; }
}

function fmtShortMonth(m: string): string {
  try { return format(parseISO(m + "-01"), "MMM"); } catch { return m; }
}

function fmtDollar(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDollarPrecise(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Shared UI primitives ────────────────────────────────────────────────────
function SectionTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground ${className}`}>
      {children}
    </p>
  );
}

function EmptyState({ label = "No data for this period" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function PanelCard({ children, className = "", span = "" }: { children: React.ReactNode; className?: string; span?: string }) {
  return (
    <Card className={`rounded-xl border border-border/50 bg-card p-5 md:p-6 transition-all duration-200 hover:shadow-md hover:border-border ${span} ${className}`}>
      {children}
    </Card>
  );
}

// ── KPI strip card ──────────────────────────────────────────────────────────
function KpiStripCard({
  label,
  value,
  context,
  accent,
}: {
  label: string;
  value: string;
  context?: string;
  accent: string;
}) {
  return (
    <div
      className="rounded-xl border border-border/50 bg-card p-4 border-l-[3px] transition-all duration-200 hover:shadow-md hover:border-border"
      style={{ borderLeftColor: accent }}
    >
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide truncate">{label}</p>
      <p className="text-3xl font-bold tabular-nums mt-1 text-foreground leading-none">{value}</p>
      {context && <p className="text-[10px] text-muted-foreground mt-2">{context}</p>}
    </div>
  );
}

// ── Custom tooltip ──────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label, valueFormat = "auto" }: any) {
  if (!active || !payload?.length) return null;
  const format = (v: any, name: string) => {
    if (typeof v !== "number") return v;
    if (valueFormat === "dollar") return fmtDollar(v);
    if (valueFormat === "hours") return `${v} hrs`;
    if (valueFormat === "miles") return `${v.toLocaleString()} mi`;
    // auto
    if (name && /bill|collect|cost|revenue|amount|outstanding|spent/i.test(name)) return fmtDollar(v);
    return v.toLocaleString();
  };
  return (
    <div className="bg-popover border border-border shadow-lg rounded-lg p-3 text-sm">
      {label != null && <p className="font-medium text-foreground mb-1.5 text-xs">{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-xs py-0.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: p.color || p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground tabular-nums">{format(p.value, p.name)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Circular progress ring ──────────────────────────────────────────────────
function ProgressRing({ value, size = 180, stroke = 10, color }: { value: number; size?: number; stroke?: number; color: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        className="text-muted/30"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 800ms ease-out" }}
      />
    </svg>
  );
}

// ── Component ───────────────────────────────────────────────────────────────
export default function Analytics() {
  const now = new Date();
  const [dateFrom, setDateFrom] = useState(`${now.getFullYear()}-01-01`);
  const [dateTo, setDateTo] = useState(format(now, "yyyy-MM-dd"));

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/analytics/dashboard", dateFrom, dateTo],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/analytics/dashboard?from=${dateFrom}&to=${dateTo}`);
      return res.json();
    },
  });

  const currentUser = getUser();
  const userIsManager = currentUser?.role === "manager";
  const userIsEditor = currentUser?.role !== "staff";

  // Merge billed + collected into one chart dataset
  const revenueChartData = useMemo(() => {
    if (!data?.revenue) return [];
    const months = new Set([
      ...data.revenue.billedByMonth.map((d: any) => d.month),
      ...data.revenue.collectedByMonth.map((d: any) => d.month),
    ]);
    const billedMap = new Map(data.revenue.billedByMonth.map((d: any) => [d.month, d.amount]));
    const collectedMap = new Map(data.revenue.collectedByMonth.map((d: any) => [d.month, d.amount]));
    return Array.from(months).sort().map(m => ({
      month: fmtShortMonth(m),
      fullMonth: fmtMonth(m),
      Billed: billedMap.get(m) || 0,
      Collected: collectedMap.get(m) || 0,
    }));
  }, [data]);

  const callsByMonthData = useMemo(() => {
    if (!data?.callsByMonth) return [];
    return data.callsByMonth.map(m => ({
      month: fmtShortMonth(m.month),
      fullMonth: fmtMonth(m.month),
      count: m.count,
    }));
  }, [data]);

  const warrantyData = useMemo(() => {
    if (!data) return [];
    return [
      { name: "In Warranty", value: data.warrantyMix.inWarranty, color: EMERALD },
      { name: "Out of Warranty", value: data.warrantyMix.outOfWarranty, color: RED },
      { name: "Unknown", value: data.warrantyMix.unknown, color: GRAY },
    ].filter(d => d.value > 0);
  }, [data]);

  const callTypeData = useMemo(() => {
    if (!data?.callTypeBreakdown) return [];
    return data.callTypeBreakdown.map((c, i) => ({
      name: c.type,
      value: c.count,
      color: c.type === "Commercial" ? PURPLE : BLUE,
    })).filter(d => d.value > 0);
  }, [data]);

  const serviceMethodData = useMemo(() => {
    if (!data?.serviceMethodBreakdown) return [];
    const colorMap: Record<string, string> = {
      "In-Person": "#1a7fad",
      "Phone Call": "#f59e0b",
      "Video Call": "#8b5cf6",
    };
    return data.serviceMethodBreakdown.map((m) => ({
      name: m.method,
      value: m.count,
      color: colorMap[m.method] || GRAY,
    })).filter(d => d.value > 0);
  }, [data]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4 pb-24 md:pb-6">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-8 w-32" />
          <div className="flex gap-3">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-40" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Skeleton className="h-[360px] rounded-xl" />
          <Skeleton className="h-[360px] rounded-xl" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  const d = data!;

  const totalCalls = d.fixRate.totalCalls;
  const paymentColor = d.avgDaysToPayment < 30 ? EMERALD : d.avgDaysToPayment <= 60 ? AMBER : RED;

  // ── KPI strip definition ────────────────────────────────────────────────
  const kpis: Array<{ label: string; value: string; context?: string; accent: string; show: boolean }> = [
    {
      label: "Total Calls",
      value: totalCalls.toLocaleString(),
      context: `${d.fixRate.singleVisitCalls} single-visit`,
      accent: BLUE,
      show: true,
    },
    {
      label: "Completed",
      value: d.fixRate.singleVisitCalls.toLocaleString(),
      context: `${d.fixRate.multiVisitCalls} multi-visit`,
      accent: EMERALD,
      show: true,
    },
    {
      label: "Fix Rate",
      value: `${Math.round(d.fixRate.firstTimeFixRate)}%`,
      context: "first-time fix",
      accent: AMBER,
      show: true,
    },
    {
      label: "Total Hours",
      value: `${Math.round(d.techProductivity.totalHours).toLocaleString()}`,
      context: `${d.techProductivity.avgHoursPerCall} hrs/call`,
      accent: PURPLE,
      show: true,
    },
    {
      label: "Total Miles",
      value: d.techProductivity.totalMiles.toLocaleString(),
      context: `${d.techProductivity.avgMilesPerCall} mi/call`,
      accent: GRAY,
      show: true,
    },
    {
      label: "Revenue",
      value: fmtDollar(d.revenue?.totalBilled ?? 0),
      context: `${fmtDollar(d.revenue?.totalCollected ?? 0)} collected`,
      accent: BLUE,
      show: userIsManager && !!d.revenue,
    },
    {
      label: "Outstanding",
      value: fmtDollar(d.revenue?.totalOutstanding ?? 0),
      context: "unpaid balance",
      accent: AMBER,
      show: userIsManager && !!d.revenue,
    },
    {
      label: "Avg Payment",
      value: `${d.avgDaysToPayment ?? 0}d`,
      context: d.avgDaysToPayment < 30 ? "healthy" : d.avgDaysToPayment <= 60 ? "watch" : "slow",
      accent: d.avgDaysToPayment < 30 ? EMERALD : d.avgDaysToPayment <= 60 ? AMBER : RED,
      show: userIsManager && d.avgDaysToPayment != null,
    },
  ];
  const visibleKpis = kpis.filter(k => k.show);

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-5 pb-24 md:pb-6">
      <PageHero
        title="Analytics"
        subtitle={<span>Service performance, revenue, and team metrics</span>}
        actions={
          <>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1.5 block">From</label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 text-sm w-40 rounded-lg" />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1.5 block">To</label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 text-sm w-40 rounded-lg" />
            </div>
          </>
        }
      />

      {/* ── Section 1: KPI Summary Strip ────────────────────────────────── */}
      <div className={`grid grid-cols-2 md:grid-cols-4 ${visibleKpis.length >= 8 ? "xl:grid-cols-8" : visibleKpis.length >= 5 ? "xl:grid-cols-5" : ""} gap-3`}>
        {visibleKpis.map((k, i) => (
          <KpiStripCard key={i} label={k.label} value={k.value} context={k.context} accent={k.accent} />
        ))}
      </div>

      {/* ── Section 2: Primary charts side by side ──────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Revenue by Month (manager) OR Calls by Month */}
        <PanelCard>
          <div className="flex items-center justify-between mb-4">
            <SectionTitle>{userIsManager ? "Revenue — Billed vs Collected" : "Call Volume by Month"}</SectionTitle>
            {userIsManager && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {fmtDollar(d.revenue?.totalBilled ?? 0)} billed
              </span>
            )}
          </div>
          {userIsManager && revenueChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={revenueChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip valueFormat="dollar" />} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
                <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} iconType="circle" />
                <Bar dataKey="Billed" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={800} animationEasing="ease-out" />
                <Bar dataKey="Collected" fill={EMERALD} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={800} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          ) : !userIsManager && callsByMonthData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={callsByMonthData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
                <Bar dataKey="count" name="Calls" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={32} animationDuration={800} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState />
          )}
        </PanelCard>

        {/* Seasonal Trends — Area chart */}
        <PanelCard>
          <div className="flex items-center justify-between mb-4">
            <SectionTitle>Seasonal Trends — Call Volume</SectionTitle>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {totalCalls.toLocaleString()} calls
            </span>
          </div>
          {callsByMonthData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={callsByMonthData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BLUE} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={BLUE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: BLUE, strokeWidth: 1, strokeOpacity: 0.4 }} />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="Calls"
                  stroke={BLUE}
                  strokeWidth={2.5}
                  fill="url(#colorCalls)"
                  animationDuration={800}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState />
          )}
        </PanelCard>
      </div>

      {/* ── Section 3: Three equal columns ──────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* First-Time Fix Rate */}
        <PanelCard>
          <SectionTitle className="mb-6">First-Time Fix Rate</SectionTitle>
          <div className="flex flex-col items-center justify-center">
            <div className="relative">
              <ProgressRing
                value={d.fixRate.firstTimeFixRate}
                size={180}
                stroke={10}
                color={d.fixRate.firstTimeFixRate >= 80 ? EMERALD : d.fixRate.firstTimeFixRate >= 60 ? AMBER : RED}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p
                  className="text-4xl font-bold tabular-nums leading-none"
                  style={{ color: d.fixRate.firstTimeFixRate >= 80 ? EMERALD : d.fixRate.firstTimeFixRate >= 60 ? AMBER : RED }}
                >
                  {Math.round(d.fixRate.firstTimeFixRate)}%
                </p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-4 text-center">
              <span className="tabular-nums font-semibold text-foreground">{d.fixRate.singleVisitCalls}</span>
              {" of "}
              <span className="tabular-nums font-semibold text-foreground">{d.fixRate.totalCalls}</span>
              {" in single visit"}
            </p>
          </div>
        </PanelCard>

        {/* Residential vs Commercial */}
        <PanelCard>
          <SectionTitle className="mb-4">Residential vs Commercial</SectionTitle>
          {callTypeData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={callTypeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={54}
                    outerRadius={84}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    animationDuration={800}
                  >
                    {callTypeData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="hsl(var(--card))" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-6 mt-2">
                {callTypeData.map((c, i) => (
                  <div key={i} className="flex flex-col items-center">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{c.name}</span>
                    </div>
                    <p className="text-xl font-bold tabular-nums mt-1">{c.value.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState />
          )}
        </PanelCard>

        {/* Service Method */}
        <PanelCard>
          <SectionTitle className="mb-4">Service Method</SectionTitle>
          {serviceMethodData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={serviceMethodData}
                    cx="50%"
                    cy="50%"
                    innerRadius={54}
                    outerRadius={84}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    animationDuration={800}
                  >
                    {serviceMethodData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="hsl(var(--card))" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-2 flex-wrap">
                {serviceMethodData.map((m, i) => (
                  <div key={i} className="flex flex-col items-center">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{m.name}</span>
                    </div>
                    <p className="text-xl font-bold tabular-nums mt-1">{m.value.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState />
          )}
        </PanelCard>

        {/* Warranty Mix */}
        <PanelCard>
          <SectionTitle className="mb-4">Warranty Mix</SectionTitle>
          {warrantyData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={warrantyData}
                    cx="50%"
                    cy="50%"
                    innerRadius={54}
                    outerRadius={84}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    animationDuration={800}
                  >
                    {warrantyData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="hsl(var(--card))" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-2 flex-wrap">
                {warrantyData.map((w, i) => {
                  const total = warrantyData.reduce((s, x) => s + x.value, 0);
                  const pct = total > 0 ? Math.round((w.value / total) * 100) : 0;
                  return (
                    <div key={i} className="flex flex-col items-center">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: w.color }} />
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{w.name}</span>
                      </div>
                      <p className="text-lg font-bold tabular-nums mt-1">{pct}%</p>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyState />
          )}
        </PanelCard>
      </div>

      {/* ── Section 4: Manufacturer Analysis (full-width) ────────────────── */}
      <PanelCard>
        <div className="flex items-center justify-between mb-5">
          <SectionTitle>Manufacturer Analysis</SectionTitle>
          <span className="text-[10px] text-muted-foreground">Calls and avg service time</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-[11px] text-muted-foreground mb-2">Calls by Manufacturer</p>
            {d.manufacturerAnalysis.callsByManufacturer.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(220, d.manufacturerAnalysis.callsByManufacturer.length * 34)}>
                <BarChart
                  data={d.manufacturerAnalysis.callsByManufacturer}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="manufacturer"
                    width={120}
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
                  <Bar dataKey="count" name="Calls" fill={BLUE} radius={[0, 4, 4, 0]} maxBarSize={20} animationDuration={800} animationEasing="ease-out" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-2">Avg Hours by Manufacturer</p>
            {d.manufacturerAnalysis.avgHoursByManufacturer.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(220, d.manufacturerAnalysis.avgHoursByManufacturer.length * 34)}>
                <BarChart
                  data={d.manufacturerAnalysis.avgHoursByManufacturer}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="manufacturer"
                    width={120}
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip valueFormat="hours" />} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
                  <Bar dataKey="avgHours" name="Avg Hours" fill={PURPLE} radius={[0, 4, 4, 0]} maxBarSize={20} animationDuration={800} animationEasing="ease-out" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </div>
        </div>
      </PanelCard>

      {/* ── Section 5: Contractor & Wholesaler ────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Contractor Analysis Table */}
        <PanelCard>
          <div className="flex items-center justify-between mb-4">
            <SectionTitle>Contractor Analysis</SectionTitle>
            <span className="text-[10px] text-muted-foreground">Top 10 by calls</span>
          </div>
          {d.contractorAnalysis.length > 0 ? (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="text-left px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Contractor</th>
                    <th className="text-right px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Calls</th>
                    <th className="text-right px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Hours</th>
                    <th className="text-right px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Miles</th>
                    <th className="text-right px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Billed</th>
                  </tr>
                </thead>
                <tbody>
                  {d.contractorAnalysis.slice(0, 10).map((c: any) => (
                    <tr key={c.contractorName} className="border-b border-border/40 last:border-0 transition-colors hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium text-foreground truncate max-w-[200px]">{c.contractorName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.callCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{c.totalHours}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{c.totalMiles}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtDollarPrecise(c.totalBilled)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState label="No contractor activity" />
          )}
        </PanelCard>

        {/* Wholesaler Volume */}
        <PanelCard>
          <div className="flex items-center justify-between mb-4">
            <SectionTitle>Wholesaler Volume</SectionTitle>
            <span className="text-[10px] text-muted-foreground">Calls by source</span>
          </div>
          {d.wholesalerVolume.length > 0 ? (
            d.wholesalerVolume.length > 4 ? (
              <ResponsiveContainer width="100%" height={Math.max(240, d.wholesalerVolume.length * 32)}>
                <BarChart
                  data={d.wholesalerVolume}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="wholesalerName"
                    width={140}
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
                  <Bar dataKey="callCount" name="Calls" fill={EMERALD} radius={[0, 4, 4, 0]} maxBarSize={20} animationDuration={800} animationEasing="ease-out" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="text-left px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Wholesaler</th>
                      <th className="text-right px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.wholesalerVolume.map((w) => (
                      <tr key={w.wholesalerName} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">{w.wholesalerName}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{w.callCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <EmptyState label="No wholesaler activity" />
          )}
        </PanelCard>
      </div>

      {/* ── Section 6: Parts Spend (editor+) ────────────────────────────── */}
      {userIsEditor && d.partsSpend && (
        <PanelCard>
          <div className="flex items-center justify-between mb-5">
            <div>
              <SectionTitle>Parts Spend</SectionTitle>
              <p className="text-3xl font-bold tabular-nums mt-2" style={{ color: AMBER }}>
                {fmtDollar(d.partsSpend.totalPartsCost)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">total parts cost this period</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-[11px] text-muted-foreground mb-2">By Manufacturer</p>
              {d.partsSpend.byManufacturer.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={d.partsSpend.byManufacturer} margin={{ top: 4, right: 16, left: 0, bottom: 50 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="manufacturer"
                      tick={{ fontSize: 11, fill: "#9ca3af" }}
                      axisLine={false}
                      tickLine={false}
                      angle={-30}
                      textAnchor="end"
                      height={60}
                      interval={0}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#9ca3af" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip content={<CustomTooltip valueFormat="dollar" />} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
                    <Bar dataKey="cost" name="Parts Cost" fill={AMBER} radius={[4, 4, 0, 0]} maxBarSize={32} animationDuration={800} animationEasing="ease-out" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground mb-2">Top 10 Parts</p>
              {d.partsSpend.topParts.length > 0 ? (
                <div className="overflow-x-auto -mx-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="text-left px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Part</th>
                        <th className="text-right px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Qty</th>
                        <th className="text-right px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.partsSpend.topParts.slice(0, 10).map((p, i) => (
                        <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium truncate max-w-[200px]">{p.partDescription}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{p.totalQty}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtDollarPrecise(p.totalCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState />
              )}
            </div>
          </div>
        </PanelCard>
      )}

      {/* ── Section 7: Team Workload (manager only) ─────────────────────── */}
      {userIsManager && d.teamWorkload && (
        <PanelCard>
          <div className="flex items-center justify-between mb-4">
            <SectionTitle>Team Workload</SectionTitle>
            <span className="text-[10px] text-muted-foreground">By team member</span>
          </div>
          {d.teamWorkload.length > 0 ? (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="text-left px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Team Member</th>
                    <th className="text-right px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Calls</th>
                    <th className="text-right px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Hours</th>
                    <th className="text-right px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Miles</th>
                  </tr>
                </thead>
                <tbody>
                  {d.teamWorkload.map((t, i) => (
                    <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{t.userName}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{t.callCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{t.totalHours}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{t.totalMiles.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState label="No team data available" />
          )}
        </PanelCard>
      )}

      {/* ── Section 8: Repeat Service (red accent) ───────────────────────── */}
      {d.repeatFailures.length > 0 && (
        <Card
          className="rounded-xl border border-border/50 bg-card p-5 md:p-6 transition-all duration-200 hover:shadow-md hover:border-border border-l-[3px]"
          style={{ borderLeftColor: RED }}
        >
          <div className="flex items-center justify-between mb-4">
            <SectionTitle>Repeat Service — Units with Multiple Calls</SectionTitle>
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: RED }}>
              {d.repeatFailures.length} flagged
            </span>
          </div>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30">
                  <th className="text-left px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Serial</th>
                  <th className="text-left px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Address</th>
                  <th className="text-left px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Customer</th>
                  <th className="text-left px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Manufacturer</th>
                  <th className="text-right px-3 py-2 text-[10px] tracking-[0.1em] font-semibold text-muted-foreground uppercase">Calls</th>
                </tr>
              </thead>
              <tbody>
                {d.repeatFailures.map((r, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs font-medium">{r.serialNumber}</td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-[220px]">{r.address || "\u2014"}</td>
                    <td className="px-3 py-2">{r.customerName || "\u2014"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.manufacturer}</td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-full text-xs font-bold tabular-nums"
                        style={{ backgroundColor: `${RED}15`, color: RED }}
                      >
                        {r.callCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
