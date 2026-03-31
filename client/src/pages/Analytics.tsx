import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from "recharts";
import {
  ClipboardCheck,
  Boxes,
  Users,
  AlertTriangle,
  Download,
  Search,
  DollarSign,
  Clock,
} from "lucide-react";
import { subDays, format, parseISO } from "date-fns";
import { MANUFACTURERS } from "@shared/schema";

// Types
interface SummaryData {
  totalCalls: number;
  totalByStatus: Record<string, number>;
  totalByClaimStatus: Record<string, number>;
  uniqueModels: number;
  uniqueCustomers: number;
  dateRange: { from: string | null; to: string | null };
  financials?: {
    totalPartsCost: number;
    totalLaborCost: number;
    totalOtherCost: number;
    totalClaimAmount: number;
    totalCosts: number;
  };
  logistics?: {
    totalHours: number;
    totalMiles: number;
    monthlyBreakdown: Array<{ month: string; hours: number; miles: number; calls: number }>;
  };
}

interface MfgData {
  manufacturer: string;
  count: number;
  models: { model: string; count: number }[];
}

interface ModelData {
  manufacturer: string;
  model: string;
  count: number;
  serialNumbers: string[];
  lastServiceDate: string;
  customers: string[];
}

interface TrendData {
  month: string;
  count: number;
  completed: number;
  open: number;
}

interface RepeatData {
  model: string;
  manufacturer: string;
  count: number;
  serialNumbers: string[];
}

function formatDateStr(d: string): string {
  try {
    return format(parseISO(d), "MMM d, yyyy");
  } catch {
    return d;
  }
}

function formatMonth(m: string): string {
  try {
    return format(parseISO(m + "-01"), "MMM yyyy");
  } catch {
    return m;
  }
}

