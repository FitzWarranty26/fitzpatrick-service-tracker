import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileBarChart, Download, FileText, Mail } from "lucide-react";
import { MANUFACTURERS, CLAIM_STATUSES } from "@shared/schema";

// ─── Types ─────────────────────────────────────────────────────────────────

interface ManufacturerSummaryReport {
  manufacturer: string;
  dateFrom: string | null;
  dateTo: string | null;
  summary: {
    totalCalls: number;
    uniqueModels: number;
    uniqueCustomers: number;
    totalPartsCost: number;
    totalLaborCost: number;
    totalClaimAmount: number;
  };
  calls: Array<{
    id: number;
    callDate: string;
    customerName: string;
    jobSiteName: string;
    productModel: string;
    productSerial: string | null;
    status: string;
    claimStatus: string;
    claimNumber: string | null;
    partsCost: string | null;
    laborCost: string | null;
    claimAmount: string | null;
  }>;
}

interface MonthlyExpenseReport {
  dateFrom: string | null;
  dateTo: string | null;
  summary: {
    totalHours: number;
    totalMiles: number;
    totalMileageCost: number;
    totalPartsCost: number;
    totalLaborCost: number;
    totalOtherCost: number;
    totalCosts: number;
    totalClaimAmount: number;
    net: number;
  };
  months: Array<{
    month: string;
    calls: number;
    hours: number;
    miles: number;
    mileageCost: number;
    partsCost: number;
    laborCost: number;
    otherCost: number;
    totalCosts: number;
    claimAmount: number;
  }>;
}

interface CustomerHistoryReport {
  customer: string;
  dateFrom: string | null;
  dateTo: string | null;
  contact: {
    contactName: string;
    companyName: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
  } | null;
  summary: {
    totalCalls: number;
    totalPartsCost: number;
    totalLaborCost: number;
    totalClaimAmount: number;
  };
  calls: Array<{
    id: number;
    callDate: string;
    jobSiteName: string;
    manufacturer: string;
    productModel: string;
    productSerial: string | null;
    issueDescription: string;
    status: string;
    claimStatus: string;
    claimAmount: string | null;
  }>;
}

interface ClaimStatusReport {
  dateFrom: string | null;
  dateTo: string | null;
  manufacturer: string | null;
  statusCounts: Record<string, { count: number; amount: number }>;
  calls: Array<{
    id: number;
    callDate: string;
    customerName: string;
    manufacturer: string;
    productModel: string;
    claimNumber: string | null;
    claimStatus: string;
    claimAmount: string | null;
    daysPending: number;
  }>;
}

interface ProductFailureReport {
  dateFrom: string | null;
  dateTo: string | null;
  manufacturer: string | null;
  minCount: number;
  models: Array<{
    manufacturer: string;
    model: string;
    count: number;
    uniqueSerials: number;
    uniqueCustomers: number;
    lastServiceDate: string;
    issues: string[];
  }>;
}

type ReportData = ManufacturerSummaryReport | MonthlyExpenseReport | CustomerHistoryReport | ClaimStatusReport | ProductFailureReport;

// ─── Constants ─────────────────────────────────────────────────────────────

const REPORT_TYPES = [
  { value: "manufacturer-summary", label: "Manufacturer Service Summary" },
  { value: "monthly-expense", label: "Monthly Expense Report" },
  { value: "customer-history", label: "Customer History" },
  { value: "claim-status", label: "Claim Status Report" },
  { value: "product-failure", label: "Product Failure Report" },
] as const;

type ReportType = typeof REPORT_TYPES[number]["value"];

const currentYear = new Date().getFullYear();
const defaultDateFrom = `${currentYear}-01-01`;
const defaultDateTo = `${currentYear}-12-31`;

function fmt$(val: number | string | null | undefined): string {
  const n = typeof val === "string" ? parseFloat(val) || 0 : (val ?? 0);
  return `$${n.toFixed(2)}`;
}

