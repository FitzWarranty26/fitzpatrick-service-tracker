import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { getWarrantyStatus } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, ChevronDown, ChevronUp, FileText, Package, MapPin, Wrench, Clock, Car,
  Shield, ShieldAlert, ShieldQuestion, Hash, User, Calendar, ArrowRight,
} from "lucide-react";

interface EquipmentCall {
  id: number;
  callDate: string;
  status: string;
  issueDescription: string;
  diagnosis: string;
  resolution: string;
  techNotes: string;
  hoursOnJob: string;
  milesTraveled: string;
  visitCount: number;
}

interface EquipmentResult {
  serialNumber: string;
  manufacturer: string;
  productModel: string;
  productType: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  customerName: string;
  installationDate: string | null;
  totalCalls: number;
  firstCallDate: string;
  lastCallDate: string;
  calls: EquipmentCall[];
}

function WarrantyIndicator({ installationDate, manufacturer, productType }: {
  installationDate: string | null | undefined;
  manufacturer: string;
  productType?: string | null;
}) {
  const warranty = getWarrantyStatus(installationDate, manufacturer, productType);

  if (warranty.status === "unknown") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
        <ShieldQuestion className="w-3.5 h-3.5" /> Unknown
      </span>
    );
  }
  if (warranty.status === "in-warranty") {
    const expDate = warranty.expiresDate ? new Date(warranty.expiresDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <Shield className="w-3.5 h-3.5" /> In Warranty {expDate && `(exp ${expDate})`}
      </span>
    );
  }
  const expDate = warranty.expiresDate ? new Date(warranty.expiresDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
      <ShieldAlert className="w-3.5 h-3.5" /> Out of Warranty {expDate && `(${expDate})`}
    </span>
  );
}

