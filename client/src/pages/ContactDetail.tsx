import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { PageHero, KPICell } from "@/components/PageHero";
import { PhoneLink } from "@/components/PhoneLink";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/utils";
import { getUser } from "@/lib/auth";
import {
  Building, MapPin, Phone, Mail, FileText, ListChecks, MessageSquare,
  Edit3, Save, X, Trash2, ChevronRight, User as UserIcon,
} from "lucide-react";
import type { Contact } from "@shared/schema";

interface RelatedCall {
  id: number;
  callDate: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  manufacturer: string;
  customerName: string | null;
  jobSiteName: string | null;
  jobSiteCity: string | null;
  jobSiteState: string | null;
  status: string;
  claimStatus: string;
  hoursOnJob: string | null;
  milesTraveled: string | null;
  serviceMethod: string | null;
  productModel: string | null;
  productSerial: string | null;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  customer: { label: "Customer", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  contractor: { label: "Contractor", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  wholesaler: { label: "Wholesaler", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  site_contact: { label: "Site Contact", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
};

export default function ContactDetail({ id }: { id: string }) {
  const contactId = parseInt(id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const user = getUser();
  const isManager = user?.role === "manager";
  const canEdit = user && user.role !== "staff";

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Contact>>({});

  const { data: contact, isLoading } = useQuery<Contact>({
    queryKey: [`/api/contacts/${contactId}`],
    queryFn: async () => (await apiRequest("GET", `/api/contacts/${contactId}`)).json(),
    enabled: !!contactId,
  });

  const { data: relatedCalls } = useQuery<RelatedCall[]>({
    queryKey: [`/api/contacts/${contactId}/calls`],
    queryFn: async () => (await apiRequest("GET", `/api/contacts/${contactId}/calls`)).json(),
    enabled: !!contactId,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<Contact>) => {
      const res = await apiRequest("PATCH", `/api/contacts/${contactId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contactId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setIsEditing(false);
      toast({ title: "Saved", description: "Contact updated." });
    },
    onError: (e: any) => {
      toast({ title: "Save failed", description: e?.message || "Try again.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/contacts/${contactId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Deleted", description: "Contact removed." });
      navigate("/contacts");
    },
    onError: (e: any) => {
      toast({ title: "Delete failed", description: e?.message || "Try again.", variant: "destructive" });
    },
  });

  if (isLoading || !contact) {
    return (
      <main className="p-4 md:p-6 max-w-7xl mx-auto pb-24 md:pb-6 space-y-5">
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </main>
    );
  }

  const startEdit = () => {
    setEditForm({
      contactType: contact.contactType,
      companyName: contact.companyName,
      contactName: contact.contactName,
      phone: contact.phone,
      email: contact.email,
      address: contact.address,
      city: contact.city,
      state: contact.state,
      notes: contact.notes,
    });
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setEditForm({});
    setIsEditing(false);
  };

  const saveEdit = () => {
    updateMutation.mutate(editForm);
  };

  // KPI calculations
  const totalCalls = relatedCalls?.length || 0;
  const openCalls = relatedCalls?.filter(c => c.status !== "Completed").length || 0;
  const completedCalls = relatedCalls?.filter(c => c.status === "Completed").length || 0;
  const lastContactDate = relatedCalls && relatedCalls.length > 0
    ? formatDate(relatedCalls[0].callDate)
    : "—";
  const totalHours = relatedCalls?.reduce((s, c) => s + (parseFloat(c.hoursOnJob || "0") || 0), 0) || 0;
  const activeSince = contact.createdAt
    ? new Date(contact.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "—";

  const typeInfo = TYPE_LABELS[contact.contactType] || { label: contact.contactType, color: "bg-gray-100 text-gray-700" };

  const subtitleParts: React.ReactNode[] = [];
  if (contact.companyName && contact.companyName !== contact.contactName) {
    subtitleParts.push(<span key="co" className="flex items-center gap-1.5"><Building className="w-3.5 h-3.5" /> {contact.companyName}</span>);
  }
  if (contact.city) {
    subtitleParts.push(
      <span key="loc" className="flex items-center gap-1.5">
        <MapPin className="w-3.5 h-3.5" /> {contact.city}{contact.state ? `, ${contact.state}` : ""}
      </span>
    );
  }

  return (
    <main className="p-4 md:p-6 max-w-7xl mx-auto pb-24 md:pb-6 space-y-5">
      <PageHero
        backHref="/contacts"
        backLabel="Back to Contacts"
        title={contact.contactName}
        subtitle={subtitleParts.length > 0 ? <>{subtitleParts.map((p, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {p}{i < subtitleParts.length - 1 && <span className="text-border ml-1.5">·</span>}
          </span>
        ))}</> : null}
        badges={
          <>
            <span className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${typeInfo.color}`}>
              {typeInfo.label}
            </span>
            {contact.phone && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Phone className="w-3 h-3" /> {contact.phone}
              </span>
            )}
            {contact.email && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Mail className="w-3 h-3" /> {contact.email}
              </span>
            )}
          </>
        }
        actions={
          !isEditing ? (
            <>
              {contact.phone && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`tel:${contact.phone}`}><Phone className="w-3.5 h-3.5 mr-1.5" /> Call</a>
                </Button>
              )}
              {contact.email && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`mailto:${contact.email}`}><Mail className="w-3.5 h-3.5 mr-1.5" /> Email</a>
                </Button>
              )}
              {canEdit && (
                <Button size="sm" onClick={startEdit}>
                  <Edit3 className="w-3.5 h-3.5 mr-1.5" /> Edit
                </Button>
              )}
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={cancelEdit}>
                <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={updateMutation.isPending}>
                <Save className="w-3.5 h-3.5 mr-1.5" /> {updateMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          )
        }
        kpis={
          <>
            <KPICell label="Total Calls" value={String(totalCalls)} />
            <KPICell label="Open" value={String(openCalls)} />
            <KPICell label="Completed" value={String(completedCalls)} />
            <KPICell label="Last Contact" value={lastContactDate} />
            <KPICell label="Total Hours" value={`${totalHours.toFixed(1)}h`} />
            <KPICell label="Active Since" value={activeSince} />
          </>
        }
      />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto bg-card border border-border/50 rounded-xl p-1 h-auto flex-wrap md:flex-nowrap">
          <TabsTrigger value="overview" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 px-3 md:px-4">
            <FileText className="w-3.5 h-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="calls" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 px-3 md:px-4">
            <ListChecks className="w-3.5 h-3.5" /> Service Calls <span className="text-[10px] opacity-60">{totalCalls}</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 px-3 md:px-4">
            <MessageSquare className="w-3.5 h-3.5" /> Notes
          </TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-5 mt-5">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Contact Info */}
            <div className="bg-card rounded-xl border border-border/50 p-5 shadow-sm">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-4">Contact Information</h2>
              {!isEditing ? (
                <div className="space-y-3">
                  <DetailRow label="Type" value={typeInfo.label} />
                  <DetailRow label="Name" value={contact.contactName} />
                  <DetailRow label="Company" value={contact.companyName} />
                  <DetailRow label="Phone" value={contact.phone} isPhone />
                  <DetailRow label="Email" value={contact.email} isEmail />
                </div>
              ) : (
                <div className="space-y-3">
                  <FormRow label="Type">
                    <Select value={editForm.contactType ?? ""} onValueChange={v => setEditForm(f => ({ ...f, contactType: v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="customer">Customer</SelectItem>
                        <SelectItem value="contractor">Contractor</SelectItem>
                        <SelectItem value="wholesaler">Wholesaler</SelectItem>
                        <SelectItem value="site_contact">Site Contact</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormRow>
                  <FormRow label="Name">
                    <Input value={editForm.contactName ?? ""} onChange={e => setEditForm(f => ({ ...f, contactName: e.target.value }))} className="h-8 text-sm" />
                  </FormRow>
                  <FormRow label="Company">
                    <Input value={editForm.companyName ?? ""} onChange={e => setEditForm(f => ({ ...f, companyName: e.target.value }))} className="h-8 text-sm" />
                  </FormRow>
                  <FormRow label="Phone">
                    <Input value={editForm.phone ?? ""} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className="h-8 text-sm" />
                  </FormRow>
                  <FormRow label="Email">
                    <Input type="email" value={editForm.email ?? ""} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="h-8 text-sm" />
                  </FormRow>
                </div>
              )}
            </div>

            {/* Address */}
            <div className="bg-card rounded-xl border border-border/50 p-5 shadow-sm">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-4">Location</h2>
              {!isEditing ? (
                <div className="space-y-3">
                  <DetailRow label="Address" value={contact.address} />
                  <DetailRow label="City" value={contact.city} />
                  <DetailRow label="State" value={contact.state} />
                </div>
              ) : (
                <div className="space-y-3">
                  <FormRow label="Address">
                    <Input value={editForm.address ?? ""} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} className="h-8 text-sm" />
                  </FormRow>
                  <FormRow label="City">
                    <Input value={editForm.city ?? ""} onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))} className="h-8 text-sm" />
                  </FormRow>
                  <FormRow label="State">
                    <Input value={editForm.state ?? ""} onChange={e => setEditForm(f => ({ ...f, state: e.target.value }))} className="h-8 text-sm" />
                  </FormRow>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* SERVICE CALLS TAB */}
        <TabsContent value="calls" className="space-y-5 mt-5">
          <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-border/50">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Service Call History</h2>
            </div>
            {!relatedCalls || relatedCalls.length === 0 ? (
              <div className="p-12 text-center">
                <ListChecks className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">No service calls yet</p>
                <p className="text-xs text-muted-foreground mt-1">Calls associated with this contact will appear here.</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b border-border/50">
                    <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-5 py-2.5">Date</th>
                    <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-5 py-2.5">Customer / Site</th>
                    <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-5 py-2.5">Equipment</th>
                    <th className="text-left text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-5 py-2.5">Status</th>
                    <th className="w-10 px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {relatedCalls.map(c => (
                    <tr
                      key={c.id}
                      className="text-sm hover:bg-muted/40 cursor-pointer border-b border-border/30 last:border-0 group"
                      onClick={() => window.location.hash = `/calls/${c.id}`}
                    >
                      <td className="px-5 py-3.5 whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(c.scheduledDate || c.callDate)}
                        <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">#{c.id}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-sm">{c.customerName || c.jobSiteName || "—"}</p>
                        {c.jobSiteCity && (
                          <p className="text-xs text-muted-foreground">{c.jobSiteCity}{c.jobSiteState ? `, ${c.jobSiteState}` : ""}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-xs text-foreground">{c.manufacturer}</p>
                        {c.productModel && <p className="font-mono text-[11px] text-muted-foreground mt-0.5">{c.productModel}</p>}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-3 py-3.5 text-muted-foreground/30 group-hover:text-foreground transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* NOTES TAB */}
        <TabsContent value="notes" className="space-y-5 mt-5">
          <div className="bg-card rounded-xl border border-border/50 p-5 shadow-sm">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">Notes</h2>
            {!isEditing ? (
              contact.notes ? (
                <p className="text-sm text-foreground whitespace-pre-wrap">{contact.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">No notes yet. Click Edit to add some.</p>
              )
            ) : (
              <Textarea
                value={editForm.notes ?? ""}
                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Internal notes about this contact…"
                className="min-h-[150px] text-sm"
              />
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Danger Zone */}
      {isManager && !isEditing && (
        <div className="flex justify-end pt-2">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => {
              if (confirm(`Delete contact "${contact.contactName}"? This cannot be undone.`)) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete Contact
          </Button>
        </div>
      )}
    </main>
  );
}

function DetailRow({ label, value, isPhone, isEmail }: { label: string; value?: string | null; isPhone?: boolean; isEmail?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <div className="text-sm text-foreground">
        {value ? (
          isPhone ? <PhoneLink phone={value} /> :
          isEmail ? <a href={`mailto:${value}`} className="text-primary hover:underline">{value}</a> :
          value
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
      {children}
    </div>
  );
}