function monthLabel(monthStr: string): string {
  const [y, m] = monthStr.split("-");
  const date = new Date(parseInt(y), parseInt(m) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function Reports() {
  const [reportType, setReportType] = useState<ReportType>("manufacturer-summary");
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [manufacturer, setManufacturer] = useState("");
  const [customer, setCustomer] = useState("");
  const [claimStatusFilter, setClaimStatusFilter] = useState("__default__");
  const [minCount, setMinCount] = useState("2");

  // Fetch unique customer names for the customer dropdown
  const { data: customerNames } = useQuery<string[]>({
    queryKey: ["/api/service-calls", "customer-names"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/service-calls");
      const calls = await res.json() as Array<{ customerName: string }>;
      const names = Array.from(new Set(calls.map(c => c.customerName))).sort();
      return names;
    },
  });

  // Build query params
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    switch (reportType) {
      case "manufacturer-summary":
        if (manufacturer) params.set("manufacturer", manufacturer);
        break;
      case "customer-history":
        if (customer) params.set("customer", customer);
        break;
      case "claim-status":
        if (manufacturer) params.set("manufacturer", manufacturer);
        if (claimStatusFilter && claimStatusFilter !== "__default__") params.set("claimStatus", claimStatusFilter);
        break;
      case "product-failure":
        if (manufacturer) params.set("manufacturer", manufacturer);
        if (minCount) params.set("minCount", minCount);
        break;
    }
    return params.toString();
  }, [reportType, dateFrom, dateTo, manufacturer, customer, claimStatusFilter, minCount]);

  // Is the required filter set?
  const canFetch = (() => {
    if (reportType === "manufacturer-summary" && !manufacturer) return false;
    if (reportType === "customer-history" && !customer) return false;
    return true;
  })();

  const { data: reportData, isLoading, isFetching } = useQuery<ReportData>({
    queryKey: [`/api/reports/${reportType}`, queryParams],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/${reportType}?${queryParams}`);
      return res.json();
    },
    enabled: canFetch,
  });

  // ─── CSV Download ─────────────────────────────────────────────────────────

  const handleCSVDownload = () => {
    if (!reportData) return;
    let csv = "";
    const esc = (v: any) => {
      if (v == null) return "";
      const s = String(v);
      return s.includes('"') || s.includes(",") || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };

    switch (reportType) {
      case "manufacturer-summary": {
        const d = reportData as ManufacturerSummaryReport;
        csv = ["Date,Customer,Site,Model,Serial,Status,Claim Status,Claim #,Parts Cost,Labor Cost,Claim Amount",
          ...d.calls.map(c => [c.callDate, c.customerName, c.jobSiteName, c.productModel, c.productSerial, c.status, c.claimStatus, c.claimNumber, c.partsCost, c.laborCost, c.claimAmount].map(esc).join(","))
        ].join("\n");
        break;
      }
      case "monthly-expense": {
        const d = reportData as MonthlyExpenseReport;
        csv = ["Month,Calls,Hours,Miles,Mileage $,Parts Cost,Labor Cost,Other Cost,Total Costs,Claim Amount",
          ...d.months.map(m => [monthLabel(m.month), m.calls, m.hours, m.miles, m.mileageCost, m.partsCost, m.laborCost, m.otherCost, m.totalCosts, m.claimAmount].map(esc).join(","))
        ].join("\n");
        break;
      }
      case "customer-history": {
        const d = reportData as CustomerHistoryReport;
        csv = ["Date,Site,Manufacturer,Model,Serial,Issue,Status,Claim Status,Claim Amount",
          ...d.calls.map(c => [c.callDate, c.jobSiteName, c.manufacturer, c.productModel, c.productSerial, c.issueDescription, c.status, c.claimStatus, c.claimAmount].map(esc).join(","))
        ].join("\n");
        break;
      }
      case "claim-status": {
        const d = reportData as ClaimStatusReport;
        csv = ["Call #,Date,Customer,Manufacturer,Model,Claim #,Claim Status,Claim Amount,Days Pending",
          ...d.calls.map(c => [c.id, c.callDate, c.customerName, c.manufacturer, c.productModel, c.claimNumber, c.claimStatus, c.claimAmount, c.daysPending].map(esc).join(","))
        ].join("\n");
        break;
      }
      case "product-failure": {
        const d = reportData as ProductFailureReport;
        csv = ["Manufacturer,Model,Service Calls,Unique Serials,Unique Customers,Last Service Date,Common Issues",
          ...d.models.map(m => [m.manufacturer, m.model, m.count, m.uniqueSerials, m.uniqueCustomers, m.lastServiceDate, m.issues.join("; ")].map(esc).join(","))
        ].join("\n");
        break;
      }
    }

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportType}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── PDF Download ─────────────────────────────────────────────────────────

  const handlePDFDownload = async () => {
    if (!reportData) return;
    const { generateReportPDF } = await import("@/lib/report-pdf");
    generateReportPDF(reportType, reportData);
  };

  // ─── Email Report ──────────────────────────────────────────────────────────

  const handleEmailReport = () => {
    if (!reportData) return;
    const reportLabel = REPORT_TYPES.find(r => r.value === reportType)?.label ?? reportType;
    const dateRange = dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : "";
    const subject = encodeURIComponent(`${reportLabel}${dateRange ? ` — ${dateRange}` : ""}`);
    let summary = `Report: ${reportLabel}\n`;
    if (dateRange) summary += `Date Range: ${dateRange}\n`;

    switch (reportType) {
      case "manufacturer-summary": {
        const d = reportData as ManufacturerSummaryReport;
        summary += `Manufacturer: ${d.manufacturer || "All"}\nTotal Calls: ${d.summary.totalCalls}\nUnique Models: ${d.summary.uniqueModels}\nTotal Parts Cost: $${d.summary.totalPartsCost.toFixed(2)}\nTotal Labor Cost: $${d.summary.totalLaborCost.toFixed(2)}\nTotal Claim Amount: $${d.summary.totalClaimAmount.toFixed(2)}`;
        break;
      }
      case "monthly-expense": {
        const d = reportData as MonthlyExpenseReport;
        summary += `Total Hours: ${d.summary.totalHours}\nTotal Miles: ${d.summary.totalMiles}\nTotal Costs: $${d.summary.totalCosts.toFixed(2)}\nTotal Claims: $${d.summary.totalClaimAmount.toFixed(2)}\nNet: $${d.summary.net.toFixed(2)}`;
        break;
      }
      case "customer-history": {
        const d = reportData as CustomerHistoryReport;
        summary += `Customer: ${d.customer}\nTotal Calls: ${d.summary.totalCalls}\nTotal Claims: $${d.summary.totalClaimAmount.toFixed(2)}`;
        break;
      }
      case "claim-status": {
        const d = reportData as ClaimStatusReport;
        summary += `Total Claims: ${d.calls.length}`;
        break;
      }
      case "product-failure": {
        const d = reportData as ProductFailureReport;
        summary += `Models with repeat failures: ${d.models.length}`;
        break;
      }
    }

    const body = encodeURIComponent(summary + "\n\nFull report attached separately.");
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Generate and download service reports</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleEmailReport}
            disabled={!reportData || isLoading}
            data-testid="button-email-report"
          >
            <Mail className="w-4 h-4 mr-1.5" />
            Email
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCSVDownload}
            disabled={!reportData || isLoading}
            data-testid="button-download-csv"
          >
            <Download className="w-4 h-4 mr-1.5" />
            CSV
          </Button>
          <Button
            size="sm"
            onClick={handlePDFDownload}
            disabled={!reportData || isLoading}
            data-testid="button-download-pdf"
          >
            <FileText className="w-4 h-4 mr-1.5" />
            PDF
          </Button>
        </div>
      </div>

      {/* Controls */}
      <Card className="mb-5">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            {/* Report type */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Report Type</label>
              <Select value={reportType} onValueChange={v => setReportType(v as ReportType)}>
                <SelectTrigger data-testid="select-report-type">
                  <SelectValue placeholder="Report Type" />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date from */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">From</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                data-testid="input-date-from"
              />
            </div>

            {/* Date to */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">To</label>
              <Input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                data-testid="input-date-to"
              />
            </div>

            {/* Conditional filter */}
            {(reportType === "manufacturer-summary" || reportType === "claim-status" || reportType === "product-failure") && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Manufacturer{reportType === "manufacturer-summary" ? " *" : ""}
                </label>
                <Select
                  value={manufacturer || "__all__"}
                  onValueChange={v => setManufacturer(v === "__all__" ? "" : v)}
                >
                  <SelectTrigger data-testid="select-manufacturer">
                    <SelectValue placeholder="Select manufacturer" />
                  </SelectTrigger>
                  <SelectContent>
                    {reportType !== "manufacturer-summary" && (
                      <SelectItem value="__all__">All Manufacturers</SelectItem>
                    )}
                    {MANUFACTURERS.map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {reportType === "customer-history" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Customer *</label>
                <Select
                  value={customer || "__none__"}
                  onValueChange={v => setCustomer(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger data-testid="select-customer">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select a customer</SelectItem>
                    {(customerNames || []).map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {reportType === "claim-status" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Claim Status</label>
                <Select
                  value={claimStatusFilter}
                  onValueChange={v => setClaimStatusFilter(v)}
                >
                  <SelectTrigger data-testid="select-claim-status">
                    <SelectValue placeholder="Claim Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Submitted + Pending</SelectItem>
                    <SelectItem value="__all__">All Statuses</SelectItem>
                    {CLAIM_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {reportType === "product-failure" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Min Occurrences</label>
                <Input
                  type="number"
                  min={1}
                  value={minCount}
                  onChange={e => setMinCount(e.target.value)}
                  data-testid="input-min-count"
                />
              </div>
            )}
          </div>

          {!canFetch && (
            <p className="text-xs text-amber-600">
              {reportType === "manufacturer-summary" ? "Select a manufacturer to generate the report." : "Select a customer to generate the report."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Report Preview */}
      {(isLoading || isFetching) && canFetch ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !canFetch ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileBarChart className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Select required filters to generate a report.</p>
        </div>
      ) : reportData ? (
        <Card>
          <CardContent className="p-4 overflow-x-auto">
            {reportType === "manufacturer-summary" && <ManufacturerSummaryPreview data={reportData as ManufacturerSummaryReport} />}
            {reportType === "monthly-expense" && <MonthlyExpensePreview data={reportData as MonthlyExpenseReport} />}
            {reportType === "customer-history" && <CustomerHistoryPreview data={reportData as CustomerHistoryReport} />}
            {reportType === "claim-status" && <ClaimStatusPreview data={reportData as ClaimStatusReport} />}
            {reportType === "product-failure" && <ProductFailurePreview data={reportData as ProductFailureReport} />}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileBarChart className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No data returned.</p>
        </div>
      )}
    </div>
  );
}

// ─── Preview Components ──────────────────────────────────────────────────────

function SummaryGrid({ items }: { items: Array<{ label: string; value: string | number }> }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {items.map(item => (
        <div key={item.label} className="bg-muted/40 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p className="text-lg font-bold">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function ManufacturerSummaryPreview({ data }: { data: ManufacturerSummaryReport }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-1">{data.manufacturer}</h3>
      <p className="text-xs text-muted-foreground mb-3">
        {data.dateFrom && data.dateTo ? `${formatDate(data.dateFrom)} — ${formatDate(data.dateTo)}` : "All dates"}
      </p>

      <SummaryGrid items={[
        { label: "Total Calls", value: data.summary.totalCalls },
        { label: "Unique Models", value: data.summary.uniqueModels },
        { label: "Unique Customers", value: data.summary.uniqueCustomers },
        { label: "Parts Cost", value: fmt$(data.summary.totalPartsCost) },
        { label: "Labor Cost", value: fmt$(data.summary.totalLaborCost) },
        { label: "Claim Amount", value: fmt$(data.summary.totalClaimAmount) },
      ]} />

      {data.calls.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No calls found for this manufacturer.</p>
      ) : (
        <table className="w-full text-sm" data-testid="report-table">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Date</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Customer</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Site</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Model</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Serial</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Claim</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Claim #</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Parts</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Labor</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Claim $</th>
            </tr>
          </thead>
          <tbody>
            {data.calls.map(c => (
              <tr key={c.id} className="border-b border-border/50">
                <td className="px-3 py-2 text-xs whitespace-nowrap">{formatDate(c.callDate)}</td>
                <td className="px-3 py-2 text-xs">{c.customerName}</td>
                <td className="px-3 py-2 text-xs">{c.jobSiteName}</td>
                <td className="px-3 py-2 text-xs font-mono">{c.productModel}</td>
                <td className="px-3 py-2 text-xs font-mono">{c.productSerial || "—"}</td>
                <td className="px-3 py-2 text-xs">{c.status}</td>
                <td className="px-3 py-2 text-xs">{c.claimStatus}</td>
                <td className="px-3 py-2 text-xs">{c.claimNumber || "—"}</td>
                <td className="px-3 py-2 text-xs text-right">{fmt$(c.partsCost)}</td>
                <td className="px-3 py-2 text-xs text-right">{fmt$(c.laborCost)}</td>
                <td className="px-3 py-2 text-xs text-right font-medium">{fmt$(c.claimAmount)}</td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-semibold">
              <td colSpan={8} className="px-3 py-2 text-xs text-right">Totals:</td>
              <td className="px-3 py-2 text-xs text-right">{fmt$(data.summary.totalPartsCost)}</td>
              <td className="px-3 py-2 text-xs text-right">{fmt$(data.summary.totalLaborCost)}</td>
              <td className="px-3 py-2 text-xs text-right">{fmt$(data.summary.totalClaimAmount)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function MonthlyExpensePreview({ data }: { data: MonthlyExpenseReport }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-1">Monthly Expense Report</h3>
      <p className="text-xs text-muted-foreground mb-3">
        {data.dateFrom && data.dateTo ? `${formatDate(data.dateFrom)} — ${formatDate(data.dateTo)}` : "All dates"}
      </p>

      <SummaryGrid items={[
        { label: "Total Hours", value: data.summary.totalHours },
        { label: "Total Miles", value: data.summary.totalMiles },
        { label: "Mileage Deduction", value: fmt$(data.summary.totalMileageCost) },
        { label: "Total Costs", value: fmt$(data.summary.totalCosts) },
        { label: "Claim Amount", value: fmt$(data.summary.totalClaimAmount) },
        { label: "Net", value: fmt$(data.summary.net) },
      ]} />

      {data.months.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No data for this period.</p>
      ) : (
        <table className="w-full text-sm" data-testid="report-table">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Month</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Calls</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Hours</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Miles</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Mileage $</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Parts</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Labor</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Other</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Total</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Claim $</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map(m => (
              <tr key={m.month} className="border-b border-border/50">
                <td className="px-3 py-2 text-xs">{monthLabel(m.month)}</td>
                <td className="px-3 py-2 text-xs text-right">{m.calls}</td>
                <td className="px-3 py-2 text-xs text-right">{m.hours}</td>
                <td className="px-3 py-2 text-xs text-right">{m.miles}</td>
                <td className="px-3 py-2 text-xs text-right">{fmt$(m.mileageCost)}</td>
                <td className="px-3 py-2 text-xs text-right">{fmt$(m.partsCost)}</td>
                <td className="px-3 py-2 text-xs text-right">{fmt$(m.laborCost)}</td>
                <td className="px-3 py-2 text-xs text-right">{fmt$(m.otherCost)}</td>
                <td className="px-3 py-2 text-xs text-right font-medium">{fmt$(m.totalCosts)}</td>
                <td className="px-3 py-2 text-xs text-right font-medium">{fmt$(m.claimAmount)}</td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-semibold">
              <td className="px-3 py-2 text-xs">Grand Total</td>
              <td className="px-3 py-2 text-xs text-right">{data.months.reduce((s, m) => s + m.calls, 0)}</td>
              <td className="px-3 py-2 text-xs text-right">{data.summary.totalHours}</td>
              <td className="px-3 py-2 text-xs text-right">{data.summary.totalMiles}</td>
              <td className="px-3 py-2 text-xs text-right">{fmt$(data.summary.totalMileageCost)}</td>
              <td className="px-3 py-2 text-xs text-right">{fmt$(data.summary.totalPartsCost)}</td>
              <td className="px-3 py-2 text-xs text-right">{fmt$(data.summary.totalLaborCost)}</td>
              <td className="px-3 py-2 text-xs text-right">{fmt$(data.summary.totalOtherCost)}</td>
              <td className="px-3 py-2 text-xs text-right">{fmt$(data.summary.totalCosts)}</td>
              <td className="px-3 py-2 text-xs text-right">{fmt$(data.summary.totalClaimAmount)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function CustomerHistoryPreview({ data }: { data: CustomerHistoryReport }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-1">{data.customer}</h3>
      {data.contact && (
        <div className="text-xs text-muted-foreground mb-3 space-y-0.5">
          {data.contact.address && <p>{data.contact.address}{data.contact.city ? `, ${data.contact.city}` : ""}{data.contact.state ? `, ${data.contact.state}` : ""}</p>}
          {data.contact.phone && <p>Phone: {data.contact.phone}</p>}
          {data.contact.email && <p>Email: {data.contact.email}</p>}
        </div>
      )}

      <SummaryGrid items={[
        { label: "Total Calls", value: data.summary.totalCalls },
        { label: "Parts Cost", value: fmt$(data.summary.totalPartsCost) },
        { label: "Labor Cost", value: fmt$(data.summary.totalLaborCost) },
        { label: "Claim Amount", value: fmt$(data.summary.totalClaimAmount) },
      ]} />

      {data.calls.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No calls found for this customer.</p>
      ) : (
        <table className="w-full text-sm" data-testid="report-table">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Date</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Site</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Manufacturer</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Model</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Serial</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Issue</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Claim</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Claim $</th>
            </tr>
          </thead>
          <tbody>
            {data.calls.map(c => (
              <tr key={c.id} className="border-b border-border/50">
                <td className="px-3 py-2 text-xs whitespace-nowrap">{formatDate(c.callDate)}</td>
                <td className="px-3 py-2 text-xs">{c.jobSiteName}</td>
                <td className="px-3 py-2 text-xs">{c.manufacturer}</td>
                <td className="px-3 py-2 text-xs font-mono">{c.productModel}</td>
                <td className="px-3 py-2 text-xs font-mono">{c.productSerial || "—"}</td>
                <td className="px-3 py-2 text-xs max-w-[200px] truncate">{truncate(c.issueDescription, 60)}</td>
                <td className="px-3 py-2 text-xs">{c.status}</td>
                <td className="px-3 py-2 text-xs">{c.claimStatus}</td>
                <td className="px-3 py-2 text-xs text-right font-medium">{fmt$(c.claimAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ClaimStatusPreview({ data }: { data: ClaimStatusReport }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-1">Claim Status Report</h3>
      <p className="text-xs text-muted-foreground mb-3">
        {data.manufacturer ? data.manufacturer + " · " : ""}{data.dateFrom && data.dateTo ? `${formatDate(data.dateFrom)} — ${formatDate(data.dateTo)}` : "All dates"}
      </p>

      {/* Status summary badges */}
      <div className="flex flex-wrap gap-3 mb-4">
        {Object.entries(data.statusCounts).map(([status, info]) => (
          <div key={status} className="bg-muted/40 rounded-lg px-3 py-2">
            <p className="text-xs text-muted-foreground">{status}</p>
            <p className="text-sm font-bold">{info.count} calls · {fmt$(info.amount)}</p>
          </div>
        ))}
      </div>

      {data.calls.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No claims found.</p>
      ) : (
        <table className="w-full text-sm" data-testid="report-table">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Call #</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Date</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Customer</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Manufacturer</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Model</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Claim #</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Status</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Amount</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Days</th>
            </tr>
          </thead>
          <tbody>
            {data.calls.map(c => (
              <tr key={c.id} className="border-b border-border/50">
                <td className="px-3 py-2 text-xs">#{c.id}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{formatDate(c.callDate)}</td>
                <td className="px-3 py-2 text-xs">{c.customerName}</td>
                <td className="px-3 py-2 text-xs">{c.manufacturer}</td>
                <td className="px-3 py-2 text-xs font-mono">{c.productModel}</td>
                <td className="px-3 py-2 text-xs">{c.claimNumber || "—"}</td>
                <td className="px-3 py-2 text-xs">{c.claimStatus}</td>
                <td className="px-3 py-2 text-xs text-right font-medium">{fmt$(c.claimAmount)}</td>
                <td className="px-3 py-2 text-xs text-right">{c.daysPending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProductFailurePreview({ data }: { data: ProductFailureReport }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-1">Product Failure Report</h3>
      <p className="text-xs text-muted-foreground mb-3">
        {data.manufacturer ? data.manufacturer + " · " : ""}{data.dateFrom && data.dateTo ? `${formatDate(data.dateFrom)} — ${formatDate(data.dateTo)}` : "All dates"} · Min {data.minCount} occurrences
      </p>

      {data.models.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No models with {data.minCount}+ service calls found.</p>
      ) : (
        <table className="w-full text-sm" data-testid="report-table">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Manufacturer</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Model</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Calls</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Serials</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Customers</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Last Service</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Common Issues</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((m, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="px-3 py-2 text-xs">{m.manufacturer}</td>
                <td className="px-3 py-2 text-xs font-mono">{m.model}</td>
                <td className="px-3 py-2 text-xs text-right font-bold">{m.count}</td>
                <td className="px-3 py-2 text-xs text-right">{m.uniqueSerials}</td>
                <td className="px-3 py-2 text-xs text-right">{m.uniqueCustomers}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{formatDate(m.lastServiceDate)}</td>
                <td className="px-3 py-2 text-xs max-w-[300px]">
                  <ul className="list-disc list-inside space-y-0.5">
                    {m.issues.slice(0, 3).map((issue, j) => (
                      <li key={j}>{truncate(issue, 80)}</li>
                    ))}
                    {m.issues.length > 3 && <li className="text-muted-foreground">+{m.issues.length - 3} more</li>}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
