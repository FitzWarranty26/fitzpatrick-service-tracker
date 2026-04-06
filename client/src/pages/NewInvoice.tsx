import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

interface LineItem {
  type: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

interface ServiceCall {
  id: number;
  customerName: string | null;
  jobSiteName: string | null;
  manufacturer: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  hoursOnJob: string | null;
  milesTraveled: string | null;
  parts: { partNumber: string; partDescription: string; quantity: string; unitCost: string }[];
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  labor: "Labor", parts: "Parts / Materials", travel: "Travel / Mileage", other: "Other",
};

function calcAmount(qty: string, price: string): string {
  const q = parseFloat(qty) || 0;
  const p = parseFloat(price) || 0;
  return (q * p).toFixed(2);
}

function fmt$(v: string | null | undefined): string {
  const n = parseFloat(String(v || "0"));
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

export default function NewInvoice() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const params = new URLSearchParams(search || "");
  const callId = params.get("callId");

  // Invoice fields
  const today = new Date().toISOString().split("T")[0];
  const [billToType, setBillToType] = useState("contractor");
  const [billToName, setBillToName] = useState("");
  const [billToAddress, setBillToAddress] = useState("");
  const [billToCity, setBillToCity] = useState("");
  const [billToState, setBillToState] = useState("");
  const [billToEmail, setBillToEmail] = useState("");
  const [billToPhone, setBillToPhone] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Net 30");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState("");

  // Pre-fill due date when payment terms change
  useEffect(() => {
    if (issueDate && paymentTerms !== "Due on Receipt") {
      const days = parseInt(paymentTerms.replace("Net ", "")) || 30;
      const due = new Date(issueDate);
      due.setDate(due.getDate() + days);
      setDueDate(due.toISOString().split("T")[0]);
    } else if (paymentTerms === "Due on Receipt") {
      setDueDate(issueDate);
    }
  }, [issueDate, paymentTerms]);

  // Fetch next invoice number
  useQuery({
    queryKey: ["/api/invoices/next-number"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/invoices/next-number");
      const d = await r.json();
      setInvoiceNumber(d.invoiceNumber);
      return d;
    },
  });

  // Fetch service call if coming from one
  const { data: serviceCall } = useQuery<ServiceCall>({
    queryKey: ["/api/service-calls", callId],
    enabled: !!callId,
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/service-calls/${callId}`);
      return r.json();
    },
  });

  // Pre-fill from service call when it loads
  useEffect(() => {
    if (!serviceCall) return;
    // Bill To: the customer/contractor on the call
    setBillToName(serviceCall.customerName || serviceCall.contactName || "");
    setBillToEmail(serviceCall.contactEmail || "");
    setBillToPhone(serviceCall.contactPhone || "");

    // Pre-fill line items from the call
    const newItems: LineItem[] = [];

    // Labor from hours logged
    if (serviceCall.hoursOnJob && parseFloat(serviceCall.hoursOnJob) > 0) {
      newItems.push({
        type: "labor",
        description: "Labor — Warranty Service",
        quantity: serviceCall.hoursOnJob,
        unitPrice: "0",
        amount: "0",
      });
    }

    // Travel from miles logged
    if (serviceCall.milesTraveled && parseFloat(serviceCall.milesTraveled) > 0) {
      newItems.push({
        type: "travel",
        description: `Travel — ${serviceCall.milesTraveled} miles`,
        quantity: "1",
        unitPrice: "0",
        amount: "0",
      });
    }

    // Parts from parts logged
    if (serviceCall.parts?.length) {
      serviceCall.parts.forEach(p => {
        newItems.push({
          type: "parts",
          description: `${p.partDescription}${p.partNumber ? ` (${p.partNumber})` : ""}`,
          quantity: p.quantity || "1",
          unitPrice: p.unitCost || "0",
          amount: calcAmount(p.quantity || "1", p.unitCost || "0"),
        });
      });
    }

    if (newItems.length) setItems(newItems);
  }, [serviceCall]);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/invoices", data),
    onSuccess: async (r) => {
      const inv = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      navigate(`/invoices/${inv.id}`);
      toast({ title: `Invoice ${inv.invoiceNumber} created` });
    },
    onError: () => toast({ title: "Error creating invoice", variant: "destructive" }),
  });

  function addItem(type: string) {
    setItems(prev => [...prev, { type, description: ITEM_TYPE_LABELS[type], quantity: "1", unitPrice: "0", amount: "0" }]);
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

  const subtotal = items.reduce((s, i) => s + parseFloat(i.amount || "0"), 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!billToName || !issueDate) {
      toast({ title: "Bill To Name and Issue Date are required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      invoiceNumber,
      serviceCallId: callId ? parseInt(callId) : null,
      billToType,
      billToName,
      billToAddress: billToAddress || null,
      billToCity: billToCity || null,
      billToState: billToState || null,
      billToEmail: billToEmail || null,
      billToPhone: billToPhone || null,
      issueDate,
      dueDate: dueDate || null,
      paymentTerms,
      notes: notes || null,
      subtotal: subtotal.toFixed(2),
      total: subtotal.toFixed(2),
      status: "Draft",
      items,
    });
  }

  return (
    <main className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate("/invoices")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">New Invoice</h1>
          <p className="text-sm text-muted-foreground">{invoiceNumber || "Generating number..."}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Bill To */}
        <div className="bg-card rounded-xl border p-6 space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-sm">Bill To</h2>
            <Select value={billToType} onValueChange={setBillToType}>
              <SelectTrigger className="w-[150px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contractor">Contractor</SelectItem>
                <SelectItem value="manufacturer">Manufacturer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Company / Name *</label>
              <Input value={billToName} onChange={e => setBillToName(e.target.value)} required className="mt-1" placeholder="e.g. Hansen Plumbing LLC" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Email</label>
              <Input type="email" value={billToEmail} onChange={e => setBillToEmail(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Phone</label>
              <Input value={billToPhone} onChange={e => setBillToPhone(e.target.value)} className="mt-1" />
            </div>
            <div className="md:col-span-2">
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Address</label>
              <Input value={billToAddress} onChange={e => setBillToAddress(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">City</label>
              <Input value={billToCity} onChange={e => setBillToCity(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">State</label>
              <Input value={billToState} onChange={e => setBillToState(e.target.value)} className="mt-1" placeholder="UT" />
            </div>
          </div>
        </div>

        {/* Invoice Details */}
        <div className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="font-semibold text-sm">Invoice Details</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Invoice #</label>
              <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="mt-1 font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Issue Date *</label>
              <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} required className="mt-1 w-full h-10 px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-[hsl(200,72%,40%)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Payment Terms</label>
              <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                <SelectTrigger className="mt-1 h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Due on Receipt","Net 15","Net 30","Net 60"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 w-full h-10 px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-[hsl(200,72%,40%)]" />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-card rounded-xl border p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-sm">Line Items</h2>
            <div className="flex gap-1.5 flex-wrap">
              {["labor","travel","parts","other"].map(type => (
                <Button key={type} type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => addItem(type)}>
                  <Plus className="w-3 h-3 mr-0.5" /> {ITEM_TYPE_LABELS[type]}
                </Button>
              ))}
            </div>
          </div>

          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No line items yet. Use the buttons above to add Labor, Travel, Parts, or Other charges.</p>
          )}

          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end border-b pb-3 last:border-0">
              <div className="col-span-12 md:col-span-5">
                <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">{ITEM_TYPE_LABELS[item.type]}</label>
                <Input value={item.description} onChange={e => updateItem(idx, "description", e.target.value)} className="mt-1 h-9 text-sm" placeholder="Description" />
              </div>
              <div className="col-span-4 md:col-span-2">
                <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                  {item.type === "labor" ? "Hours" : item.type === "travel" ? "Miles" : "Qty"}
                </label>
                <Input value={item.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} className="mt-1 h-9 text-sm text-right" />
              </div>
              <div className="col-span-4 md:col-span-2">
                <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                  {item.type === "labor" ? "$/Hour" : item.type === "travel" ? "$/Mile" : "$/Unit"}
                </label>
                <div className="relative mt-1">
                  <span className="absolute left-2.5 top-2 text-sm text-muted-foreground">$</span>
                  <Input value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", e.target.value)} className="h-9 text-sm text-right pl-5" />
                </div>
              </div>
              <div className="col-span-3 md:col-span-2">
                <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Amount</label>
                <div className="mt-1 h-9 flex items-center justify-end font-medium text-sm px-3 bg-muted/30 rounded-md">
                  ${fmt$(item.amount)}
                </div>
              </div>
              <div className="col-span-1">
                <Button type="button" variant="ghost" size="icon" className="w-9 h-9 text-red-500 hover:text-red-700" onClick={() => removeItem(idx)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}

          {/* Total */}
          {items.length > 0 && (
            <div className="pt-2 max-w-xs ml-auto text-sm">
              <div className="flex justify-between border-t pt-2 text-base font-bold">
                <span>Total</span>
                <span className="text-[hsl(200,72%,40%)]">${subtotal.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="bg-card rounded-xl border p-6 space-y-2">
          <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="w-full text-sm border rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-[hsl(200,72%,40%)]" placeholder="Payment instructions, thank you note, reference numbers, etc." />
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate("/invoices")}>Cancel</Button>
          <Button type="submit" className="bg-[hsl(200,72%,40%)] hover:bg-[hsl(200,72%,35%)]" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create Invoice"}
          </Button>
        </div>
      </form>
    </main>
  );
}
