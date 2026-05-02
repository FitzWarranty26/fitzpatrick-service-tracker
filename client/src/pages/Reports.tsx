import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getUser } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart3, Calendar, Users, FileCheck, AlertTriangle, DollarSign,
  Download, FileText, Mail, Play,
} from "lucide-react";
import { MANUFACTURERS, CLAIM_STATUSES } from "@shared/schema";
import { PageHero } from "@/components/PageHero";

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

interface InvoiceAgingReport {
  summary: {
    current: number;
    days31to60: number;
    days61to90: number;
    over90: number;
    totalOutstanding: number;
  };
  invoices: Array<{
    id: number;
    invoiceNumber: string;
    billToName: string;
    issueDate: string;
    dueDate: string;
    total: string;
    daysOutstanding: number;
    bucket: "current" | "31-60" | "61-90" | "90+";
  }>;
}

type ReportData = ManufacturerSummaryReport | MonthlyExpenseReport | CustomerHistoryReport | ClaimStatusReport | ProductFailureReport | InvoiceAgingReport;

// ─── Constants ─────────────────────────────────────────────────────────────

const REPORT_TYPES = [
  { value: "manufacturer-summary", label: "Manufacturer Service Summary" },
  { value: "monthly-expense", label: "Monthly Expense Report" },
  { value: "customer-history", label: "Customer History" },
  { value: "claim-status", label: "Claim Status Report" },
  { value: "product-failure", label: "Product Failure Report" },
  { value: "invoice-aging", label: "Invoice Aging Report" },
] as const;

type ReportType = typeof REPORT_TYPES[number]["value"];

interface ReportCatalogItem {
  value: ReportType;
  label: string;
  description: string;
  access: string;
  managerOnly: boolean;
  icon: typeof BarChart3;
}

const REPORT_CATALOG: ReportCatalogItem[] = [
  {
    value: "manufacturer-summary",
    label: "Manufacturer Service Summary",
    description: "Service call volume, completion rates, and average labor hours grouped by manufacturer.",
    access: "All roles",
    managerOnly: false,
    icon: BarChart3,
  },
  {
    value: "monthly-expense",
    label: "Monthly Expense Report",
    description: "Monthly breakdown of service activity including call count, total hours, mileage, and parts costs.",
    access: "All roles",
    managerOnly: false,
    icon: Calendar,
  },
  {
    value: "customer-history",
    label: "Customer History",
    description: "Complete service history for a specific customer or job site showing all calls, dates, statuses, and outcomes.",
    access: "All roles",
    managerOnly: false,
    icon: Users,
  },
  {
    value: "claim-status",
    label: "Claim Status Report",
    description: "Warranty claim status across all service calls — filed vs pending vs approved vs denied.",
    access: "All roles",
    managerOnly: false,
    icon: FileCheck,
  },
  {
    value: "product-failure",
    label: "Product Failure Report",
    description: "Service calls grouped by product type and failure patterns. Identifies repeat issues and common failure modes.",
    access: "All roles",
    managerOnly: false,
    icon: AlertTriangle,
  },
  {
    value: "invoice-aging",
    label: "Invoice Aging Report",
    description: "Outstanding invoices grouped by aging bucket — Current, 31-60, 61-90, and 90+ days with dollar totals.",
    access: "Manager only",
    managerOnly: true,
    icon: DollarSign,
  },
];

const currentYear = new Date().getFullYear();
const defaultDateFrom = `${currentYear}-01-01`;
const defaultDateTo = new Date().toISOString().slice(0, 10);

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

