import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  PlusCircle, Search, Phone, Mail, Building, User, Trash2, Edit3, X, MapPin,
} from "lucide-react";
import type { Contact } from "@shared/schema";

const CONTACT_TYPES = [
  { value: "customer", label: "Customer" },
  { value: "contractor", label: "Contractor" },
  { value: "site_contact", label: "Site Contact" },
] as const;

const typeBadgeColors: Record<string, string> = {
  customer: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  contractor: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  site_contact: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

const typeLabels: Record<string, string> = {
  customer: "Customer",
  contractor: "Contractor",
  site_contact: "Site Contact",
};

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

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-bold">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {contactsList ? `${contactsList.length} contact${contactsList.length !== 1 ? "s" : ""}` : "Loading…"}
          </p>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="button-add-contact">
          <PlusCircle className="w-4 h-4 mr-1.5" />
          Add Contact
        </Button>
      </div>

      {/* Search + Filter */}
      <div className="flex gap-2 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="pl-9"
            data-testid="input-search-contacts"
          />
        </div>
        <Select value={filterType || "__all__"} onValueChange={v => setFilterType(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-40" data-testid="filter-contact-type">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Types</SelectItem>
            {CONTACT_TYPES.map(t => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !contactsList || contactsList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <User className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No contacts found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {contactsList.map(contact => (
            <Card key={contact.id} className="overflow-hidden" data-testid={`contact-card-${contact.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeBadgeColors[contact.contactType] || "bg-gray-100 text-gray-700"}`}>
                        {typeLabels[contact.contactType] || contact.contactType}
                      </span>
                      {contact.companyName && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Building className="w-3 h-3" />{contact.companyName}
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-sm">{contact.contactName}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                      {contact.phone && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          <a href={`tel:${contact.phone}`} className="text-primary">{contact.phone}</a>
                        </span>
                      )}
                      {contact.email && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          <a href={`mailto:${contact.email}`} className="text-primary">{contact.email}</a>
                        </span>
                      )}
                      {(contact.city || contact.state) && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {[contact.city, contact.state].filter(Boolean).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(contact)} data-testid={`button-edit-contact-${contact.id}`}>
                      <Edit3 className="w-3.5 h-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" data-testid={`button-delete-contact-${contact.id}`}>
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
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingContact ? "Edit Contact" : "Add Contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Type *</label>
              <Select value={formData.contactType} onValueChange={v => updateField("contactType", v)}>
                <SelectTrigger data-testid="dialog-contact-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contact Name *</label>
              <Input value={formData.contactName} onChange={e => updateField("contactName", e.target.value)} placeholder="Full name" data-testid="dialog-contact-name" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Company Name</label>
              <Input value={formData.companyName} onChange={e => updateField("companyName", e.target.value)} placeholder="Company or business name" data-testid="dialog-company-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Phone</label>
                <Input type="tel" value={formData.phone} onChange={e => updateField("phone", e.target.value)} placeholder="801-555-0000" data-testid="dialog-phone" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Email</label>
                <Input type="email" value={formData.email} onChange={e => updateField("email", e.target.value)} placeholder="email@example.com" data-testid="dialog-email" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Address</label>
              <Input value={formData.address} onChange={e => updateField("address", e.target.value)} placeholder="Street address" data-testid="dialog-address" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">City</label>
                <Input value={formData.city} onChange={e => updateField("city", e.target.value)} placeholder="City" data-testid="dialog-city" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">State</label>
                <Input value={formData.state} onChange={e => updateField("state", e.target.value)} placeholder="UT" data-testid="dialog-state" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
              <Textarea rows={2} value={formData.notes} onChange={e => updateField("notes", e.target.value)} placeholder="Additional notes…" data-testid="dialog-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="dialog-cancel">Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="dialog-save"
            >
              {(createMutation.isPending || updateMutation.isPending) ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
