import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PageHero } from "@/components/PageHero";
import { useToast } from "@/hooks/use-toast";
import { getUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  PlusCircle, Search, Phone, Mail, Trash2, Edit3, MapPin, RefreshCw, Download, X, Users,
} from "lucide-react";
import type { Contact } from "@shared/schema";
import { PhoneLink } from "@/components/PhoneLink";

const CONTACT_TYPES = [
  { value: "customer", label: "Customer" },
  { value: "contractor", label: "Contractor" },
  { value: "wholesaler", label: "Wholesaler" },
  { value: "site_contact", label: "Site Contact" },
] as const;

const typeBadgeColors: Record<string, string> = {
  customer: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  contractor: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  wholesaler: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  site_contact: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

const typeLabels: Record<string, string> = {
  customer: "Customer",
  contractor: "Contractor",
  wholesaler: "Wholesaler",
  site_contact: "Site Contact",
};

// Stat card accent config: border color + ring color (Tailwind-safe arbitrary values)
const TYPE_STATS: {
  value: string;
  label: string;
  border: string;
  ring: string;
  text: string;
}[] = [
  { value: "contractor", label: "Contractors", border: "border-l-green-500", ring: "ring-green-500/30", text: "text-green-600 dark:text-green-400" },
  { value: "wholesaler", label: "Wholesalers", border: "border-l-amber-500", ring: "ring-amber-500/30", text: "text-amber-600 dark:text-amber-400" },
  { value: "customer", label: "Customers", border: "border-l-blue-500", ring: "ring-blue-500/30", text: "text-blue-600 dark:text-blue-400" },
  { value: "site_contact", label: "Site Contacts", border: "border-l-purple-500", ring: "ring-purple-500/30", text: "text-purple-600 dark:text-purple-400" },
];

interface ContactFormData {
  contactType: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  notes: string;
}

const emptyForm: ContactFormData = {
  contactType: "customer",
  companyName: "",
  contactName: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  notes: "",
};

export default function Contacts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const user = getUser();
  const isManager = user?.role === "manager";

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [formData, setFormData] = useState<ContactFormData>(emptyForm);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (filterType) params.set("type", filterType);
  const queryString = params.toString();

  const { data: contactsList, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", queryString],
    queryFn: async () => {
      const url = queryString ? `/api/contacts?${queryString}` : "/api/contacts";
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  // Unfiltered total counts for stat strip — use a separate query so the
  // strip stays stable while the list is filtered by type/search.
  const { data: allContacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", "__all__"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/contacts");
      return res.json();
    },
  });

  const counts = useMemo(() => {
    const base: Record<string, number> = { customer: 0, contractor: 0, wholesaler: 0, site_contact: 0 };
    (allContacts ?? []).forEach(c => {
      if (base[c.contactType] !== undefined) base[c.contactType] += 1;
    });
    return base;
  }, [allContacts]);

  const createMutation = useMutation({
    mutationFn: async (data: ContactFormData) => {
      const res = await apiRequest("POST", "/api/contacts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setDialogOpen(false);
      setFormData(emptyForm);
      toast({ title: "Contact created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ContactFormData> }) => {
      const res = await apiRequest("PATCH", `/api/contacts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setDialogOpen(false);
      setEditingContact(null);
      setFormData(emptyForm);
      toast({ title: "Contact updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/contacts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/contacts/backfill");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Import complete", description: `Processed ${data.contactsProcessed} contacts from ${data.message?.match(/\d+/)?.[0] ?? ""} service calls.` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => {
    setEditingContact(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (contact: Contact) => {
    setEditingContact(contact);
    setFormData({
      contactType: contact.contactType,
      companyName: contact.companyName ?? "",
      contactName: contact.contactName,
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      address: contact.address ?? "",
      city: contact.city ?? "",
      state: contact.state ?? "",
      notes: contact.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.contactName.trim()) {
      toast({ title: "Contact name required", variant: "destructive" });
      return;
    }
    if (editingContact) {
      updateMutation.mutate({ id: editingContact.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const updateField = (key: keyof ContactFormData, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleExport = async () => {
    try {
      const p = new URLSearchParams();
      if (filterType) p.set("type", filterType);
      if (search) p.set("search", search);
      const url = `/api/contacts/export${p.toString() ? "?" + p.toString() : ""}`;
      const res = await apiRequest("GET", url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "contacts-export.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  };

  const totalCount = allContacts?.length ?? 0;
  const showingAll = !filterType;
  const activeTypeLabel = filterType ? typeLabels[filterType] : "All";

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-24 md:pb-6 space-y-5">
      <PageHero
        title="Contacts"
        subtitle={<span>Your service network — contractors, wholesalers, customers, and site contacts</span>}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => backfillMutation.mutate()} disabled={backfillMutation.isPending} data-testid="button-backfill-contacts">
              <RefreshCw className={`w-4 h-4 mr-1.5 ${backfillMutation.isPending ? "animate-spin" : ""}`} />
              {backfillMutation.isPending ? "Importing…" : "Import from Calls"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} data-testid="button-export-contacts">
              <Download className="w-4 h-4 mr-1.5" /> Export CSV
            </Button>
            <Button size="sm" onClick={openCreate} data-testid="button-add-contact" className="shadow-sm">
              <PlusCircle className="w-4 h-4 mr-1.5" /> Add Contact
            </Button>
          </>
        }
      />

      {/* ── Section 1: Summary Strip ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {TYPE_STATS.map(stat => {
          const active = filterType === stat.value;
          return (
            <button
              key={stat.value}
              type="button"
              onClick={() => setFilterType(active ? "" : stat.value)}
              className={`text-left bg-card rounded-lg border border-border/50 p-4 border-l-[3px] ${stat.border} cursor-pointer transition-all hover:shadow-md ${active ? `ring-2 ${stat.ring} shadow-md` : ""}`}
              data-testid={`stat-card-${stat.value}`}
            >
              <p className={`text-2xl font-bold tabular-nums leading-none ${stat.text}`}>{counts[stat.value] ?? 0}</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-2">{stat.label}</p>
            </button>
          );
        })}
      </div>

      {/* ── Section 2: Search + Filter bar ───────────────────────────────── */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="bg-card rounded-xl border border-border/50 pl-11 pr-4 py-3 h-auto text-sm shadow-sm"
            data-testid="input-search-contacts"
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Showing:</span>
          <span className="font-semibold text-foreground">{activeTypeLabel}</span>
          {!showingAll && (
            <button
              type="button"
              onClick={() => setFilterType("")}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted hover:bg-muted/70 text-xs text-muted-foreground transition-colors"
              data-testid="button-clear-filter"
            >
              <X className="w-3 h-3" />
              Clear filter
            </button>
          )}
        </div>
      </div>

      {/* ── Section 3: Contact List ──────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : !contactsList || contactsList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-card rounded-xl border border-border/50">
          <Users className="w-12 h-12 text-muted-foreground/30 mb-4" />
          {search ? (
            <p className="text-sm text-muted-foreground">No contacts match '{search}'</p>
          ) : totalCount === 0 ? (
            <>
              <p className="text-base font-semibold text-foreground mb-1">No contacts yet</p>
              <p className="text-sm text-muted-foreground mb-4">Add your first contractor, wholesaler, or customer.</p>
              <Button onClick={openCreate} data-testid="empty-add-contact">
                <PlusCircle className="w-4 h-4 mr-1.5" />
                Add Contact
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No {activeTypeLabel.toLowerCase()} contacts found.</p>
          )}
        </div>
      ) : (
        <>
          {/* Desktop: Table */}
          <div className="hidden md:block bg-card rounded-xl border border-border/50 overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/30 border-b border-border/50">
                  <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-4 py-3">Name</th>
                  <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-4 py-3">Company</th>
                  <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-4 py-3">Type</th>
                  <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-4 py-3">Phone</th>
                  <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-4 py-3">Email</th>
                  <th className="text-right text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-4 py-3 w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {contactsList.map(contact => (
                  <tr
                    key={contact.id}
                    onClick={() => { window.location.hash = `/contacts/${contact.id}`; }}
                    className="text-sm hover:bg-muted/40 transition-colors cursor-pointer even:bg-muted/10 border-b border-border/30 last:border-0"
                    data-testid={`contact-row-${contact.id}`}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{contact.contactName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{contact.companyName || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeBadgeColors[contact.contactType] || "bg-gray-100 text-gray-700"}`}>
                        {typeLabels[contact.contactType] || contact.contactType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground" onClick={e => e.stopPropagation()}>
                      {contact.phone ? <PhoneLink phone={contact.phone} /> : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]" onClick={e => e.stopPropagation()}>
                      {contact.email ? (
                        <a href={`mailto:${contact.email}`} className="text-primary hover:underline">{contact.email}</a>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(contact)}
                          data-testid={`button-edit-contact-${contact.id}`}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </Button>
                        {isManager && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                data-testid={`button-delete-contact-${contact.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Contact?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete {contact.contactName}. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(contact.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  data-testid={`button-confirm-delete-contact-${contact.id}`}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {contactsList.map(contact => (
              <div
                key={contact.id}
                onClick={() => { window.location.hash = `/contacts/${contact.id}`; }}
                className="bg-card rounded-xl border border-border/50 p-4 shadow-sm cursor-pointer hover:bg-muted/30 transition-colors"
                data-testid={`contact-card-${contact.id}`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeBadgeColors[contact.contactType] || "bg-gray-100 text-gray-700"}`}>
                    {typeLabels[contact.contactType] || contact.contactType}
                  </span>
                  <div className="flex items-center gap-1 -mr-2 -mt-1" onClick={e => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(contact)}
                      data-testid={`button-edit-contact-mobile-${contact.id}`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </Button>
                    {isManager && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            data-testid={`button-delete-contact-mobile-${contact.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Contact?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete {contact.contactName}. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(contact.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
                <p className="font-semibold text-sm text-foreground">{contact.contactName}</p>
                {contact.companyName && (
                  <p className="text-xs text-muted-foreground mt-0.5">{contact.companyName}</p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5" onClick={e => e.stopPropagation()}>
                  {contact.phone && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Phone className="w-3 h-3" />
                      <PhoneLink phone={contact.phone} />
                    </span>
                  )}
                  {contact.email && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Mail className="w-3 h-3" />
                      <a href={`mailto:${contact.email}`} className="text-primary">{contact.email}</a>
                    </span>
                  )}
                  {(contact.city || contact.state) && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="w-3 h-3" />
                      {[contact.city, contact.state].filter(Boolean).join(", ")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Section 4: Create/Edit Dialog ────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">{editingContact ? "Edit Contact" : "Add Contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Type</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CONTACT_TYPES.map(t => {
                  const active = formData.contactType === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => updateField("contactType", t.value)}
                      className={`text-xs font-medium px-3 py-2 rounded-md border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border hover:bg-muted"}`}
                      data-testid={`dialog-type-${t.value}`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
                Contact Name <span className="text-primary">*</span>
              </label>
              <Input
                value={formData.contactName}
                onChange={e => updateField("contactName", e.target.value)}
                placeholder="Full name"
                data-testid="dialog-contact-name"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Company Name</label>
              <Input
                value={formData.companyName}
                onChange={e => updateField("companyName", e.target.value)}
                placeholder="Company or business name"
                data-testid="dialog-company-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Phone</label>
                <Input
                  type="tel"
                  value={formData.phone}
                  onChange={e => updateField("phone", e.target.value)}
                  placeholder="801-555-0000"
                  data-testid="dialog-phone"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Email</label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={e => updateField("email", e.target.value)}
                  placeholder="email@example.com"
                  data-testid="dialog-email"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Address</label>
              <Input
                value={formData.address}
                onChange={e => updateField("address", e.target.value)}
                placeholder="Street address"
                data-testid="dialog-address"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">City</label>
                <Input
                  value={formData.city}
                  onChange={e => updateField("city", e.target.value)}
                  placeholder="City"
                  data-testid="dialog-city"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">State</label>
                <Input
                  value={formData.state}
                  onChange={e => updateField("state", e.target.value)}
                  placeholder="UT"
                  data-testid="dialog-state"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Notes</label>
              <Textarea
                rows={3}
                value={formData.notes}
                onChange={e => updateField("notes", e.target.value)}
                placeholder="Additional notes…"
                data-testid="dialog-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="dialog-cancel">Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="dialog-save"
            >
              {(createMutation.isPending || updateMutation.isPending) ? "Saving…" : "Save Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
