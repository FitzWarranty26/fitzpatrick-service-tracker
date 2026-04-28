import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { formatDate, formatTime } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getUser } from "@/lib/auth";
import {
  PlusCircle, ArrowUp, ArrowDown, Minus, AlertTriangle, ChevronRight,
  TrendingUp, DollarSign, FileText, Activity, Clock, Repeat,
  CheckCircle2, MapPin,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line,
} from "recharts";
import type { ServiceCall } from "@shared/schema";
import { useMemo } from "react";

interface BriefingData {
  pulse: { date: string; callsToday: number; inProgress: number; overdueInvoices: number; revenueMTD: number };
  heroKPIs: {
    revenue: { value: number; delta: number; deltaLabel: string; spark: number[] };
    completed: { value: number; delta: number; deltaLabel: string; spark: number[] };
    openCalls: { value: number; delta: number; deltaLabel: string };
    firstTimeFix: { value: number; delta: number; deltaLabel: string };
  };
  financial: { outstanding: number; avgDaysToPayment: number };
}

interface ServiceCallWithCounts extends ServiceCall {
  photoCount: number;
  partCount: number;
}

interface TodayData {
  todayScheduled: ServiceCallWithCounts[];
  todayCount: number;
  inProgressCount: number;
}

interface TrendPoint { date: string; calls: number; revenue: number; completed: number }

interface WatchlistItem {
  kind: string;
  severity: "high" | "medium" | "low";
  title: string;
  subtitle: string;
  href: string;
  amount?: number;
  days?: number;
}

interface ActivityEntry {
  id: number;
  username: string;
  action: string;
  callId: number | null;
  callCustomer: string | null;
  createdAt: string;
}

const fmtMoney = (n: number) => {
  if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (Math.abs(n) >= 10000) return `$${Math.round(n / 1000)}K`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
};