export default function Analytics() {
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(format(subDays(today, 90), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(today, "yyyy-MM-dd"));
  const [manufacturer, setManufacturer] = useState<string>("all");
  const [chartFilter, setChartFilter] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");

  // The effective manufacturer filter: from dropdown or chart click
  const effectiveMfg = chartFilter || (manufacturer !== "all" ? manufacturer : undefined);

  function buildParams() {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (effectiveMfg) params.set("manufacturer", effectiveMfg);
    return params.toString();
  }

  // Only date range params (no manufacturer) for the bar chart
  function buildDateParams() {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (manufacturer !== "all") params.set("manufacturer", manufacturer);
    return params.toString();
  }

  const qs = buildParams();
  const dateQs = buildDateParams();

  const { data: summary, isLoading: summaryLoading } = useQuery<SummaryData>({
    queryKey: ["/api/analytics/summary", qs],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/analytics/summary?${qs}`);
      return res.json();
    },
  });

  const { data: byManufacturer, isLoading: mfgLoading } = useQuery<MfgData[]>({
    queryKey: ["/api/analytics/by-manufacturer", dateQs],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/analytics/by-manufacturer?${dateQs}`);
      return res.json();
    },
  });

  const { data: byModel, isLoading: modelLoading } = useQuery<ModelData[]>({
    queryKey: ["/api/analytics/by-model", qs],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/analytics/by-model?${qs}`);
      return res.json();
    },
  });

  const { data: trends, isLoading: trendLoading } = useQuery<TrendData[]>({
    queryKey: ["/api/analytics/trends", qs],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/analytics/trends?${qs}`);
      return res.json();
    },
  });

  const { data: repeatFailures, isLoading: repeatLoading } = useQuery<RepeatData[]>({
    queryKey: ["/api/analytics/repeat-failures", qs],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/analytics/repeat-failures?${qs}`);
      return res.json();
    },
  });

  const filteredModels = useMemo(() => {
    if (!byModel) return [];
    if (!modelSearch.trim()) return byModel;
    const s = modelSearch.toLowerCase();
    return byModel.filter(
      (m) =>
        m.model.toLowerCase().includes(s) ||
        m.manufacturer.toLowerCase().includes(s) ||
        m.serialNumbers.some((sn) => sn.toLowerCase().includes(s))
    );
  }, [byModel, modelSearch]);

  async function handleExport() {
    try {
      const res = await apiRequest("GET", `/api/analytics/export?${qs}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `service-calls-export-${format(today, "yyyy-MM-dd")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed:", e);
    }
  }

  function handleBarClick(data: any) {
    if (data && data.activePayload && data.activePayload[0]) {
      const clickedMfg = data.activePayload[0].payload.manufacturer;
      setChartFilter((prev) => (prev === clickedMfg ? null : clickedMfg));
    }
  }

  const repeatCount = repeatFailures?.length ?? 0;

  const summaryCards = [
    {
      title: "Total Service Calls",
      value: summary?.totalCalls ?? 0,
      icon: ClipboardCheck,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-900/20",
      testId: "analytics-total",
    },
    {
      title: "Unique Models",
      value: summary?.uniqueModels ?? 0,
      icon: Boxes,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-900/20",
      testId: "analytics-models",
    },
    {
      title: "Unique Customers",
      value: summary?.uniqueCustomers ?? 0,
      icon: Users,
      color: "text-violet-600 dark:text-violet-400",
      bg: "bg-violet-50 dark:bg-violet-900/20",
      testId: "analytics-customers",
    },
    {
      title: "Repeat Failures",
      value: repeatCount,
      icon: AlertTriangle,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-900/20",
      testId: "analytics-repeats",
    },
  ];

  // Prepare bar chart data with shortened labels
  const barData = useMemo(() => {
    if (!byManufacturer) return [];
    return byManufacturer.map((m) => ({
      manufacturer: m.manufacturer,
      shortName: m.manufacturer.length > 20 ? m.manufacturer.slice(0, 18) + "…" : m.manufacturer,
      count: m.count,
    }));
  }, [byManufacturer]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground" data-testid="analytics-heading">
            Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Service call insights and trends
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          data-testid="button-export-csv"
        >
          <Download className="w-4 h-4 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
            <div className="flex-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                From
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setChartFilter(null); }}
                className="h-9 text-sm"
                data-testid="input-date-from"
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                To
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setChartFilter(null); }}
                className="h-9 text-sm"
                data-testid="input-date-to"
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Manufacturer
              </label>
              <Select
                value={manufacturer}
                onValueChange={(v) => { setManufacturer(v); setChartFilter(null); }}
              >
                <SelectTrigger className="h-9 text-sm" data-testid="select-manufacturer">
                  <SelectValue placeholder="All Manufacturers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Manufacturers</SelectItem>
                  {MANUFACTURERS.filter((m) => m !== "Other").map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {chartFilter && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Filtered by chart selection:
              </span>
              <span className="text-xs font-medium text-foreground bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">
                {chartFilter}
              </span>
              <button
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => setChartFilter(null)}
                data-testid="button-clear-chart-filter"
              >
                Clear
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="overflow-hidden" data-testid={card.testId}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium leading-tight mb-1">
                      {card.title}
                    </p>
                    {summaryLoading || repeatLoading ? (
                      <Skeleton className="h-8 w-12 mt-1" />
                    ) : (
                      <p
                        className="text-2xl font-bold text-foreground"
                        data-testid={`${card.testId}-value`}
                      >
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
          );
        })}
      </div>

      {/* Financial Summary */}
      {summary?.financials && (summary.financials.totalCosts > 0 || summary.financials.totalClaimAmount > 0) && (
        <Card data-testid="analytics-financials">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg bg-green-50 dark:bg-green-900/20">
                <DollarSign className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Claim Financials</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Parts Cost</p>
                <p className="text-lg font-bold">${summary.financials.totalPartsCost.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Labor Cost</p>
                <p className="text-lg font-bold">${summary.financials.totalLaborCost.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Other Costs</p>
                <p className="text-lg font-bold">${summary.financials.totalOtherCost.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Costs</p>
                <p className="text-lg font-bold">${summary.financials.totalCosts.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Claimed</p>
                <p className="text-lg font-bold text-green-600 dark:text-green-400">${summary.financials.totalClaimAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hours & Miles Summary */}
      {summary?.logistics && (summary.logistics.totalHours > 0 || summary.logistics.totalMiles > 0) && (
        <Card data-testid="analytics-logistics">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Hours & Mileage Summary</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xs text-muted-foreground">Total Hours</p>
                <p className="text-lg font-bold">{summary.logistics.totalHours} hrs</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Miles</p>
                <p className="text-lg font-bold">{summary.logistics.totalMiles.toLocaleString()} mi</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">IRS Rate (2026)</p>
                <p className="text-lg font-bold text-green-600 dark:text-green-400">${(summary.logistics.totalMiles * 0.70).toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">@ $0.70/mi</p>
              </div>
            </div>
            {summary.logistics.monthlyBreakdown.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 text-xs font-medium text-muted-foreground">Month</th>
                      <th className="text-right py-2 text-xs font-medium text-muted-foreground">Calls</th>
                      <th className="text-right py-2 text-xs font-medium text-muted-foreground">Hours</th>
                      <th className="text-right py-2 text-xs font-medium text-muted-foreground">Miles</th>
                      <th className="text-right py-2 text-xs font-medium text-muted-foreground">Mileage $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.logistics.monthlyBreakdown.map((row) => {
                      const [y, m] = row.month.split("-");
                      const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
                      return (
                        <tr key={row.month} className="border-b border-border last:border-0">
                          <td className="py-2 font-medium">{label}</td>
                          <td className="py-2 text-right text-muted-foreground">{row.calls}</td>
                          <td className="py-2 text-right">{row.hours}</td>
                          <td className="py-2 text-right">{row.miles}</td>
                          <td className="py-2 text-right text-green-600 dark:text-green-400">${(row.miles * 0.70).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bar Chart: Calls by Manufacturer */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Calls by Manufacturer
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Click a bar to filter tables below
          </p>
        </CardHeader>
        <CardContent>
          {mfgLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : !barData || barData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
              No data in selected range
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <ResponsiveContainer width="100%" height={Math.max(200, barData.length * 48)}>
                <BarChart
                  data={barData}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                  onClick={handleBarClick}
                  style={{ cursor: "pointer" }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis
                    type="category"
                    dataKey="shortName"
                    width={160}
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <Tooltip
                    formatter={(value: number) => [value, "Service Calls"]}
                    labelFormatter={(label: string) => {
                      const item = barData.find((d) => d.shortName === label);
                      return item?.manufacturer || label;
                    }}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar
                    dataKey="count"
                    fill="#2563EB"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={32}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Models Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <CardTitle className="text-base font-semibold">
              Top Models Serviced
            </CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search models, serial numbers…"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
                data-testid="input-model-search"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {modelLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !filteredModels || filteredModels.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No models found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-models">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                      Model
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                      Manufacturer
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                      Times Serviced
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                      Serial Numbers
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                      Last Service
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredModels.map((m, i) => (
                    <tr
                      key={`${m.manufacturer}-${m.model}-${i}`}
                      className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                      data-testid={`row-model-${i}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium text-foreground">
                        {m.model}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {m.manufacturer}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-bold">
                          {m.count}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[200px]">
                        <span className="line-clamp-2">
                          {m.serialNumbers.length > 0
                            ? m.serialNumbers.join(", ")
                            : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDateStr(m.lastServiceDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly Trend Chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Monthly Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {trendLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : !trends || trends.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
              No data in selected range
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={trends.map((t) => ({
                  ...t,
                  label: formatMonth(t.month),
                }))}
                margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12 }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  stroke="hsl(var(--muted-foreground))"
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="Total Calls"
                  stroke="#2563EB"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#2563EB" }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="completed"
                  name="Completed"
                  stroke="#64748b"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#64748b" }}
                  activeDot={{ r: 6 }}
                  strokeDasharray="4 4"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Repeat Failure Report */}
      <Card className="border-amber-200 dark:border-amber-800/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <CardTitle className="text-base font-semibold">
              Repeat Failure Report
            </CardTitle>
          </div>
          <p className="text-xs text-muted-foreground">
            Models serviced 2 or more times in the selected date range
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {repeatLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !repeatFailures || repeatFailures.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No repeat failures found in selected range
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-repeat-failures">
                <thead>
                  <tr className="border-b border-border bg-amber-50/50 dark:bg-amber-900/10">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                      Model
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                      Manufacturer
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                      Times Serviced
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                      Serial Numbers
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {repeatFailures.map((r, i) => (
                    <tr
                      key={`${r.manufacturer}-${r.model}-${i}`}
                      className="border-b border-border last:border-0 hover:bg-amber-50/30 dark:hover:bg-amber-900/10 transition-colors"
                      data-testid={`row-repeat-${i}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium text-foreground">
                        {r.model}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {r.manufacturer}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-xs font-bold">
                          {r.count}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[240px]">
                        <span className="line-clamp-2">
                          {r.serialNumbers.length > 0
                            ? r.serialNumbers.join(", ")
                            : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
