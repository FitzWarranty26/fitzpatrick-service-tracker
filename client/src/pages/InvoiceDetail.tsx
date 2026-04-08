import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, Send, CheckCircle, FileDown, Mail, Pencil } from "lucide-react";
import { generateInvoicePdf } from "@/lib/invoice-pdf";
import { getAuthHeaders } from "@/lib/auth";

interface InvoiceItem {
  id?: number;
  invoiceId?: number;
  type: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  sortOrder?: number;
  visitNumber?: number | null;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  serviceCallId: number | null;
  billToType: string;
  billToName: string;
  billToAddress: string | null;
  billToCity: string | null;
  billToState: string | null;
  billToEmail: string | null;
  billToPhone: string | null;
  issueDate: string;
  dueDate: string | null;
  paymentTerms: string | null;
  status: string;
  notes: string | null;
  subtotal: string;
  total: string;
  paidDate: string | null;
  items: InvoiceItem[];
}

const STATUS_STYLES: Record<string, string> = {
  "Draft":   "text-slate-600 bg-slate-100 border-slate-300 dark:text-slate-300 dark:bg-slate-800 dark:border-slate-600",
  "Sent":    "text-sky-600 bg-sky-50 border-sky-200 dark:text-sky-300 dark:bg-sky-900/20 dark:border-sky-700",
  "Paid":    "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-700",
  "Overdue": "text-red-600 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-900/20 dark:border-red-700",
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  labor: "Labor", parts: "Parts / Materials", travel: "Travel / Mileage", other: "Other",
};