// ── Sparkline component
function Sparkline({ data, color = "#1a7fad" }: { data: number[]; color?: string }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(" ");
  const areaPts = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`sparkGrad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#sparkGrad-${color.replace("#", "")})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Delta indicator
function DeltaPill({ delta, label, inverted = false, suffix = "%" }: { delta: number; label: string; inverted?: boolean; suffix?: string }) {
  const positive = inverted ? delta < 0 : delta > 0;
  const negative = inverted ? delta > 0 : delta < 0;
  const color = positive ? "text-green-600 dark:text-green-400" : negative ? "text-red-600 dark:text-red-400" : "text-muted-foreground";
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
  return (
    <div className={`inline-flex items-center gap-1 text-xs font-semibold ${color}`}>
      <Icon className="w-3 h-3" />
      <span>{Math.abs(delta)}{suffix}</span>
      <span className="text-muted-foreground font-normal ml-0.5">{label}</span>
    </div>
  );
}

// ── KPI Hero card
function HeroKPI({ label, value, delta, deltaLabel, spark, color, prefix = "", suffix = "", inverted = false }: {
  label: string;
  value: number | string;
  delta: number;
  deltaLabel: string;
  spark?: number[];
  color: string;
  prefix?: string;
  suffix?: string;
  inverted?: boolean;
}) {
  return (
    <div className="bg-card rounded-xl border border-border/50 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3 min-h-[140px]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
        {spark && spark.length > 0 && <Sparkline data={spark} color={color} />}
      </div>
      <div>
        <p className="text-3xl md:text-4xl font-bold tabular-nums leading-none" style={{ color }}>
          {prefix}{typeof value === "number" ? value.toLocaleString() : value}{suffix}
        </p>
      </div>
      <DeltaPill delta={delta} label={deltaLabel} inverted={inverted} suffix={inverted && Math.abs(delta) === delta ? "" : (suffix === "%" ? " pts" : "")} />
    </div>
  );
}

// ── Custom chart tooltip
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  const date = new Date(label + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold mb-1">{date}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <span className="font-bold tabular-nums">{p.dataKey === "revenue" ? fmtMoney(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ── Watchlist row
function WatchlistRow({ item }: { item: WatchlistItem }) {
  const sevColor = item.severity === "high" ? "border-l-red-500" : item.severity === "medium" ? "border-l-amber-500" : "border-l-muted";
  const KindIcon = item.kind === "overdue-invoice" ? FileText
    : item.kind === "stalled-call" ? Clock
    : item.kind === "overdue-followup" ? AlertTriangle
    : item.kind === "repeat-failure" ? Repeat
    : Activity;
  return (
    <Link href={item.href}>
      <div className={`flex items-center gap-3 p-3 rounded-lg border-l-[3px] ${sevColor} bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer group`}>
        <KindIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
          <p className="text-[11px] text-muted-foreground">{item.subtitle}</p>
        </div>
        {item.amount !== undefined && (
          <p className="text-sm font-bold tabular-nums text-foreground flex-shrink-0">{fmtMoney(item.amount)}</p>
        )}
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
      </div>
    </Link>
  );
}

export default function ManagerDashboard() {
  const user = getUser();

  const { data: briefing, isLoading: briefingLoading } = useQuery<BriefingData>({
    queryKey: ["/api/dashboard/briefing"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/briefing")).json(),
    refetchInterval: 60000,
  });

  const { data: today, isLoading: todayLoading } = useQuery<TodayData>({
    queryKey: ["/api/dashboard/today"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/today")).json(),
    refetchInterval: 60000,
  });

  const { data: trend } = useQuery<TrendPoint[]>({
    queryKey: ["/api/dashboard/trend"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/trend")).json(),
  });

  const { data: watchlist } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/dashboard/watchlist"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/watchlist")).json(),
  });

  const { data: activity } = useQuery<ActivityEntry[]>({
    queryKey: ["/api/dashboard/activity"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/activity")).json(),
  });

  // Greeting based on time of day
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const todayDate = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  const trendData = useMemo(() => trend || [], [trend]);

  // Get 30-day trend (last 30 of 90)
  const trend30 = useMemo(() => trendData.slice(-30), [trendData]);

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto pb-24 md:pb-6 space-y-5">
      {/* ─────────────── Header / Greeting ─────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {greeting}, {user?.displayName?.split(" ")[0] || user?.username || "there"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{todayDate} — Executive Briefing</p>
        </div>
        <Button asChild size="sm" className="shadow-sm">
          <Link href="/new">
            <PlusCircle className="w-4 h-4 mr-1.5" />
            New Call
          </Link>
        </Button>
      </div>

      {/* ─────────────── Pulse Strip ─────────────── */}
      {briefingLoading ? (
        <Skeleton className="h-14 w-full rounded-xl" />
      ) : briefing && (
        <div className="bg-gradient-to-r from-[hsl(220,22%,14%)] via-[hsl(220,18%,18%)] to-[hsl(220,22%,14%)] rounded-xl px-5 py-3.5 text-white shadow-md">
          <div className="flex items-center gap-2 md:gap-6 text-sm flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-white/60 text-xs uppercase tracking-wider">Live</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-2xl font-bold tabular-nums">{briefing.pulse.callsToday}</span>
              <span className="text-white/60 text-xs">on the schedule today</span>
            </div>
            <span className="text-white/20 hidden md:inline">·</span>
            <div className="flex items-center gap-1.5">
              <span className="text-2xl font-bold tabular-nums text-amber-400">{briefing.pulse.inProgress}</span>
              <span className="text-white/60 text-xs">in progress</span>
            </div>
            <span className="text-white/20 hidden md:inline">·</span>
            <div className="flex items-center gap-1.5">
              <span className="text-2xl font-bold tabular-nums text-green-400">{fmtMoney(briefing.pulse.revenueMTD)}</span>
              <span className="text-white/60 text-xs">booked MTD</span>
            </div>
            {briefing.pulse.overdueInvoices > 0 && (
              <>
                <span className="text-white/20 hidden md:inline">·</span>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-2xl font-bold tabular-nums text-red-400">{briefing.pulse.overdueInvoices}</span>
                  <span className="text-white/60 text-xs">overdue invoices</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─────────────── Hero KPIs ─────────────── */}
      {briefingLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      ) : briefing && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <HeroKPI
            label="Revenue MTD"
            value={fmtMoney(briefing.heroKPIs.revenue.value)}
            delta={briefing.heroKPIs.revenue.delta}
            deltaLabel={briefing.heroKPIs.revenue.deltaLabel}
            spark={briefing.heroKPIs.revenue.spark}
            color="#16a34a"
          />
          <HeroKPI
            label="Calls Completed"
            value={briefing.heroKPIs.completed.value}
            delta={briefing.heroKPIs.completed.delta}
            deltaLabel={briefing.heroKPIs.completed.deltaLabel}
            spark={briefing.heroKPIs.completed.spark}
            color="#1a7fad"
          />
          <HeroKPI
            label="Open Calls"
            value={briefing.heroKPIs.openCalls.value}
            delta={briefing.heroKPIs.openCalls.delta}
            deltaLabel={briefing.heroKPIs.openCalls.deltaLabel}
            color="#a855f7"
            suffix=""
            inverted
          />
          <HeroKPI
            label="First-Time Fix"
            value={briefing.heroKPIs.firstTimeFix.value}
            delta={briefing.heroKPIs.firstTimeFix.delta}
            deltaLabel={briefing.heroKPIs.firstTimeFix.deltaLabel}
            color="#f59e0b"
            suffix="%"
          />
        </div>
      )}

      {/* ─────────────── Main Grid: Today + Watchlist ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Today's Operations (2/3) */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border/50 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Today's Operations</p>
              <h2 className="text-base font-bold mt-0.5">Schedule & Active Work</h2>
            </div>
            <Link href="/calendar" className="text-xs text-primary hover:underline">View calendar →</Link>
          </div>

          {todayLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : !today?.todayScheduled || today.todayScheduled.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-foreground">Nothing scheduled for today</p>
              <p className="text-xs text-muted-foreground mt-1">A clear day or a slow day, you decide.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {today.todayScheduled.map((c: ServiceCallWithCounts) => (
                <Link key={c.id} href={`/calls/${c.id}`}>
                  <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/40 hover:border-primary/30 transition-all cursor-pointer group">
                    <div className="flex flex-col items-center justify-center w-14 flex-shrink-0">
                      <p className="text-base font-bold tabular-nums leading-none">{c.scheduledTime ? formatTime(c.scheduledTime) : "—"}</p>
                      <p className="text-[10px] text-muted-foreground uppercase mt-0.5">{c.scheduledTime ? "scheduled" : "today"}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground truncate">{c.customerName || c.jobSiteName || "Unnamed"}</p>
                        <StatusBadge status={c.status} />
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{c.jobSiteCity ? `${c.jobSiteCity}, ${c.jobSiteState}` : c.jobSiteName || "No location"}</span>
                        <span className="text-border">·</span>
                        <span>{c.manufacturer}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-foreground transition-colors flex-shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Watchlist (1/3) */}
        <div className="bg-card rounded-xl border border-border/50 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Needs Your Attention</p>
              <h2 className="text-base font-bold mt-0.5">Watchlist</h2>
            </div>
            {watchlist && watchlist.length > 0 && (
              <span className="text-xs font-bold tabular-nums text-red-600 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded-full">
                {watchlist.length}
              </span>
            )}
          </div>

          {!watchlist ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
            </div>
          ) : watchlist.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-500/40 mb-3" />
              <p className="text-sm font-medium text-foreground">All clear</p>
              <p className="text-xs text-muted-foreground mt-1">Nothing demands your attention right now.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {watchlist.map((item, i) => (
                <WatchlistRow key={i} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─────────────── 30-Day Performance Chart ─────────────── */}
      <div className="bg-card rounded-xl border border-border/50 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Performance Trend</p>
            <h2 className="text-base font-bold mt-0.5">Last 30 Days</h2>
          </div>
          <Link href="/analytics" className="text-xs text-primary hover:underline">Full analytics →</Link>
        </div>

        {trend30.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={trend30} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="callsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1a7fad" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#1a7fad" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16a34a" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(d) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                stroke="hsl(var(--border))"
                interval={Math.floor(trend30.length / 6)}
              />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--border))" />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--border))" tickFormatter={(v) => fmtMoney(v)} />
              <Tooltip content={<ChartTooltip />} />
              <Area yAxisId="left" type="monotone" dataKey="calls" name="Calls" stroke="#1a7fad" strokeWidth={2} fill="url(#callsGrad)" />
              <Area yAxisId="right" type="monotone" dataKey="revenue" name="Revenue" stroke="#16a34a" strokeWidth={2} fill="url(#revGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">No trend data yet.</p>
          </div>
        )}
      </div>

      {/* ─────────────── Financial Summary + Recent Activity ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Financial Summary (1/3) */}
        {briefing && (
          <div className="bg-card rounded-xl border border-border/50 p-5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1">Financial Health</p>
            <h2 className="text-base font-bold mb-4">Cash Flow Snapshot</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-border/30">
                <div>
                  <p className="text-xs text-muted-foreground">Outstanding Balance</p>
                  <p className="text-2xl font-bold tabular-nums mt-1">{fmtMoney(briefing.financial.outstanding)}</p>
                </div>
                <DollarSign className="w-8 h-8 text-muted-foreground/30" />
              </div>
              <div className="flex items-center justify-between pb-3 border-b border-border/30">
                <div>
                  <p className="text-xs text-muted-foreground">Avg Days to Payment</p>
                  <p className="text-2xl font-bold tabular-nums mt-1">{briefing.financial.avgDaysToPayment} <span className="text-sm font-normal text-muted-foreground">days</span></p>
                </div>
                <Clock className="w-8 h-8 text-muted-foreground/30" />
              </div>
              <Link href="/invoices" className="block text-center text-xs text-primary hover:underline pt-1">
                View all invoices →
              </Link>
            </div>
          </div>
        )}

        {/* Recent Activity (2/3) */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border/50 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Team Activity</p>
              <h2 className="text-base font-bold mt-0.5">Recent Updates</h2>
            </div>
            <Link href="/activity" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
          {!activity ? (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}
            </div>
          ) : activity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No recent activity.</p>
          ) : (
            <div className="space-y-1">
              {activity.slice(0, 6).map(a => {
                const date = new Date(a.createdAt);
                const timeStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " + date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                return (
                  <div key={a.id} className="flex items-center gap-3 py-2 border-b border-border/20 last:border-0 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                    <span className="font-semibold text-foreground">{a.username}</span>
                    <span className="text-muted-foreground">{a.action.replace(/_/g, " ")}</span>
                    {a.callCustomer && (
                      <Link href={`/calls/${a.callId}`} className="text-primary hover:underline truncate flex-1 min-w-0">
                        {a.callCustomer}
                      </Link>
                    )}
                    <span className="text-[10px] text-muted-foreground/60 ml-auto whitespace-nowrap">{timeStr}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
