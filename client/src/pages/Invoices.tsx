import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, FileText, DollarSign, Clock, CheckCircle } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InvoiceListItem {
  id: number;
  invoiceNumber: string;
  billToType: string;
  billToName: string;
  billToCity: string | null;
  billToState: string | null;
  issueDate: string;
  dueDate: string | null;
  paymentTerms: string | null;
  status: string;
  total: string;
  paidDate: string | null;
  serviceCallId: number | null;
  itemCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  "Draft":   "text-slate-600 bg-slate-100 border-slate-300 dark:text-slate-300 dark:bg-slate-800 dark:border-slate-600",
  "Sent":    "text-sky-600 bg-sky-50 border-sky-200 dark:text-sky-300 dark:bg-sky-900/20 dark:border-sky-700",
  "Paid":    "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-700",
  "Overdue": "text-red-600 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-900/20 dark:border-red-700",
};

function fmt$(amount: string | null | undefined): string {
  const n = parseFloat(amount || "0");
  return isNaN(n) ? "$0.00" : `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

function isOverdue(invoice: InvoiceListItem): boolean {
  if (invoice.status === "Paid" || invoice.status === "Draft") return false;
  if (!invoice.dueDate) return false;
  return new Date(invoice.dueDate) < new Date();
}

export default function Invoices() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [typeFilter, setTypeFilter] = useState("__all__");

  const params = new URLSearchParams();
  if (statusFilter !== "__all__") params.set("status", statusFilter);
  if (typeFilter !== "__all__") params.set("billToType", typeFilter);
  if (search.trim()) params.set("search", search.trim());

  const { data: invoices = [], isLoading } = useQuery<InvoiceListItem[]>({
    queryKey: ["/api/invoices", statusFilter, typeFilter, search],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/invoices?${params.toString()}`);
      return r.json();
    },
  });

  // Auto-mark overdue invoices
  const overdueMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/invoices/${id}`, { status: "Overdue" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/invoices"] }),
  });

  // KPI calculations
  const totalOutstanding = invoices
    .filter(i => i.status === "Sent" || i.status === "Overdue")
    .reduce((s, i) => s + parseFloat(i.total || "0"), 0);
  const totalPaid = invoices
    .filter(i => i.status === "Paid")
    .reduce((s, i) => s + parseFloat(i.total || "0"), 0);
  const overdueCount = invoices.filter(isOverdue).length;
  const draftCount = invoices.filter(i => i.status === "Draft").length;

  const kpis = [
    { label: "Outstanding", value: fmt$(String(totalOutstanding)), icon: DollarSign, color: "text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800" },
    { label: "Paid (This Set)", value: fmt$(String(totalPaid)), icon: CheckCircle, color: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800" },
    { label: "Overdue", value: String(overdueCount), icon: Clock, color: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800" },
    { label: "Drafts", value: String(draftCount), icon: FileText, color: "text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700" },
  ];

  return (
    <main className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">{invoices.length} invoice{invoices.length !== 1 ? "s" : ""}</p>
        </div>
        <Link href="/invoices/new">
          <Button className="bg-[hsl(200,72%,40%)] hover:bg-[hsl(200,72%,35%)]">
            <Plus className="w-4 h-4 mr-1" /> New Invoice
          </Button>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="bg-card rounded-lg border p-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">{k.label}</p>
                <p className="text-2xl font-bold mt-1">{k.value}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${k.color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-card rounded-lg border p-3 flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by invoice # or name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Statuses</SelectItem>
            <SelectItem value="Draft">Draft</SelectItem>
            <SelectItem value="Sent">Sent</SelectItem>
            <SelectItem value="Paid">Paid</SelectItem>
            <SelectItem value="Overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Types</SelectItem>
            <SelectItem value="contractor">Contractor</SelectItem>
            <SelectItem value="manufacturer">Manufacturer</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Invoice List */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading invoices...</div>
      ) : invoices.length === 0 ? (
        <div className="bg-card rounded-lg border p-12 text-center">
          <FileText className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-medium">No invoices yet</p>
          <p className="text-sm text-muted-foreground mt-1">Create your first invoice using the button above.</p>
        </div>
      ) : (
        <div className="bg-card rounded-lg border overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {["INVOICE #", "BILL TO", "TYPE", "ISSUE DATE", "DUE DATE", "TOTAL", "STATUS", ""].map(h => (
                    <th key={h} className="text-left p-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const overdue = isOverdue(inv);
                  const displayStatus = overdue && inv.status !== "Overdue" ? "Overdue" : inv.status;
                  return (
                    <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="p-3 font-mono text-sm font-medium text-[hsl(200,72%,40%)]">
                        <Link href={`/invoices/${inv.id}`}>{inv.invoiceNumber}</Link>
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{inv.billToName}</div>
                        {(inv.billToCity || inv.billToState) && (
                          <div className="text-xs text-muted-foreground">{[inv.billToCity, inv.billToState].filter(Boolean).join(", ")}</div>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="text-xs capitalize text-muted-foreground">{inv.billToType}</span>
                      </td>
                      <td className="p-3 text-muted-foreground">{formatDate(inv.issueDate)}</td>
                      <td className="p-3 text-muted-foreground">{formatDate(inv.dueDate)}</td>
                      <td className="p-3 font-medium">{fmt$(inv.total)}</td>
                      <td className="p-3">
                        <Badge variant="outline" className={`text-xs ${STATUS_STYLES[displayStatus] || STATUS_STYLES["Draft"]}`}>
                          {displayStatus}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Link href={`/invoices/${inv.id}`}>
                          <Button variant="ghost" size="sm">View</Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y">
            {invoices.map(inv => {
              const overdue = isOverdue(inv);
              const displayStatus = overdue && inv.status !== "Overdue" ? "Overdue" : inv.status;
              return (
                <Link key={inv.id} href={`/invoices/${inv.id}`}>
                  <div className="p-4 hover:bg-muted/20 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium text-[hsl(200,72%,40%)]">{inv.invoiceNumber}</span>
                        <Badge variant="outline" className={`text-xs ${STATUS_STYLES[displayStatus]}`}>{displayStatus}</Badge>
                      </div>
                      <div className="font-medium mt-0.5">{inv.billToName}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(inv.issueDate)} · {inv.billToType}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{fmt$(inv.total)}</div>
                      <div className="text-xs text-muted-foreground">Due {formatDate(inv.dueDate)}</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
