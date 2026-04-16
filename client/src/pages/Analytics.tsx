import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getUser } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
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

// ── Chart colors ────────────────────────────────────────────────────────────
const BLUE = "#1a7fad";
const EMERALD = "#10b981";
const AMBER = "#f59e0b";
const RED = "#ef4444";
const PURPLE = "#8b5cf6";

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

function fmtDollar(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
      {children}
    </p>
  );
}

function KPI({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${color || ""}`}>{value}</p>
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

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
      month: fmtMonth(m),
      Billed: billedMap.get(m) || 0,
      Collected: collectedMap.get(m) || 0,
    }));
  }, [data]);

  const warrantyData = useMemo(() => {
    if (!data) return [];
    return [
      { name: "In Warranty", value: data.warrantyMix.inWarranty },
      { name: "Out of Warranty", value: data.warrantyMix.outOfWarranty },
      { name: "Unknown", value: data.warrantyMix.unknown },
    ].filter(d => d.value > 0);
  }, [data]);
  const warrantyColors = [EMERALD, RED, "#9ca3af"];

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 pb-24 md:pb-6">
        <h1 className="text-xl font-bold text-foreground">Analytics</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const d = data!;
  const paymentColor = d.avgDaysToPayment < 30 ? "text-emerald-600 dark:text-emerald-400"
    : d.avgDaysToPayment <= 60 ? "text-amber-600 dark:text-amber-400"
    : "text-red-600 dark:text-red-400";

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 pb-24 md:pb-6">
      {/* ── Top Bar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-foreground">Analytics</h1>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5 block">From</label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 text-sm w-40" />
          </div>
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5 block">To</label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 text-sm w-40" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* ── S1: Revenue Overview (full) ──────────────────────────────────── */}
        {userIsManager && data?.revenue && <Card className="md:col-span-2 rounded-lg border bg-card p-6">
          <SectionTitle>Revenue Overview</SectionTitle>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="rounded-lg p-4" style={{ backgroundColor: `${BLUE}15` }}>
              <p className="text-xs text-muted-foreground">Total Billed</p>
              <p className="text-3xl font-bold" style={{ color: BLUE }}>{fmtDollar(d.revenue.totalBilled)}</p>
            </div>
            <div className="rounded-lg p-4" style={{ backgroundColor: `${EMERALD}15` }}>
              <p className="text-xs text-muted-foreground">Total Collected</p>
              <p className="text-3xl font-bold" style={{ color: EMERALD }}>{fmtDollar(d.revenue.totalCollected)}</p>
            </div>
            <div className="rounded-lg p-4" style={{ backgroundColor: `${AMBER}15` }}>
              <p className="text-xs text-muted-foreground">Outstanding Balance</p>
              <p className="text-3xl font-bold" style={{ color: AMBER }}>{fmtDollar(d.revenue.totalOutstanding)}</p>
            </div>
          </div>
          {revenueChartData.length > 0 && (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={revenueChartData} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtDollar(v)} />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="Billed" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="Collected" fill={EMERALD} radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          )}
         </Card>}

        {/* ── S2: Tech Productivity (half) ─────────────────────────────────── */}
        <Card className="rounded-lg border bg-card p-6">
          <SectionTitle>Tech Productivity</SectionTitle>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <KPI label="Total Hours" value={`${d.techProductivity.totalHours} hrs`} />
            <KPI label="Total Miles" value={`${d.techProductivity.totalMiles.toLocaleString()} mi`} />
            <KPI label="Avg Hours/Call" value={d.techProductivity.avgHoursPerCall} />
            <KPI label="Avg Miles/Call" value={d.techProductivity.avgMilesPerCall} />
          </div>
          {d.techProductivity.hoursByMonth.length > 0 && (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={d.techProductivity.hoursByMonth.map(h => ({ ...h, label: fmtMonth(h.month) }))} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="hours" name="Hours" stroke={BLUE} strokeWidth={2} dot={{ r: 3, fill: BLUE }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* ── S3: First-Time Fix Rate (half) ──────────────────────────────── */}
        <Card className="rounded-lg border bg-card p-6">
          <SectionTitle>First-Time Fix Rate</SectionTitle>
          <div className="flex flex-col items-center justify-center mb-4">
            <p className="text-5xl font-bold" style={{ color: d.fixRate.firstTimeFixRate >= 80 ? EMERALD : AMBER }}>
              {d.fixRate.firstTimeFixRate}%
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              {d.fixRate.singleVisitCalls} of {d.fixRate.totalCalls} calls completed in a single visit
            </p>
          </div>
          <div className="flex gap-2 mt-4">
            <div className="flex-1 rounded-lg p-3 text-center" style={{ backgroundColor: `${EMERALD}15` }}>
              <p className="text-xs text-muted-foreground">Single Visit</p>
              <p className="text-xl font-bold" style={{ color: EMERALD }}>{d.fixRate.singleVisitCalls}</p>
            </div>
            <div className="flex-1 rounded-lg p-3 text-center" style={{ backgroundColor: `${AMBER}15` }}>
              <p className="text-xs text-muted-foreground">Multi-Visit</p>
              <p className="text-xl font-bold" style={{ color: AMBER }}>{d.fixRate.multiVisitCalls}</p>
            </div>
          </div>
        </Card>

        {/* ── S4: Calls by Manufacturer (half) ────────────────────────────── */}
        <Card className="rounded-lg border bg-card p-6">
          <SectionTitle>Calls by Manufacturer</SectionTitle>
          {d.manufacturerAnalysis.callsByManufacturer.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(200, d.manufacturerAnalysis.callsByManufacturer.length * 40)}>
              <BarChart data={d.manufacturerAnalysis.callsByManufacturer} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis type="category" dataKey="manufacturer" width={140} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" name="Calls" fill={BLUE} radius={[0, 4, 4, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No data</p>
          )}
        </Card>

        {/* ── S5: Avg Hours by Manufacturer (half) ────────────────────────── */}
        <Card className="rounded-lg border bg-card p-6">
          <SectionTitle>Avg Hours by Manufacturer</SectionTitle>
          {d.manufacturerAnalysis.avgHoursByManufacturer.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(200, d.manufacturerAnalysis.avgHoursByManufacturer.length * 40)}>
              <BarChart data={d.manufacturerAnalysis.avgHoursByManufacturer} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis type="category" dataKey="manufacturer" width={140} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} hrs`, "Avg Hours"]} />
                <Bar dataKey="avgHours" name="Avg Hours" fill={PURPLE} radius={[0, 4, 4, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No data</p>
          )}
        </Card>

        {/* ── S6: Parts Spend (full) ──────────────────────────────────────── */}
        {userIsEditor && data?.partsSpend && <Card className="md:col-span-2 rounded-lg border bg-card p-6">
          <SectionTitle>Parts Spend</SectionTitle>
          <KPI label="Total Parts Cost" value={fmtDollar(d.partsSpend.totalPartsCost)} color="text-foreground" />

          {d.partsSpend.topParts.length > 0 && (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Part</th>
                    <th className="text-right px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Qty</th>
                    <th className="text-right px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {d.partsSpend.topParts.map((p, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 font-medium">{p.partDescription}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{p.totalQty}</td>
                      <td className="px-4 py-2 text-right font-medium">{fmtDollar(p.totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {d.partsSpend.byManufacturer.length > 0 && (
            <div className="mt-4">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={d.partsSpend.byManufacturer} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="manufacturer" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" angle={-30} textAnchor="end" height={70} />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtDollar(v)} />
                  <Bar dataKey="cost" name="Parts Cost" fill={AMBER} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
         </Card>}

        {/* ── S7: Wholesaler Volume (half) ────────────────────────────────── */}
        {d.wholesalerVolume.length > 0 && (
          <Card className="rounded-lg border bg-card p-6">
            <SectionTitle>Wholesaler Volume</SectionTitle>
            <ResponsiveContainer width="100%" height={Math.max(200, d.wholesalerVolume.length * 40)}>
              <BarChart data={d.wholesalerVolume} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis type="category" dataKey="wholesalerName" width={140} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="callCount" name="Calls" fill="#6366f1" radius={[0, 4, 4, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* ── Contractor Analysis (full) ────────────────────────────────── */}
        {d.contractorAnalysis.length > 0 && (
          <Card className="md:col-span-2 rounded-lg border bg-card p-6">
            <SectionTitle>Contractor Analysis</SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Contractor / Company</th>
                    <th className="text-right px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Calls</th>
                    <th className="text-right px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Hours</th>
                    <th className="text-right px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Miles</th>
                    <th className="text-right px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Billed</th>
                  </tr>
                </thead>
                <tbody>
                  {d.contractorAnalysis.map((c: any) => (
                    <tr key={c.contractorName} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-2 font-medium">{c.contractorName}</td>
                      <td className="px-4 py-2 text-right">{c.callCount}</td>
                      <td className="px-4 py-2 text-right">{c.totalHours}</td>
                      <td className="px-4 py-2 text-right">{c.totalMiles}</td>
                      <td className="px-4 py-2 text-right font-medium">${c.totalBilled.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ── S8: Team Workload (half) ────────────────────────────────────── */}
        {userIsManager && data?.teamWorkload && <Card className="rounded-lg border bg-card p-6">
          <SectionTitle>Team Workload</SectionTitle>
          {d.teamWorkload.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Team Member</th>
                    <th className="text-right px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Calls</th>
                    <th className="text-right px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Hours</th>
                    <th className="text-right px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Miles</th>
                  </tr>
                </thead>
                <tbody>
                  {d.teamWorkload.map((t, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 font-medium">{t.userName}</td>
                      <td className="px-4 py-2 text-right">{t.callCount}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{t.totalHours}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{t.totalMiles}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No team data available</p>
          )}
         </Card>}

        {/* ── S9: Warranty Mix (half) ─────────────────────────────────────── */}
        <Card className="rounded-lg border bg-card p-6">
          <SectionTitle>Warranty Mix</SectionTitle>
          {warrantyData.length > 0 ? (
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={warrantyData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {warrantyData.map((_, i) => (
                      <Cell key={i} fill={warrantyColors[i % warrantyColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No warranty data</p>
          )}
        </Card>

        {/* ── S10: Repeat Failures (full) ─────────────────────────────────── */}
        <Card className="md:col-span-2 rounded-lg border bg-card p-6">
          <SectionTitle>Repeat Service — Units with Multiple Calls</SectionTitle>
          {d.repeatFailures.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Serial Number</th>
                    <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Address</th>
                    <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Customer</th>
                    <th className="text-left px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Manufacturer</th>
                    <th className="text-right px-4 py-2 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {d.repeatFailures.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 font-mono text-xs font-medium">{r.serialNumber}</td>
                      <td className="px-4 py-2 text-muted-foreground">{r.address || "\u2014"}</td>
                      <td className="px-4 py-2">{r.customerName || "\u2014"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{r.manufacturer}</td>
                      <td className="px-4 py-2 text-right">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-xs font-bold">
                          {r.callCount}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No repeat failures found</p>
          )}
        </Card>

        {/* ── S11: Seasonal Trends (full) ─────────────────────────────────── */}
        <Card className="md:col-span-2 rounded-lg border bg-card p-6">
          <SectionTitle>Seasonal Trends</SectionTitle>
          {d.callsByMonth.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={d.callsByMonth.map(m => ({ ...m, label: fmtMonth(m.month) }))} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="count" name="Service Calls" stroke={BLUE} strokeWidth={2} dot={{ r: 4, fill: BLUE }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No data</p>
          )}
        </Card>

        {/* ── S12: Payment Speed (small card) ─────────────────────────────── */}
        {userIsManager && data?.avgDaysToPayment != null && <Card className="rounded-lg border bg-card p-6">
          <SectionTitle>Payment Speed</SectionTitle>
          <div className="flex flex-col items-center justify-center py-4">
            <p className={`text-4xl font-bold ${paymentColor}`}>
              {d.avgDaysToPayment}
            </p>
            <p className="text-sm text-muted-foreground mt-1">avg days to payment</p>
          </div>
         </Card>}

      </div>
    </div>
  );
}