function generateEquipmentPDF(result: EquipmentResult) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const warranty = getWarrantyStatus(result.installationDate, result.manufacturer, result.productType);

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Equipment History - ${esc(result.serialNumber || "N/A")}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #1e293b; background: white; line-height: 1.5; }
    .page { max-width: 900px; margin: 0 auto; padding: 30px; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 16px; border-bottom: 3px solid #1a7fad; margin-bottom: 20px; }
    .report-title { font-size: 14pt; font-weight: 700; color: #1a7fad; }
    .report-meta { font-size: 9pt; color: #64748b; margin-top: 2px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 20px; padding: 16px; background: #f8fafc; border-radius: 8px; }
    .info-label { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .info-value { font-size: 10pt; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 16px; }
    th { text-align: left; padding: 8px 12px; background: #f1f5f9; border-bottom: 2px solid #e2e8f0; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
    td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    .mono { font-family: monospace; }
    .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 8pt; color: #94a3b8; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body><div class="page">
  <div class="header">
    <div>
      <div class="report-title">Equipment Service History</div>
      <div class="report-meta">Fitzpatrick Warranty Service, LLC</div>
    </div>
    <div class="report-meta">Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
  </div>
  <div class="info-grid">
    <div><div class="info-label">Serial Number</div><div class="info-value mono">${esc(result.serialNumber || "N/A")}</div></div>
    <div><div class="info-label">Manufacturer</div><div class="info-value">${esc(result.manufacturer)}</div></div>
    <div><div class="info-label">Model</div><div class="info-value mono">${esc(result.productModel)}</div></div>
    <div><div class="info-label">Product Type</div><div class="info-value">${esc(result.productType || "N/A")}</div></div>
    <div><div class="info-label">Address</div><div class="info-value">${esc(result.address)}, ${esc(result.city)}, ${esc(result.state)} ${esc(result.zip)}</div></div>
    <div><div class="info-label">Customer</div><div class="info-value">${esc(result.customerName)}</div></div>
    <div><div class="info-label">Installation Date</div><div class="info-value">${result.installationDate ? new Date(result.installationDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "Unknown"}</div></div>
    <div><div class="info-label">Warranty Status</div><div class="info-value">${warranty.status === "in-warranty" ? "In Warranty" : warranty.status === "out-of-warranty" ? "Out of Warranty" : "Unknown"}</div></div>
  </div>
  <h3 style="font-size: 11pt; margin-bottom: 4px;">Service Timeline (${result.totalCalls} call${result.totalCalls !== 1 ? "s" : ""})</h3>
  <table><thead><tr><th>Date</th><th>Status</th><th>Issue</th><th>Diagnosis</th><th>Resolution</th><th>Hours</th></tr></thead><tbody>`;

  for (const c of result.calls) {
    html += `<tr>
      <td style="white-space:nowrap">${new Date(c.callDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
      <td>${esc(c.status)}</td>
      <td>${esc(c.issueDescription).substring(0, 120)}</td>
      <td>${esc(c.diagnosis).substring(0, 120)}</td>
      <td>${esc(c.resolution).substring(0, 120)}</td>
      <td>${c.hoursOnJob || "—"}</td>
    </tr>`;
  }

  html += `</tbody></table>
  <div class="footer">&copy; Copyright Fitzpatrick Warranty Service, LLC. 2026</div>
  </div></body></html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

export default function EquipmentHistory() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (timer) clearTimeout(timer);
    const t = setTimeout(() => setDebouncedSearch(value), 300);
    setTimer(t);
  };

  const { data: results, isLoading } = useQuery<EquipmentResult[]>({
    queryKey: ["/api/equipment/search", debouncedSearch],
    queryFn: async () => {
      if (debouncedSearch.length < 2) return [];
      const res = await apiRequest("GET", `/api/equipment/search?q=${encodeURIComponent(debouncedSearch)}`);
      return res.json();
    },
    enabled: debouncedSearch.length >= 2,
  });

  const getKey = (r: EquipmentResult) => `${r.serialNumber}||${r.address}`;

  // Compute aggregate stats from results
  const stats = results && results.length > 0 ? {
    totalEquipment: results.length,
    totalServiceCalls: results.reduce((sum, r) => sum + r.totalCalls, 0),
    inWarranty: results.filter(r => getWarrantyStatus(r.installationDate, r.manufacturer, r.productType).status === "in-warranty").length,
    outOfWarranty: results.filter(r => getWarrantyStatus(r.installationDate, r.manufacturer, r.productType).status === "out-of-warranty").length,
  } : null;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-24 md:pb-6">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Equipment History</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Look up any unit by serial number, address, or customer — view full service timelines and warranty status
        </p>
      </div>

      {/* ── Search Bar ───────────────────────────────────────────────────── */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search serial number, address, or customer…"
          className="bg-card rounded-xl border border-border/50 pl-12 pr-4 py-3.5 h-auto text-base shadow-sm focus:shadow-md transition-shadow"
          data-testid="equipment-search"
        />
      </div>

      {/* ── Result Stats Strip ───────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="rounded-xl border border-border/50 bg-card p-4 border-l-[3px] border-l-[#1a7fad] transition-all hover:shadow-md">
            <p className="text-2xl font-bold tabular-nums leading-none text-[#1a7fad]">{stats.totalEquipment}</p>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-2">Units Found</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-4 border-l-[3px] border-l-amber-500 transition-all hover:shadow-md">
            <p className="text-2xl font-bold tabular-nums leading-none text-amber-600 dark:text-amber-400">{stats.totalServiceCalls}</p>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-2">Service Calls</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-4 border-l-[3px] border-l-green-500 transition-all hover:shadow-md">
            <p className="text-2xl font-bold tabular-nums leading-none text-green-600 dark:text-green-400">{stats.inWarranty}</p>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-2">In Warranty</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-4 border-l-[3px] border-l-red-500 transition-all hover:shadow-md">
            <p className="text-2xl font-bold tabular-nums leading-none text-red-600 dark:text-red-400">{stats.outOfWarranty}</p>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-2">Out of Warranty</p>
          </div>
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {isLoading && debouncedSearch.length >= 2 ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : !results || results.length === 0 ? (
        debouncedSearch.length >= 2 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-card rounded-xl border border-border/50">
            <Package className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-base font-semibold text-foreground mb-1">No equipment found</p>
            <p className="text-sm text-muted-foreground">Try a different serial number, address, or customer name.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-card rounded-xl border border-border/50">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
              <Search className="w-8 h-8 text-primary/60" />
            </div>
            <p className="text-lg font-semibold text-foreground mb-1">Search for equipment</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Enter a serial number, address, or customer name to look up service history and warranty status.
            </p>
          </div>
        )
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1">
            {results.length} Result{results.length !== 1 ? "s" : ""}
          </p>
          {results.map(result => {
            const key = getKey(result);
            const isExpanded = expandedKey === key;
            return (
              <div
                key={key}
                className={`bg-card rounded-xl border overflow-hidden transition-all duration-200 hover:shadow-md ${isExpanded ? "border-primary/30 shadow-md" : "border-border/50"}`}
                data-testid={`equipment-result-${result.serialNumber || "no-serial"}`}
              >
                {/* Summary row */}
                <div
                  className="flex items-start justify-between gap-4 p-4 md:p-5 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedKey(isExpanded ? null : key)}
                >
                  <div className="flex-1 min-w-0">
                    {/* Top line: Serial + Manufacturer + Model */}
                    <div className="flex items-center gap-2.5 flex-wrap mb-2">
                      {result.serialNumber && (
                        <span className="inline-flex items-center gap-1.5 font-mono text-sm font-bold text-foreground">
                          <Hash className="w-3.5 h-3.5 text-primary/60" />
                          {result.serialNumber}
                        </span>
                      )}
                      <span className="text-xs font-medium text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">{result.manufacturer}</span>
                      {result.productModel && (
                        <span className="font-mono text-xs text-muted-foreground">{result.productModel}</span>
                      )}
                      {result.productType && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{result.productType}</span>
                      )}
                    </div>

                    {/* Info grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5 md:gap-4">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/60" />
                        <span className="truncate">{result.address}, {result.city}, {result.state}{result.zip ? ` ${result.zip}` : ""}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <User className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/60" />
                        <span className="font-medium text-foreground">{result.customerName}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Wrench className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/60" />
                        <span>
                          {result.totalCalls} call{result.totalCalls !== 1 ? "s" : ""}
                          <span className="mx-1.5 text-border">·</span>
                          {formatDate(result.firstCallDate)}
                          {result.firstCallDate !== result.lastCallDate && (
                            <> — {formatDate(result.lastCallDate)}</>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0 pt-0.5">
                    <WarrantyIndicator installationDate={result.installationDate} manufacturer={result.manufacturer} productType={result.productType} />
                    <div className="w-7 h-7 rounded-lg bg-muted/50 flex items-center justify-center">
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border/50 bg-muted/10">
                    {/* Installation + warranty summary bar */}
                    {result.installationDate && (
                      <div className="flex items-center gap-4 px-4 md:px-5 py-3 border-b border-border/30 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5" />
                          Installed {new Date(result.installationDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                        </span>
                      </div>
                    )}

                    <div className="p-4 md:p-5">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                          Service Timeline
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs rounded-lg"
                          onClick={(e) => { e.stopPropagation(); generateEquipmentPDF(result); }}
                          data-testid="button-download-equipment-pdf"
                        >
                          <FileText className="w-3.5 h-3.5 mr-1.5" /> Export PDF
                        </Button>
                      </div>

                      {/* Desktop: Table view */}
                      <div className="hidden md:block bg-card rounded-xl border border-border/50 overflow-hidden">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-muted/30 border-b border-border/50">
                              <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-4 py-2.5">Date</th>
                              <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-4 py-2.5">Status</th>
                              <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-4 py-2.5">Issue</th>
                              <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-4 py-2.5">Resolution</th>
                              <th className="text-right text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-4 py-2.5">Hours / Miles</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.calls.map(call => (
                              <tr
                                key={call.id}
                                className="text-sm hover:bg-muted/40 transition-colors cursor-pointer border-b border-border/30 last:border-0"
                                onClick={() => { window.location.hash = `/calls/${call.id}`; }}
                                data-testid={`equipment-call-${call.id}`}
                              >
                                <td className="px-4 py-3 text-xs font-medium text-foreground whitespace-nowrap">
                                  {formatDate(call.callDate)}
                                </td>
                                <td className="px-4 py-3">
                                  <StatusBadge status={call.status} />
                                </td>
                                <td className="px-4 py-3 text-xs text-muted-foreground max-w-[250px] truncate">
                                  {call.issueDescription || "—"}
                                </td>
                                <td className="px-4 py-3 text-xs text-muted-foreground max-w-[250px] truncate">
                                  {call.resolution || "—"}
                                </td>
                                <td className="px-4 py-3 text-xs text-muted-foreground text-right whitespace-nowrap">
                                  <span className="inline-flex items-center gap-2">
                                    {call.hoursOnJob && <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{call.hoursOnJob}h</span>}
                                    {call.milesTraveled && <span className="flex items-center gap-0.5"><Car className="w-3 h-3" />{call.milesTraveled}mi</span>}
                                    {!call.hoursOnJob && !call.milesTraveled && "—"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile: Card view */}
                      <div className="md:hidden space-y-2.5">
                        {result.calls.map(call => (
                          <div
                            key={call.id}
                            className="bg-card rounded-xl border border-border/50 p-3.5 cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all"
                            onClick={() => { window.location.hash = `/calls/${call.id}`; }}
                            data-testid={`equipment-call-${call.id}`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-foreground">{formatDate(call.callDate)}</span>
                                <StatusBadge status={call.status} />
                              </div>
                              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40" />
                            </div>
                            {call.visitCount > 1 && (
                              <p className="text-[10px] text-muted-foreground mb-1.5">{call.visitCount} visits</p>
                            )}
                            {call.issueDescription && (
                              <p className="text-xs text-muted-foreground mb-1">
                                <span className="text-foreground font-medium">Issue:</span> {call.issueDescription.substring(0, 150)}
                              </p>
                            )}
                            {call.resolution && (
                              <p className="text-xs text-muted-foreground mb-1">
                                <span className="text-foreground font-medium">Resolution:</span> {call.resolution.substring(0, 150)}
                              </p>
                            )}
                            {(call.hoursOnJob || call.milesTraveled) && (
                              <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30 text-[10px] text-muted-foreground">
                                {call.hoursOnJob && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{call.hoursOnJob} hrs</span>}
                                {call.milesTraveled && <span className="flex items-center gap-1"><Car className="w-3 h-3" />{call.milesTraveled} mi</span>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