function recordCount(data: ReportData | undefined, type: ReportType): number {
  if (!data) return 0;
  switch (type) {
    case "manufacturer-summary": return (data as ManufacturerSummaryReport).calls.length;
    case "monthly-expense": return (data as MonthlyExpenseReport).months.length;
    case "customer-history": return (data as CustomerHistoryReport).calls.length;
    case "claim-status": return (data as ClaimStatusReport).calls.length;
    case "product-failure": return (data as ProductFailureReport).models.length;
    case "invoice-aging": return (data as InvoiceAgingReport).invoices.length;
  }
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function Reports() {
  const user = getUser();
  const isManager = user?.role === "manager";

  const [reportType, setReportType] = useState<ReportType | null>(null);
  const [generated, setGenerated] = useState(false);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [manufacturer, setManufacturer] = useState("");
  const [customer, setCustomer] = useState("");
  const [claimStatusFilter, setClaimStatusFilter] = useState("__default__");
  const [minCount, setMinCount] = useState("2");

  const visibleCatalog = REPORT_CATALOG.filter(c => !c.managerOnly || isManager);

  const { data: customerNames } = useQuery<string[]>({
    queryKey: ["/api/service-calls", "customer-names"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/service-calls");
      const calls = await res.json() as Array<{ customerName: string }>;
      const names = Array.from(new Set(calls.map(c => c.customerName))).sort();
      return names;
    },
  });

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

  const canFetch = (() => {
    if (!reportType) return false;
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
    enabled: !!reportType && canFetch && generated,
  });

  const handleSelectReport = (type: ReportType) => {
    setReportType(type);
    setGenerated(false);
    // Reset filters that don't apply across reports
    if (type !== "manufacturer-summary" && type !== "claim-status" && type !== "product-failure") {
      setManufacturer("");
    }
    if (type !== "customer-history") {
      setCustomer("");
    }
  };

  const handleGenerate = () => {
    setGenerated(true);
  };

  // ─── CSV Download ─────────────────────────────────────────────────────────

  const handleCSVDownload = () => {
    if (!reportData || !reportType) return;
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
      case "invoice-aging": {
        const d = reportData as InvoiceAgingReport;
        csv = ["Invoice #,Customer,Issue Date,Due Date,Amount,Days Outstanding,Bucket",
          ...d.invoices.map(i => [i.invoiceNumber, i.billToName, i.issueDate, i.dueDate, i.total, i.daysOutstanding, i.bucket].map(esc).join(","))
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
    if (!reportData || !reportType) return;
    const { generateReportPDF } = await import("@/lib/report-pdf");
    generateReportPDF(reportType, reportData);
  };

  // ─── Email Report ──────────────────────────────────────────────────────────

  const handleEmailReport = () => {
    if (!reportData || !reportType) return;
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
      case "invoice-aging": {
        const d = reportData as InvoiceAgingReport;
        summary += `Total Outstanding: $${d.summary.totalOutstanding.toFixed(2)}\nCurrent (0-30): $${d.summary.current.toFixed(2)}\n31-60 days: $${d.summary.days31to60.toFixed(2)}\n61-90 days: $${d.summary.days61to90.toFixed(2)}\n90+: $${d.summary.over90.toFixed(2)}`;
        break;
      }
    }

    const body = encodeURIComponent(summary + "\n\nFull report attached separately.");
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  // ─── Derived ──────────────────────────────────────────────────────────────

  const selectedCatalogItem = reportType ? REPORT_CATALOG.find(c => c.value === reportType) : null;
  const hasReport = !!reportData && generated && canFetch;

  const missingFilterMessage = (() => {
    if (!reportType) return null;
    if (reportType === "manufacturer-summary" && !manufacturer) return "Select a manufacturer to generate this report.";
    if (reportType === "customer-history" && !customer) return "Select a customer to generate this report.";
    return null;
  })();

  const formatDateRangeLabel = () => {
    const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
    const to = dateTo ? new Date(dateTo + "T00:00:00") : null;
    const fmt = (d: Date | null) => d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
    return `${fmt(from)} — ${fmt(to)}`;
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-24 md:pb-6 space-y-5">
      <PageHero
        title="Reports"
        subtitle={<span>Generate and download service reports</span>}
        actions={
          hasReport ? (
            <>
              <Button variant="outline" size="sm" onClick={handleEmailReport} disabled={!reportData || isLoading} data-testid="button-email-report">
                <Mail className="w-4 h-4 mr-1.5" /> Email
              </Button>
              <Button variant="outline" size="sm" onClick={handleCSVDownload} disabled={!reportData || isLoading} data-testid="button-download-csv">
                <Download className="w-4 h-4 mr-1.5" /> CSV
              </Button>
              <Button size="sm" onClick={handlePDFDownload} disabled={!reportData || isLoading} data-testid="button-download-pdf">
                <FileText className="w-4 h-4 mr-1.5" /> PDF
              </Button>
            </>
          ) : null
        }
      />

      {/* Section 1: Report Catalog */}
      <div>
        <h2 className="text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground mb-3">Report Catalog</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleCatalog.map(item => {
            const Icon = item.icon;
            const selected = reportType === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => handleSelectReport(item.value)}
                data-testid={`report-card-${item.value}`}
                className={`text-left bg-card rounded-xl border p-5 cursor-pointer transition-all duration-200 ${
                  selected
                    ? "border-[hsl(200,72%,40%)] shadow-md ring-2 ring-[hsl(200,72%,40%)]/20"
                    : "border-border/50 hover:shadow-md hover:border-[hsl(200,72%,40%)]/30"
                }`}
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[hsl(200,72%,40%)]/10 mb-3">
                  <Icon className="w-5 h-5 text-[hsl(200,72%,40%)]" />
                </div>
                <h3 className="text-base font-semibold text-foreground">{item.label}</h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{item.description}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-3">
                  Available to: {item.access}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 2: Date Range + Filters + Generate */}
      {reportType && (
        <div className="bg-card rounded-xl border border-border/50 p-4 mb-5 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">From</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setGenerated(false); }}
              className="w-[160px]"
              data-testid="input-date-from"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">To</label>
            <Input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setGenerated(false); }}
              className="w-[160px]"
              data-testid="input-date-to"
            />
          </div>

          {(reportType === "manufacturer-summary" || reportType === "claim-status" || reportType === "product-failure") && (
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground whitespace-nowrap">
                Manufacturer{reportType === "manufacturer-summary" ? " *" : ""}
              </label>
              <Select
                value={manufacturer || "__all__"}
                onValueChange={v => { setManufacturer(v === "__all__" ? "" : v); setGenerated(false); }}
              >
                <SelectTrigger className="w-[200px]" data-testid="select-manufacturer">
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
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground whitespace-nowrap">Customer *</label>
              <Select
                value={customer || "__none__"}
                onValueChange={v => { setCustomer(v === "__none__" ? "" : v); setGenerated(false); }}
              >
                <SelectTrigger className="w-[240px]" data-testid="select-customer">
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
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground whitespace-nowrap">Claim Status</label>
              <Select
                value={claimStatusFilter}
                onValueChange={v => { setClaimStatusFilter(v); setGenerated(false); }}
              >
                <SelectTrigger className="w-[200px]" data-testid="select-claim-status">
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
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground whitespace-nowrap">Min Occurrences</label>
              <Input
                type="number"
                min={1}
                value={minCount}
                onChange={e => { setMinCount(e.target.value); setGenerated(false); }}
                className="w-[100px]"
                data-testid="input-min-count"
              />
            </div>
          )}

          <div className="ml-auto">
            <Button
              onClick={handleGenerate}
              disabled={!canFetch}
              className="bg-[hsl(200,72%,40%)] hover:bg-[hsl(200,72%,35%)] text-white px-6 py-2 rounded-lg font-medium"
              data-testid="button-generate-report"
            >
              <Play className="w-4 h-4 mr-1.5" />
              Generate Report
            </Button>
          </div>

          {missingFilterMessage && (
            <p className="text-xs text-amber-600 w-full">{missingFilterMessage}</p>
          )}
        </div>
      )}

      {/* Section 3: Report Output */}
      {reportType && generated && canFetch && (
        <>
          {/* Report Header */}
          {(reportData || isLoading || isFetching) && selectedCatalogItem && (
            <div className="bg-card rounded-xl border border-border/50 p-4 mb-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[hsl(200,72%,40%)]/10">
                    <selectedCatalogItem.icon className="w-5 h-5 text-[hsl(200,72%,40%)]" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{selectedCatalogItem.label}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDateRangeLabel()}
                      {reportData && (
                        <> · {recordCount(reportData, reportType)} record{recordCount(reportData, reportType) === 1 ? "" : "s"}</>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Report body */}
          {(isLoading || isFetching) ? (
            <div className="bg-card rounded-xl border border-border/50 p-4 space-y-3">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : reportData ? (
            <div className="bg-card rounded-xl border border-border/50 p-4 overflow-x-auto">
              {reportType === "manufacturer-summary" && <ManufacturerSummaryPreview data={reportData as ManufacturerSummaryReport} />}
              {reportType === "monthly-expense" && <MonthlyExpensePreview data={reportData as MonthlyExpenseReport} />}
              {reportType === "customer-history" && <CustomerHistoryPreview data={reportData as CustomerHistoryReport} />}
              {reportType === "claim-status" && <ClaimStatusPreview data={reportData as ClaimStatusReport} />}
              {reportType === "product-failure" && <ProductFailurePreview data={reportData as ProductFailureReport} />}
              {reportType === "invoice-aging" && <InvoiceAgingPreview data={reportData as InvoiceAgingReport} />}
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border/50 p-12 text-center">
              <p className="text-sm text-muted-foreground">No data found for this date range</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Preview Components ──────────────────────────────────────────────────────

const thClass = "text-left px-4 py-3 text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground";
const thRightClass = "text-right px-4 py-3 text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground";
const tdClass = "px-4 py-3 text-sm border-b border-border/50";
const tdRightClass = "px-4 py-3 text-sm border-b border-border/50 text-right tabular-nums font-medium";
const trClass = "even:bg-muted/20 hover:bg-muted/40 transition-colors";
const theadClass = "bg-muted/30";

function SummaryGrid({ items }: { items: Array<{ label: string; value: string | number }> }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {items.map(item => (
        <div key={item.label} className="bg-muted/30 rounded-lg p-3 border-l-[3px] border-[hsl(200,72%,40%)]">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
          <p className="text-lg font-bold tabular-nums mt-1">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function ManufacturerSummaryPreview({ data }: { data: ManufacturerSummaryReport }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">{data.manufacturer}</h3>

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
          <thead className={theadClass}>
            <tr>
              <th className={thClass}>Date</th>
              <th className={thClass}>Customer</th>
              <th className={thClass}>Site</th>
              <th className={thClass}>Model</th>
              <th className={thClass}>Serial</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Claim</th>
              <th className={thClass}>Claim #</th>
              <th className={thRightClass}>Parts</th>
              <th className={thRightClass}>Labor</th>
              <th className={thRightClass}>Claim $</th>
            </tr>
          </thead>
          <tbody>
            {data.calls.map(c => (
              <tr key={c.id} className={trClass}>
                <td className={`${tdClass} whitespace-nowrap`}>{formatDate(c.callDate)}</td>
                <td className={tdClass}>{c.customerName}</td>
                <td className={tdClass}>{c.jobSiteName}</td>
                <td className={`${tdClass} font-mono text-xs`}>{c.productModel}</td>
                <td className={`${tdClass} font-mono text-xs`}>{c.productSerial || "—"}</td>
                <td className={tdClass}>{c.status}</td>
                <td className={tdClass}>{c.claimStatus}</td>
                <td className={tdClass}>{c.claimNumber || "—"}</td>
                <td className={tdRightClass}>{fmt$(c.partsCost)}</td>
                <td className={tdRightClass}>{fmt$(c.laborCost)}</td>
                <td className={tdRightClass}>{fmt$(c.claimAmount)}</td>
              </tr>
            ))}
            <tr className="bg-muted/40 font-semibold">
              <td colSpan={8} className="px-4 py-3 text-sm text-right">Totals:</td>
              <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt$(data.summary.totalPartsCost)}</td>
              <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt$(data.summary.totalLaborCost)}</td>
              <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt$(data.summary.totalClaimAmount)}</td>
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
          <thead className={theadClass}>
            <tr>
              <th className={thClass}>Month</th>
              <th className={thRightClass}>Calls</th>
              <th className={thRightClass}>Hours</th>
              <th className={thRightClass}>Miles</th>
              <th className={thRightClass}>Mileage $</th>
              <th className={thRightClass}>Parts</th>
              <th className={thRightClass}>Labor</th>
              <th className={thRightClass}>Other</th>
              <th className={thRightClass}>Total</th>
              <th className={thRightClass}>Claim $</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map(m => (
              <tr key={m.month} className={trClass}>
                <td className={tdClass}>{monthLabel(m.month)}</td>
                <td className={tdRightClass}>{m.calls}</td>
                <td className={tdRightClass}>{m.hours}</td>
                <td className={tdRightClass}>{m.miles}</td>
                <td className={tdRightClass}>{fmt$(m.mileageCost)}</td>
                <td className={tdRightClass}>{fmt$(m.partsCost)}</td>
                <td className={tdRightClass}>{fmt$(m.laborCost)}</td>
                <td className={tdRightClass}>{fmt$(m.otherCost)}</td>
                <td className={tdRightClass}>{fmt$(m.totalCosts)}</td>
                <td className={tdRightClass}>{fmt$(m.claimAmount)}</td>
              </tr>
            ))}
            <tr className="bg-muted/40 font-semibold">
              <td className="px-4 py-3 text-sm">Grand Total</td>
              <td className="px-4 py-3 text-sm text-right tabular-nums">{data.months.reduce((s, m) => s + m.calls, 0)}</td>
              <td className="px-4 py-3 text-sm text-right tabular-nums">{data.summary.totalHours}</td>
              <td className="px-4 py-3 text-sm text-right tabular-nums">{data.summary.totalMiles}</td>
              <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt$(data.summary.totalMileageCost)}</td>
              <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt$(data.summary.totalPartsCost)}</td>
              <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt$(data.summary.totalLaborCost)}</td>
              <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt$(data.summary.totalOtherCost)}</td>
              <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt$(data.summary.totalCosts)}</td>
              <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt$(data.summary.totalClaimAmount)}</td>
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
          <thead className={theadClass}>
            <tr>
              <th className={thClass}>Date</th>
              <th className={thClass}>Site</th>
              <th className={thClass}>Manufacturer</th>
              <th className={thClass}>Model</th>
              <th className={thClass}>Serial</th>
              <th className={thClass}>Issue</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Claim</th>
              <th className={thRightClass}>Claim $</th>
            </tr>
          </thead>
          <tbody>
            {data.calls.map(c => (
              <tr key={c.id} className={trClass}>
                <td className={`${tdClass} whitespace-nowrap`}>{formatDate(c.callDate)}</td>
                <td className={tdClass}>{c.jobSiteName}</td>
                <td className={tdClass}>{c.manufacturer}</td>
                <td className={`${tdClass} font-mono text-xs`}>{c.productModel}</td>
                <td className={`${tdClass} font-mono text-xs`}>{c.productSerial || "—"}</td>
                <td className={`${tdClass} max-w-[200px] truncate`}>{truncate(c.issueDescription, 60)}</td>
                <td className={tdClass}>{c.status}</td>
                <td className={tdClass}>{c.claimStatus}</td>
                <td className={tdRightClass}>{fmt$(c.claimAmount)}</td>
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
      {/* Status summary badges */}
      <div className="flex flex-wrap gap-3 mb-4">
        {Object.entries(data.statusCounts).map(([status, info]) => (
          <div key={status} className="bg-muted/30 rounded-lg px-3 py-2 border-l-[3px] border-[hsl(200,72%,40%)]">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{status}</p>
            <p className="text-sm font-bold tabular-nums mt-0.5">{info.count} calls · {fmt$(info.amount)}</p>
          </div>
        ))}
      </div>

      {data.calls.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No claims found.</p>
      ) : (
        <table className="w-full text-sm" data-testid="report-table">
          <thead className={theadClass}>
            <tr>
              <th className={thClass}>Call #</th>
              <th className={thClass}>Date</th>
              <th className={thClass}>Customer</th>
              <th className={thClass}>Manufacturer</th>
              <th className={thClass}>Model</th>
              <th className={thClass}>Claim #</th>
              <th className={thClass}>Status</th>
              <th className={thRightClass}>Amount</th>
              <th className={thRightClass}>Days</th>
            </tr>
          </thead>
          <tbody>
            {data.calls.map(c => (
              <tr key={c.id} className={trClass}>
                <td className={tdClass}>#{c.id}</td>
                <td className={`${tdClass} whitespace-nowrap`}>{formatDate(c.callDate)}</td>
                <td className={tdClass}>{c.customerName}</td>
                <td className={tdClass}>{c.manufacturer}</td>
                <td className={`${tdClass} font-mono text-xs`}>{c.productModel}</td>
                <td className={tdClass}>{c.claimNumber || "—"}</td>
                <td className={tdClass}>{c.claimStatus}</td>
                <td className={tdRightClass}>{fmt$(c.claimAmount)}</td>
                <td className={tdRightClass}>{c.daysPending}</td>
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
      <p className="text-xs text-muted-foreground mb-3">
        Min {data.minCount} occurrences
      </p>

      {data.models.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No models with {data.minCount}+ service calls found.</p>
      ) : (
        <table className="w-full text-sm" data-testid="report-table">
          <thead className={theadClass}>
            <tr>
              <th className={thClass}>Manufacturer</th>
              <th className={thClass}>Model</th>
              <th className={thRightClass}>Calls</th>
              <th className={thRightClass}>Serials</th>
              <th className={thRightClass}>Customers</th>
              <th className={thClass}>Last Service</th>
              <th className={thClass}>Common Issues</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((m, i) => (
              <tr key={i} className={trClass}>
                <td className={tdClass}>{m.manufacturer}</td>
                <td className={`${tdClass} font-mono text-xs`}>{m.model}</td>
                <td className={`${tdRightClass} font-bold`}>{m.count}</td>
                <td className={tdRightClass}>{m.uniqueSerials}</td>
                <td className={tdRightClass}>{m.uniqueCustomers}</td>
                <td className={`${tdClass} whitespace-nowrap`}>{formatDate(m.lastServiceDate)}</td>
                <td className={`${tdClass} max-w-[300px]`}>
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

function InvoiceAgingPreview({ data }: { data: InvoiceAgingReport }) {
  const [sortAsc, setSortAsc] = useState(false);
  const sorted = [...data.invoices].sort((a, b) => sortAsc ? a.daysOutstanding - b.daysOutstanding : b.daysOutstanding - a.daysOutstanding);

  const bucketColors: Record<string, string> = {
    current: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    "31-60": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    "61-90": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    "90+": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  const bucketLabels: Record<string, string> = {
    current: "0-30 days",
    "31-60": "31-60 days",
    "61-90": "61-90 days",
    "90+": "90+ days",
  };

  return (
    <div>
      {/* Aging buckets styled as KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="bg-card rounded-lg p-3 border border-border/50 border-l-[3px] border-l-emerald-500">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current (0-30)</p>
          <p className="text-lg font-bold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">{fmt$(data.summary.current)}</p>
        </div>
        <div className="bg-card rounded-lg p-3 border border-border/50 border-l-[3px] border-l-amber-500">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">31-60 days</p>
          <p className="text-lg font-bold tabular-nums mt-1 text-amber-700 dark:text-amber-400">{fmt$(data.summary.days31to60)}</p>
        </div>
        <div className="bg-card rounded-lg p-3 border border-border/50 border-l-[3px] border-l-orange-500">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">61-90 days</p>
          <p className="text-lg font-bold tabular-nums mt-1 text-orange-700 dark:text-orange-400">{fmt$(data.summary.days61to90)}</p>
        </div>
        <div className="bg-card rounded-lg p-3 border border-border/50 border-l-[3px] border-l-red-500">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">90+ days</p>
          <p className="text-lg font-bold tabular-nums mt-1 text-red-700 dark:text-red-400">{fmt$(data.summary.over90)}</p>
        </div>
        <div className="bg-card rounded-lg p-3 border border-border/50 border-l-[3px] border-l-[hsl(200,72%,40%)]">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Outstanding</p>
          <p className="text-lg font-bold tabular-nums mt-1">{fmt$(data.summary.totalOutstanding)}</p>
        </div>
      </div>

      {data.invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No outstanding invoices.</p>
      ) : (
        <table className="w-full text-sm" data-testid="report-table">
          <thead className={theadClass}>
            <tr>
              <th className={thClass}>Invoice #</th>
              <th className={thClass}>Customer</th>
              <th className={thClass}>Issue Date</th>
              <th className={thClass}>Due Date</th>
              <th className={thRightClass}>Amount</th>
              <th className={`${thRightClass} cursor-pointer hover:text-foreground`} onClick={() => setSortAsc(!sortAsc)}>
                Days {sortAsc ? "\u2191" : "\u2193"}
              </th>
              <th className={thClass}>Aging</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(inv => (
              <tr key={inv.id} className={`${trClass} cursor-pointer`} onClick={() => { window.location.hash = `/invoices/${inv.id}`; }}>
                <td className={`${tdClass} font-mono font-medium`}>{inv.invoiceNumber}</td>
                <td className={tdClass}>{inv.billToName}</td>
                <td className={`${tdClass} whitespace-nowrap`}>{formatDate(inv.issueDate)}</td>
                <td className={`${tdClass} whitespace-nowrap`}>{formatDate(inv.dueDate)}</td>
                <td className={tdRightClass}>{fmt$(inv.total)}</td>
                <td className={tdRightClass}>{inv.daysOutstanding}</td>
                <td className={tdClass}>
                  <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full ${bucketColors[inv.bucket] || ""}`}>
                    {bucketLabels[inv.bucket] || inv.bucket}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