function fmt$(v: string | number | null | undefined): string {
  const n = parseFloat(String(v || "0"));
  return isNaN(n) ? "$0.00" : `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function calcAmount(qty: string, price: string): string {
  const q = parseFloat(qty) || 0;
  const p = parseFloat(price) || 0;
  return (q * p).toFixed(2);
}

export default function InvoiceDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<Partial<Invoice> | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);

  const { data: invoice, isLoading } = useQuery<Invoice>({
    queryKey: ["/api/invoices", id],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/invoices/${id}`);
      return r.json();
    },
  });

  // Fetch visits for the linked service call (for visit grouping)
  const { data: callVisits = [] } = useQuery<any[]>({
    queryKey: ["/api/service-calls", invoice?.serviceCallId, "visits"],
    queryFn: async () => {
      const res = await fetch(`/api/service-calls/${invoice!.serviceCallId}/visits`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!invoice?.serviceCallId,
  });

  useEffect(() => {
    if (invoice && !isEditing) {
      setForm(invoice);
      setItems(invoice.items || []);
    }
  }, [invoice, isEditing]);

  const saveMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/invoices/${id}`, data),
    onSuccess: async (r) => {
      const updated = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.setQueryData(["/api/invoices", id], updated);
      setIsEditing(false);
      toast({ title: "Invoice saved" });
    },
    onError: () => toast({ title: "Error saving invoice", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/invoices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      navigate("/invoices");
      toast({ title: "Invoice deleted" });
    },
  });

  function setStatus(status: string) {
    const update: any = { status };
    if (status === "Paid") update.paidDate = new Date().toISOString().split("T")[0];
    saveMutation.mutate(update);
  }

  function handleSave() {
    if (!form) return;
    // Recalculate totals
    const subtotal = items.reduce((s, i) => s + parseFloat(i.amount || "0"), 0);
    saveMutation.mutate({
      ...form,
      subtotal: subtotal.toFixed(2),
      total: subtotal.toFixed(2),
      items: items.map((item, idx) => ({ ...item, sortOrder: idx })),
    });
  }

  function addItem(type: string) {
    setItems(prev => [...prev, { type, description: ITEM_TYPE_LABELS[type] || "", quantity: "1", unitPrice: "0", amount: "0", visitNumber: null }]);
  }

  function updateItem(idx: number, field: string, value: string) {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if (field === "quantity" || field === "unitPrice") {
        updated.amount = calcAmount(
          field === "quantity" ? value : item.quantity,
          field === "unitPrice" ? value : item.unitPrice
        );
      }
      return updated;
    }));
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function handlePdf() {
    if (!invoice) return;
    try {
      await generateInvoicePdf(invoice);
    } catch (e) {
      toast({ title: "Failed to generate PDF", variant: "destructive" });
    }
  }

  async function handleEmail() {
    if (!invoice) return;
    try {
      const blob = await generateInvoicePdf(invoice, true);
      if (blob && navigator.share) {
        const file = new File([blob], `${invoice.invoiceNumber}.pdf`, { type: "application/pdf" });
        await navigator.share({ title: `Invoice ${invoice.invoiceNumber}`, files: [file] });
      } else {
        // Fallback: open mailto
        const subject = encodeURIComponent(`Invoice ${invoice.invoiceNumber} from Fitzpatrick Warranty Service, LLC`);
        window.open(`mailto:${invoice.billToEmail || ""}?subject=${subject}`);
      }
    } catch (e) {
      toast({ title: "Failed to share invoice", variant: "destructive" });
    }
  }

  if (isLoading) return <div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>;
  if (!invoice) return <div className="p-6 text-center text-muted-foreground text-sm">Invoice not found.</div>;

  const displayInvoice = isEditing ? form : invoice;
  const displayItems = isEditing ? items : invoice.items;
  const subtotal = displayItems?.reduce((s, i) => s + parseFloat(i.amount || "0"), 0) || 0;

  // Visit grouping logic
  const hasVisitGrouping = displayItems?.some(i => i.visitNumber != null) || false;
  const hasVisits = callVisits.length > 0;
  const maxVisitNumber = hasVisits
    ? Math.max(1, ...callVisits.map((v: any) => v.visitNumber))
    : (hasVisitGrouping ? Math.max(...displayItems!.filter(i => i.visitNumber != null).map(i => i.visitNumber!)) : 0);
  const showVisitDropdown = hasVisitGrouping || (!!invoice.serviceCallId && hasVisits);

  // Build visit date map for section headers
  const visitDateMap: Record<number, string> = {};
  callVisits.forEach((v: any) => {
    visitDateMap[v.visitNumber] = v.visitDate;
  });

  // Group items by visitNumber for display
  function groupItemsByVisit(itemsToGroup: InvoiceItem[]) {
    const groups: { key: number | null; label: string; visitDate?: string; items: { item: InvoiceItem; originalIndex: number }[] }[] = [];
    const visitNumbers = new Set<number | null>();
    itemsToGroup.forEach(i => visitNumbers.add(i.visitNumber ?? null));
    // Sort: numbered visits first, then null (General)
    const sorted = [...visitNumbers].sort((a, b) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return a - b;
    });
    for (const vn of sorted) {
      const groupItems = itemsToGroup
        .map((item, idx) => ({ item, originalIndex: idx }))
        .filter(({ item }) => (item.visitNumber ?? null) === vn);
      groups.push({
        key: vn,
        label: vn != null ? `VISIT ${vn}` : "GENERAL",
        visitDate: vn != null ? visitDateMap[vn] : undefined,
        items: groupItems,
      });
    }
    return groups;
  }

  return (
    <main className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/invoices")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold font-mono">{invoice.invoiceNumber}</h1>
              <Badge variant="outline" className={`text-xs ${STATUS_STYLES[invoice.status] || STATUS_STYLES["Draft"]}`}>
                {invoice.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{invoice.billToName}</p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {/* Status actions */}
          {invoice.status === "Draft" && !isEditing && (
            <Button size="sm" variant="outline" onClick={() => setStatus("Sent")} className="text-sky-600 border-sky-300">
              <Send className="w-3.5 h-3.5 mr-1" /> Mark Sent
            </Button>
          )}
          {(invoice.status === "Sent" || invoice.status === "Overdue") && !isEditing && (
            <Button size="sm" variant="outline" onClick={() => setStatus("Paid")} className="text-emerald-600 border-emerald-300">
              <CheckCircle className="w-3.5 h-3.5 mr-1" /> Mark Paid
            </Button>
          )}

          {/* Actions */}
          {!isEditing && (
            <>
              <Button size="sm" variant="outline" onClick={handleEmail}>
                <Mail className="w-3.5 h-3.5 mr-1" /> Email
              </Button>
              <Button size="sm" variant="outline" onClick={handlePdf}>
                <FileDown className="w-3.5 h-3.5 mr-1" /> PDF
              </Button>
              <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
                <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
              </Button>
            </>
          )}
          {isEditing && (
            <>
              <Button size="sm" variant="outline" onClick={() => { setIsEditing(false); setForm(invoice); setItems(invoice.items || []); }}>
                Cancel
              </Button>
              <Button size="sm" className="bg-[hsl(200,72%,40%)] hover:bg-[hsl(200,72%,35%)]" onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Invoice card */}
      <div className="bg-card rounded-xl border overflow-hidden">
        {/* From / To header */}
        <div className="grid grid-cols-2 gap-6 p-6 border-b bg-muted/20">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground mb-2">From</p>
            <p className="font-bold text-sm">Fitzpatrick Warranty Service, LLC</p>
            <p className="text-sm text-muted-foreground">Kevin Withers</p>
            <p className="text-sm text-muted-foreground">Fitz.warranty@fitzpatrickwarranty.com</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground mb-2">
              Bill To — {isEditing
                ? <select className="text-xs border rounded px-1 py-0.5 bg-background" value={form?.billToType || "contractor"} onChange={e => setForm(f => ({...f!, billToType: e.target.value}))}>
                    <option value="contractor">Contractor</option>
                    <option value="manufacturer">Manufacturer</option>
                  </select>
                : <span className="capitalize">{invoice.billToType}</span>
              }
            </p>
            {isEditing ? (
              <div className="space-y-1.5">
                <Input value={form?.billToName || ""} onChange={e => setForm(f => ({...f!, billToName: e.target.value}))} placeholder="Company Name" className="h-8 text-sm" />
                <Input value={form?.billToAddress || ""} onChange={e => setForm(f => ({...f!, billToAddress: e.target.value}))} placeholder="Address" className="h-8 text-sm" />
                <div className="flex gap-1.5">
                  <Input value={form?.billToCity || ""} onChange={e => setForm(f => ({...f!, billToCity: e.target.value}))} placeholder="City" className="h-8 text-sm flex-1" />
                  <Input value={form?.billToState || ""} onChange={e => setForm(f => ({...f!, billToState: e.target.value}))} placeholder="ST" className="h-8 text-sm w-16" />
                </div>
                <Input value={form?.billToEmail || ""} onChange={e => setForm(f => ({...f!, billToEmail: e.target.value}))} placeholder="Email" className="h-8 text-sm" />
                <Input value={form?.billToPhone || ""} onChange={e => setForm(f => ({...f!, billToPhone: e.target.value}))} placeholder="Phone" className="h-8 text-sm" />
              </div>
            ) : (
              <>
                <p className="font-bold text-sm">{invoice.billToName}</p>
                {invoice.billToAddress && <p className="text-sm text-muted-foreground">{invoice.billToAddress}</p>}
                {(invoice.billToCity || invoice.billToState) && (
                  <p className="text-sm text-muted-foreground">{[invoice.billToCity, invoice.billToState].filter(Boolean).join(", ")}</p>
                )}
                {invoice.billToEmail && <p className="text-sm text-muted-foreground">{invoice.billToEmail}</p>}
                {invoice.billToPhone && <p className="text-sm text-muted-foreground">{invoice.billToPhone}</p>}
              </>
            )}
          </div>
        </div>

        {/* Invoice meta */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4 border-b text-sm">
          {[
            { label: "Invoice #", value: invoice.invoiceNumber },
            {
              label: "Issue Date",
              value: isEditing
                ? <input type="date" value={form?.issueDate || ""} onChange={e => setForm(f => ({...f!, issueDate: e.target.value}))} className="text-sm border rounded px-1.5 py-0.5 bg-background w-full" />
                : invoice.issueDate,
            },
            {
              label: "Due Date",
              value: isEditing
                ? <input type="date" value={form?.dueDate || ""} onChange={e => setForm(f => ({...f!, dueDate: e.target.value}))} className="text-sm border rounded px-1.5 py-0.5 bg-background w-full" />
                : (invoice.dueDate || "—"),
            },
            {
              label: "Terms",
              value: isEditing
                ? <select className="text-sm border rounded px-1 py-0.5 bg-background w-full" value={form?.paymentTerms || "Net 30"} onChange={e => setForm(f => ({...f!, paymentTerms: e.target.value}))}>
                    {["Due on Receipt","Net 15","Net 30","Net 60"].map(t => <option key={t}>{t}</option>)}
                  </select>
                : (invoice.paymentTerms || "Net 30"),
            },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground mb-0.5">{label}</p>
              <div className="font-medium">{value}</div>
            </div>
          ))}
        </div>

        {/* Line items */}
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Line Items</p>
            {isEditing && (
              <div className="flex gap-1.5 flex-wrap">
                {["labor","travel","parts","other"].map(type => (
                  <Button key={type} size="sm" variant="outline" className="h-7 text-xs" onClick={() => addItem(type)}>
                    <Plus className="w-3 h-3 mr-0.5" /> {ITEM_TYPE_LABELS[type]}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Items table header */}
          <div className="hidden md:grid grid-cols-12 gap-2 text-[10px] uppercase tracking-widest font-medium text-muted-foreground px-2">
            <div className={showVisitDropdown && isEditing ? "col-span-4" : "col-span-5"}>Description</div>
            {showVisitDropdown && isEditing && <div className="col-span-1">Visit</div>}
            <div className="col-span-2 text-right">Qty / Hrs</div>
            <div className="col-span-2 text-right">Unit Price</div>
            <div className="col-span-2 text-right">Amount</div>
            {isEditing && <div className="col-span-1" />}
          </div>

          {displayItems?.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No line items yet. {isEditing ? "Use the buttons above to add items." : ""}</p>
          )}

          {/* Render items — grouped by visit if applicable */}
          {hasVisitGrouping && displayItems && displayItems.length > 0 ? (
            <>
              {groupItemsByVisit(displayItems).map(group => {
                const groupSubtotal = group.items.reduce((s, { item }) => s + parseFloat(item.amount || "0"), 0);
                return (
                  <div key={group.key ?? "general"}>
                    {/* Section header */}
                    <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground border-b border-border pb-1 mt-4 mb-2">
                      {group.label}{group.visitDate ? ` — ${group.visitDate}` : ""}
                    </div>
                    {group.items.map(({ item, originalIndex }) => (
                      <div key={originalIndex} className="grid grid-cols-12 gap-2 items-center py-2 border-b last:border-0">
                        <div className={`col-span-12 ${showVisitDropdown && isEditing ? "md:col-span-4" : "md:col-span-5"}`}>
                          {isEditing ? (
                            <div className="space-y-1">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{ITEM_TYPE_LABELS[item.type] || item.type}</div>
                              <Input value={item.description} onChange={e => updateItem(originalIndex, "description", e.target.value)} className="h-8 text-sm" />
                            </div>
                          ) : (
                            <div>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{ITEM_TYPE_LABELS[item.type] || item.type}</div>
                              <div className="font-medium text-sm">{item.description}</div>
                            </div>
                          )}
                        </div>
                        {showVisitDropdown && isEditing && (
                          <div className="col-span-4 md:col-span-1">
                            <select
                              value={item.visitNumber ?? ""}
                              onChange={e => {
                                const val = e.target.value === "" ? null : parseInt(e.target.value);
                                setItems(prev => prev.map((it, i) => i === originalIndex ? { ...it, visitNumber: val } : it));
                              }}
                              className="w-full h-8 px-1 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-[hsl(200,72%,40%)]"
                            >
                              <option value="">General</option>
                              {Array.from({ length: maxVisitNumber }, (_, i) => i + 1).map(n => (
                                <option key={n} value={n}>V{n}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="col-span-4 md:col-span-2 md:text-right">
                          {isEditing
                            ? <Input value={item.quantity} onChange={e => updateItem(originalIndex, "quantity", e.target.value)} className="h-8 text-sm text-right" />
                            : <span className="text-sm">{item.quantity}</span>
                          }
                        </div>
                        <div className="col-span-4 md:col-span-2 md:text-right">
                          {isEditing
                            ? <Input value={item.unitPrice} onChange={e => updateItem(originalIndex, "unitPrice", e.target.value)} className="h-8 text-sm text-right" placeholder="0.00" />
                            : <span className="text-sm">{fmt$(item.unitPrice)}</span>
                          }
                        </div>
                        <div className="col-span-3 md:col-span-2 md:text-right font-medium text-sm">
                          {fmt$(item.amount)}
                        </div>
                        {isEditing && (
                          <div className="col-span-1 flex justify-end">
                            <Button variant="ghost" size="icon" className="w-7 h-7 text-red-500 hover:text-red-700" onClick={() => removeItem(originalIndex)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                    {/* Per-visit subtotal */}
                    <div className="text-right text-sm text-muted-foreground">
                      {group.label} Subtotal: {fmt$(String(groupSubtotal))}
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            /* Flat list (no visit grouping) — original behavior */
            displayItems?.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center py-2 border-b last:border-0">
                <div className="col-span-12 md:col-span-5">
                  {isEditing ? (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{ITEM_TYPE_LABELS[item.type] || item.type}</div>
                      <Input value={item.description} onChange={e => updateItem(idx, "description", e.target.value)} className="h-8 text-sm" />
                    </div>
                  ) : (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{ITEM_TYPE_LABELS[item.type] || item.type}</div>
                      <div className="font-medium text-sm">{item.description}</div>
                    </div>
                  )}
                </div>
                <div className="col-span-4 md:col-span-2 md:text-right">
                  {isEditing
                    ? <Input value={item.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} className="h-8 text-sm text-right" />
                    : <span className="text-sm">{item.quantity}</span>
                  }
                </div>
                <div className="col-span-4 md:col-span-2 md:text-right">
                  {isEditing
                    ? <Input value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", e.target.value)} className="h-8 text-sm text-right" placeholder="0.00" />
                    : <span className="text-sm">{fmt$(item.unitPrice)}</span>
                  }
                </div>
                <div className="col-span-3 md:col-span-2 md:text-right font-medium text-sm">
                  {fmt$(item.amount)}
                </div>
                {isEditing && (
                  <div className="col-span-1 flex justify-end">
                    <Button variant="ghost" size="icon" className="w-7 h-7 text-red-500 hover:text-red-700" onClick={() => removeItem(idx)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}

          {/* Totals */}
          <div className="pt-2 space-y-1 max-w-xs ml-auto text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">{fmt$(String(subtotal))}</span>
            </div>
            <div className="flex justify-between border-t pt-1 text-base font-bold">
              <span>Total</span>
              <span className="text-[hsl(200,72%,40%)]">{fmt$(String(subtotal))}</span>
            </div>
          </div>

          {/* Notes */}
          <div className="pt-2">
            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground mb-1.5">Notes</p>
            {isEditing
              ? <textarea value={form?.notes || ""} onChange={e => setForm(f => ({...f!, notes: e.target.value}))} rows={3} className="w-full text-sm border rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-[hsl(200,72%,40%)]" placeholder="Payment instructions, thank you note, etc." />
              : <p className="text-sm text-muted-foreground">{invoice.notes || "—"}</p>
            }
          </div>
        </div>
      </div>

      {/* Danger zone */}
      {!isEditing && invoice.status === "Draft" && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => {
            if (confirm("Delete this invoice? This cannot be undone.")) deleteMutation.mutate();
          }}>
            Delete Invoice
          </Button>
        </div>
      )}
    </main>
  );
}
