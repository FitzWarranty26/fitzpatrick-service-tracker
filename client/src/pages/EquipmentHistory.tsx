import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { getWarrantyStatus } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, ChevronDown, ChevronUp, FileText, Package, MapPin, Wrench, Clock, Car,
  Shield, ShieldAlert, ShieldQuestion,
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
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
        <ShieldQuestion className="w-3 h-3" /> Unknown
      </span>
    );
  }
  if (warranty.status === "in-warranty") {
    const expDate = warranty.expiresDate ? new Date(warranty.expiresDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <Shield className="w-3 h-3" /> In Warranty {expDate && `(exp ${expDate})`}
      </span>
    );
  }
  const expDate = warranty.expiresDate ? new Date(warranty.expiresDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
      <ShieldAlert className="w-3 h-3" /> Out of Warranty {expDate && `(${expDate})`}
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
    .header { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 16px; border-bottom: 3px solid #1d4ed8; margin-bottom: 20px; }
    .report-title { font-size: 14pt; font-weight: 700; color: #1d4ed8; }
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
  <div class="footer">&copy; ${new Date().getFullYear()} Fitzpatrick Warranty Service, LLC. All rights reserved.</div>
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

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto pb-24 md:pb-6">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold">Equipment History</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Search by serial number, address, or customer name</p>
      </div>

      {/* Search Bar */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search serial number, address, or customer..."
          className="pl-12 h-12 text-base"
          data-testid="equipment-search"
        />
      </div>

      {/* Results */}
      {isLoading && debouncedSearch.length >= 2 ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : !results || results.length === 0 ? (
        debouncedSearch.length >= 2 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Package className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-base font-semibold text-foreground mb-1">No equipment found</p>
            <p className="text-sm text-muted-foreground">Try a different search term.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-base font-semibold text-foreground mb-1">Search for equipment</p>
            <p className="text-sm text-muted-foreground">Enter a serial number, address, or customer name to see service history.</p>
          </div>
        )
      ) : (
        <div className="space-y-3">
          {results.map(result => {
            const key = getKey(result);
            const isExpanded = expandedKey === key;
            return (
              <Card key={key} className="overflow-hidden" data-testid={`equipment-result-${result.serialNumber || "no-serial"}`}>
                <CardContent className="p-0">
                  {/* Summary row */}
                  <div
                    className="flex items-start justify-between gap-3 p-4 cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => setExpandedKey(isExpanded ? null : key)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {result.serialNumber && (
                          <span className="font-mono text-sm font-bold text-foreground">{result.serialNumber}</span>
                        )}
                        <span className="text-xs text-muted-foreground">{result.manufacturer}</span>
                        {result.productModel && (
                          <span className="font-mono text-xs text-muted-foreground">{result.productModel}</span>
                        )}
                        {result.productType && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{result.productType}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span>{result.address}, {result.city}, {result.state}{result.zip ? ` ${result.zip}` : ""}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{result.customerName}</span>
                        <span>{result.totalCalls} call{result.totalCalls !== 1 ? "s" : ""}</span>
                        <span>{formatDate(result.firstCallDate)}{result.firstCallDate !== result.lastCallDate ? ` — ${formatDate(result.lastCallDate)}` : ""}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <WarrantyIndicator installationDate={result.installationDate} manufacturer={result.manufacturer} productType={result.productType} />
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-border p-4 bg-muted/20">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold">Service History</h4>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={(e) => { e.stopPropagation(); generateEquipmentPDF(result); }}
                          data-testid="button-download-equipment-pdf"
                        >
                          <FileText className="w-3.5 h-3.5 mr-1" /> Download PDF
                        </Button>
                      </div>
                      <div className="space-y-3">
                        {result.calls.map(call => (
                          <div
                            key={call.id}
                            className="rounded-lg border border-border bg-card p-3 hover:border-primary/30 cursor-pointer transition-colors"
                            onClick={() => { window.location.hash = `/calls/${call.id}`; }}
                            data-testid={`equipment-call-${call.id}`}
                          >
                            <div className="flex items-center gap-2 flex-wrap mb-1.5">
                              <span className="text-xs font-medium text-muted-foreground">{formatDate(call.callDate)}</span>
                              <StatusBadge status={call.status} />
                              {call.visitCount > 1 && (
                                <span className="text-[10px] text-muted-foreground">{call.visitCount} visits</span>
                              )}
                              {(call.hoursOnJob || call.milesTraveled) && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                  {call.hoursOnJob && <><Clock className="w-2.5 h-2.5" />{call.hoursOnJob}h</>}
                                  {call.milesTraveled && <><Car className="w-2.5 h-2.5 ml-1" />{call.milesTraveled}mi</>}
                                </span>
                              )}
                            </div>
                            {call.issueDescription && (
                              <p className="text-xs text-foreground mb-0.5"><span className="text-muted-foreground">Issue:</span> {call.issueDescription.substring(0, 200)}</p>
                            )}
                            {call.diagnosis && (
                              <p className="text-xs text-foreground mb-0.5"><span className="text-muted-foreground">Diagnosis:</span> {call.diagnosis.substring(0, 200)}</p>
                            )}
                            {call.resolution && (
                              <p className="text-xs text-foreground mb-0.5"><span className="text-muted-foreground">Resolution:</span> {call.resolution.substring(0, 200)}</p>
                            )}
                            {call.techNotes && (
                              <p className="text-xs text-foreground"><span className="text-muted-foreground">Notes:</span> {call.techNotes.substring(0, 200)}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
