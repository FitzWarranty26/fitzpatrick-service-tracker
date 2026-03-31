import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { formatDate, formatDateTime } from "@/lib/utils";
import { StatusBadge, ClaimBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { MANUFACTURERS, SERVICE_STATUSES, CLAIM_STATUSES, PHOTO_TYPES, PRODUCT_TYPES, getWarrantyStatus } from "@shared/schema";
import type { ServiceCall, Photo, Part, Contact } from "@shared/schema";
import {
  ChevronLeft, Edit3, Save, X, Trash2, FileText, Camera, Plus, Package,
  MapPin, Phone, User, Wrench, Calendar, Hash, Building, AlertCircle, CheckCircle2,
  Image as ImageIcon, Mail, Loader2, Clock, Car, CornerDownRight, Shield, ShieldAlert, ShieldQuestion
} from "lucide-react";
import { generatePDF } from "@/lib/pdf";
import { SortablePhotoGrid } from "@/components/SortablePhotoGrid";

interface ServiceCallFull extends ServiceCall {
  photos: Photo[];
  parts: Part[];
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}

// Contact suggest hook for edit mode
function useContactSuggest(type: string, query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!enabled || !query || query.length < 2) {
      setSuggestions([]);
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await apiRequest("GET", `/api/contacts/suggest?type=${encodeURIComponent(type)}&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setSuggestions(data);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [type, query, enabled]);

  return { suggestions, clear: () => setSuggestions([]) };
}

function SuggestDropdown({ suggestions, onSelect, onClose }: {
  suggestions: Contact[];
  onSelect: (c: Contact) => void;
  onClose: () => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-48 overflow-y-auto" data-testid="suggest-dropdown">
      {suggestions.map(c => (
        <button
          key={c.id}
          type="button"
          className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
          onClick={() => { onSelect(c); onClose(); }}
        >
          <span className="font-medium">{c.contactName}</span>
          {c.companyName && <span className="text-muted-foreground ml-1">({c.companyName})</span>}
        </button>
      ))}
    </div>
  );
}

function WarrantyBadge({ installationDate, manufacturer, productType }: { installationDate: string | null | undefined; manufacturer: string; productType?: string | null }) {
  const warranty = getWarrantyStatus(installationDate, manufacturer, productType);

  if (warranty.status === "unknown") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" data-testid="warranty-badge-unknown">
        <ShieldQuestion className="w-3 h-3" /> Unknown
      </span>
    );
  }

  if (warranty.status === "in-warranty") {
    const expDate = warranty.expiresDate ? new Date(warranty.expiresDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" data-testid="warranty-badge-in">
        <Shield className="w-3 h-3" /> In Warranty
        {expDate && <span className="text-green-600 dark:text-green-500">(expires {expDate})</span>}
      </span>
    );
  }

  const expDate = warranty.expiresDate ? new Date(warranty.expiresDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" data-testid="warranty-badge-out">
      <ShieldAlert className="w-3 h-3" /> Out of Warranty
      {expDate && <span className="text-red-600 dark:text-red-500">(expired {expDate})</span>}
    </span>
  );
}

export default function ServiceCallDetail({ id }: { id: string }) {
  const callId = parseInt(id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<ServiceCallFull>>({});
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);
  const [newPhotoFiles, setNewPhotoFiles] = useState<Array<{ photoUrl: string; caption: string; photoType: string }>>([]);

  // Contact suggest state for edit mode
  const [showContractorSuggest, setShowContractorSuggest] = useState(false);
  const [showSiteContactSuggest, setShowSiteContactSuggest] = useState(false);

  const contractorSuggest = useContactSuggest(
    "contractor",
    (editData.contactName ?? "") as string,
    isEditing && showContractorSuggest
  );
  const siteContactSuggest = useContactSuggest(
    "site_contact",
    (editData.siteContactName ?? "") as string,
    isEditing && showSiteContactSuggest
  );

  const { data: call, isLoading } = useQuery<ServiceCallFull>({
    queryKey: ["/api/service-calls", callId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/service-calls/${callId}`);
      return res.json();
    },
  });

  // Fetch related calls for visit history
  const { data: relatedCalls } = useQuery<ServiceCall[]>({
    queryKey: ["/api/service-calls", callId, "related"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/service-calls/${callId}/related`);
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<ServiceCallFull>) => {
      const res = await apiRequest("PATCH", `/api/service-calls/${callId}`, data);
      return res.json();
    },
    onSuccess: async () => {
      for (const p of newPhotoFiles) {
        await apiRequest("POST", `/api/service-calls/${callId}/photos`, p);
      }
      setNewPhotoFiles([]);
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent"] });
      setIsEditing(false);
      toast({ title: "Saved", description: "Service call updated." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deletePhotoMutation = useMutation({
    mutationFn: (photoId: number) => apiRequest("DELETE", `/api/photos/${photoId}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
    },
  });

  const deleteCallMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/service-calls/${callId}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent"] });
      toast({ title: "Deleted", description: "Service call deleted." });
      navigate("/calls");
    },
  });

  const startEdit = () => {
    if (!call) return;
    setEditData({ ...call });
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditData({});
    setNewPhotoFiles([]);
  };

  const saveEdit = () => {
    const { photos: _p, parts: _pt, ...updateFields } = editData as any;
    updateMutation.mutate(updateFields);
  };

  const handlePhotoAddForEdit = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { compressImage } = await import("@/lib/image-utils");
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      try {
        const dataUrl = await compressImage(file);
        setNewPhotoFiles(prev => [...prev, { photoUrl: dataUrl, caption: "", photoType: "Other" }]);
      } catch (err) {
        console.error("Failed to compress image:", err);
      }
    }
  };

  const [isUploading, setIsUploading] = useState(false);
  const directPhotoInputRef = useRef<HTMLInputElement>(null);

  const handleDirectPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!call) return;
    const { compressImage } = await import("@/lib/image-utils");
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setIsUploading(true);
    let uploaded = 0;
    for (const file of files) {
      try {
        const dataUrl = await compressImage(file);
        await apiRequest("POST", `/api/service-calls/${call.id}/photos`, { photoUrl: dataUrl, caption: "", photoType: "Other" });
        uploaded++;
      } catch (err) {
        console.error("Failed to upload photo:", err);
      }
    }
    setIsUploading(false);
    if (directPhotoInputRef.current) directPhotoInputRef.current.value = "";
    queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
    toast({ title: "Photos added", description: `${uploaded} photo${uploaded !== 1 ? "s" : ""} uploaded.` });
  };

  const handlePDF = async () => {
    if (!call) return;
    try {
      await generatePDF(call);
      toast({ title: "PDF Generated", description: "Check your downloads folder." });
    } catch (e: any) {
      toast({ title: "PDF Error", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!call) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Service call not found.</p>
        <Button asChild size="sm" className="mt-4"><Link href="/calls">Back to list</Link></Button>
      </div>
    );
  }

  const displayCall = isEditing ? { ...call, ...editData } : call;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto pb-32 md:pb-10 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 mt-0.5" onClick={() => navigate("/calls")} data-testid="button-back">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-xl font-bold truncate">Call #{call.id} — {call.customerName}</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={displayCall.status ?? call.status} />
            <ClaimBadge status={displayCall.claimStatus ?? call.claimStatus} />
            <span className="text-xs text-muted-foreground">{formatDate(call.callDate)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isEditing ? (
            <>
              <Button variant="outline" size="sm" onClick={() => navigate(`/new/followup/${call.id}`)} data-testid="button-create-followup">
                <CornerDownRight className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">Follow-up</span>
              </Button>
              <Button variant="outline" size="sm" onClick={handlePDF} data-testid="button-generate-pdf">
                <FileText className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">PDF</span>
              </Button>
              <Button size="sm" onClick={startEdit} data-testid="button-edit">
                <Edit3 className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={cancelEdit} data-testid="button-cancel-edit">
                <X className="w-4 h-4 mr-1.5" />Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={updateMutation.isPending} data-testid="button-save-edit">
                <Save className="w-4 h-4 mr-1.5" />
                {updateMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Status / Claim (editable) */}
      {isEditing && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <Select
                  value={editData.status ?? call.status}
                  onValueChange={v => setEditData(d => ({ ...d, status: v }))}
                >
                  <SelectTrigger className="h-8 text-sm" data-testid="edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Claim Status</label>
                <Select
                  value={editData.claimStatus ?? call.claimStatus}
                  onValueChange={v => setEditData(d => ({ ...d, claimStatus: v }))}
                >
                  <SelectTrigger className="h-8 text-sm" data-testid="edit-claim-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAIM_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Info */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Call Info */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Call Information</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!isEditing ? (
              <>
                <DetailRow label="Date" value={formatDate(call.callDate)} />
                <DetailRow label="Manufacturer" value={call.manufacturer === "Other" ? (call.manufacturerOther ?? "Other") : call.manufacturer} />
                <DetailRow label="Status" value={call.status} />
                <DetailRow label="Created" value={formatDateTime(call.createdAt)} />
              </>
            ) : (
              <>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Call Date</label>
                  <Input
                    type="date"
                    value={(editData.callDate ?? call.callDate) as string}
                    onChange={e => setEditData(d => ({ ...d, callDate: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Manufacturer</label>
                  <Select value={editData.manufacturer ?? call.manufacturer} onValueChange={v => setEditData(d => ({ ...d, manufacturer: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{MANUFACTURERS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <DetailRow label="Created" value={formatDateTime(call.createdAt)} />
              </>
            )}
          </CardContent>
        </Card>

        {/* Customer & Site */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Customer & Site</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!isEditing ? (
              <>
                <div className="flex items-start gap-2">
                  <Building className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{call.customerName}</p>
                    <p className="text-xs text-muted-foreground">{call.jobSiteName}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <p className="text-sm">{call.jobSiteAddress}, {call.jobSiteCity}, {call.jobSiteState}</p>
                </div>
                {(call.contactName || call.contactPhone || call.contactEmail) && (
                  <div className="pt-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Installing Contractor</p>
                    {call.contactName && (
                      <div className="flex items-center gap-2 mb-1">
                        <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <p className="text-sm">{call.contactName}</p>
                      </div>
                    )}
                    {call.contactPhone && (
                      <div className="flex items-center gap-2 mb-1">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <a href={`tel:${call.contactPhone}`} className="text-sm text-primary">{call.contactPhone}</a>
                      </div>
                    )}
                    {call.contactEmail && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <a href={`mailto:${call.contactEmail}`} className="text-sm text-primary">{call.contactEmail}</a>
                      </div>
                    )}
                  </div>
                )}
                {(call.siteContactName || call.siteContactPhone || call.siteContactEmail) && (
                  <div className="pt-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">On-Site Contact</p>
                    {call.siteContactName && (
                      <div className="flex items-center gap-2 mb-1">
                        <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <p className="text-sm">{call.siteContactName}</p>
                      </div>
                    )}
                    {call.siteContactPhone && (
                      <div className="flex items-center gap-2 mb-1">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <a href={`tel:${call.siteContactPhone}`} className="text-sm text-primary">{call.siteContactPhone}</a>
                      </div>
                    )}
                    {call.siteContactEmail && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <a href={`mailto:${call.siteContactEmail}`} className="text-sm text-primary">{call.siteContactEmail}</a>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-2">
                {[
                  { key: "customerName", label: "Customer" },
                  { key: "jobSiteName", label: "Site Name" },
                  { key: "jobSiteAddress", label: "Address" },
                  { key: "jobSiteCity", label: "City" },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground">{label}</label>
                    <Input
                      value={(editData[key as keyof typeof editData] ?? call[key as keyof ServiceCall]) as string ?? ""}
                      onChange={e => setEditData(d => ({ ...d, [key]: e.target.value }))}
                      className="h-8 text-sm mt-0.5"
                    />
                  </div>
                ))}
                {/* Contractor fields with suggest */}
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-1">Installing Contractor</p>
                <div className="relative">
                  <label className="text-xs text-muted-foreground">Contractor Name</label>
                  <Input
                    value={(editData.contactName ?? call.contactName) as string ?? ""}
                    onChange={e => setEditData(d => ({ ...d, contactName: e.target.value }))}
                    onFocus={() => setShowContractorSuggest(true)}
                    onBlur={() => setTimeout(() => setShowContractorSuggest(false), 200)}
                    className="h-8 text-sm mt-0.5"
                  />
                  <SuggestDropdown
                    suggestions={contractorSuggest.suggestions}
                    onSelect={(c) => {
                      setEditData(d => ({ ...d, contactName: c.contactName, contactPhone: c.phone ?? "", contactEmail: c.email ?? "" }));
                    }}
                    onClose={() => { setShowContractorSuggest(false); contractorSuggest.clear(); }}
                  />
                </div>
                {[
                  { key: "contactPhone", label: "Contractor Phone" },
                  { key: "contactEmail", label: "Contractor Email" },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground">{label}</label>
                    <Input
                      value={(editData[key as keyof typeof editData] ?? call[key as keyof ServiceCall]) as string ?? ""}
                      onChange={e => setEditData(d => ({ ...d, [key]: e.target.value }))}
                      className="h-8 text-sm mt-0.5"
                    />
                  </div>
                ))}
                {/* Site contact fields with suggest */}
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-1">On-Site Contact</p>
                <div className="relative">
                  <label className="text-xs text-muted-foreground">Site Contact Name</label>
                  <Input
                    value={(editData.siteContactName ?? call.siteContactName) as string ?? ""}
                    onChange={e => setEditData(d => ({ ...d, siteContactName: e.target.value }))}
                    onFocus={() => setShowSiteContactSuggest(true)}
                    onBlur={() => setTimeout(() => setShowSiteContactSuggest(false), 200)}
                    className="h-8 text-sm mt-0.5"
                  />
                  <SuggestDropdown
                    suggestions={siteContactSuggest.suggestions}
                    onSelect={(c) => {
                      setEditData(d => ({ ...d, siteContactName: c.contactName, siteContactPhone: c.phone ?? "", siteContactEmail: c.email ?? "" }));
                    }}
                    onClose={() => { setShowSiteContactSuggest(false); siteContactSuggest.clear(); }}
                  />
                </div>
                {[
                  { key: "siteContactPhone", label: "Site Contact Phone" },
                  { key: "siteContactEmail", label: "Site Contact Email" },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground">{label}</label>
                    <Input
                      value={(editData[key as keyof typeof editData] ?? call[key as keyof ServiceCall]) as string ?? ""}
                      onChange={e => setEditData(d => ({ ...d, [key]: e.target.value }))}
                      className="h-8 text-sm mt-0.5"
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Scheduling */}
      {(call.scheduledDate || call.scheduledTime || isEditing) && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Scheduling</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {!isEditing ? (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Scheduled Date</p>
                    <p className="text-sm">{call.scheduledDate ? formatDate(call.scheduledDate) : "\u2014"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Scheduled Time</p>
                    <p className="text-sm">{call.scheduledTime || "\u2014"}</p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Scheduled Date</label>
                    <Input
                      type="date"
                      value={(editData.scheduledDate ?? call.scheduledDate ?? "") as string}
                      onChange={e => setEditData(d => ({ ...d, scheduledDate: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Scheduled Time (approx.)</label>
                    <Input
                      type="time"
                      value={(editData.scheduledTime ?? call.scheduledTime ?? "") as string}
                      onChange={e => setEditData(d => ({ ...d, scheduledTime: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Product with Warranty Badge */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Product</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {!isEditing ? (
              <>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Model Number</p>
                  <p className="text-sm font-mono font-medium">{call.productModel}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Serial Number</p>
                  <p className="text-sm font-mono">{call.productSerial || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Product Type</p>
                  <p className="text-sm">{call.productType || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Install Date</p>
                  <p className="text-sm">{formatDate(call.installationDate)}</p>
                  <div className="mt-1">
                    <WarrantyBadge installationDate={call.installationDate} manufacturer={call.manufacturer} productType={call.productType} />
                  </div>
                </div>
              </>
            ) : (
              <>
                {[
                  { key: "productModel", label: "Model #" },
                  { key: "productSerial", label: "Serial #" },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground">{label}</label>
                    <Input
                      value={(editData[key as keyof typeof editData] ?? call[key as keyof ServiceCall]) as string ?? ""}
                      onChange={e => setEditData(d => ({ ...d, [key]: e.target.value }))}
                      className="h-8 text-sm mt-0.5"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-muted-foreground">Product Type</label>
                  <Select
                    value={(editData.productType ?? call.productType) || "__none__"}
                    onValueChange={v => setEditData(d => ({ ...d, productType: v === "__none__" ? "" : v }))}
                  >
                    <SelectTrigger className="h-8 text-sm mt-0.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Not specified</SelectItem>
                      {PRODUCT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Install Date</label>
                  <Input
                    type="date"
                    value={(editData.installationDate ?? call.installationDate ?? "") as string}
                    onChange={e => setEditData(d => ({ ...d, installationDate: e.target.value }))}
                    className="h-8 text-sm mt-0.5"
                  />
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Job Logistics */}
      {(call.hoursOnJob || call.milesTraveled || isEditing) && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Job Logistics</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {!isEditing ? (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Hours on Job</p>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <p className="text-sm font-medium">{call.hoursOnJob ? `${call.hoursOnJob} hrs` : "\u2014"}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Miles Traveled</p>
                    <div className="flex items-center gap-1.5">
                      <Car className="w-3.5 h-3.5 text-muted-foreground" />
                      <p className="text-sm font-medium">{call.milesTraveled ? `${call.milesTraveled} mi` : "\u2014"}</p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Hours on Job</label>
                    <Input
                      type="number" step="0.25" min="0" placeholder="e.g. 2.5"
                      value={(editData.hoursOnJob ?? call.hoursOnJob ?? "") as string}
                      onChange={e => setEditData(d => ({ ...d, hoursOnJob: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Miles Traveled</label>
                    <Input
                      type="number" step="1" min="0" placeholder="e.g. 45"
                      value={(editData.milesTraveled ?? call.milesTraveled ?? "") as string}
                      onChange={e => setEditData(d => ({ ...d, milesTraveled: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Issue / Diagnosis / Resolution */}
      {(["issueDescription", "diagnosis", "resolution", "techNotes"] as const).map((field) => {
        const labels: Record<string, string> = {
          issueDescription: "Issue Description",
          diagnosis: "Diagnosis",
          resolution: "Resolution",
          techNotes: "Tech Notes",
        };
        const value = call[field];
        if (!isEditing && !value) return null;
        return (
          <Card key={field}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {labels[field]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!isEditing ? (
                <p className="text-sm text-foreground whitespace-pre-wrap">{value}</p>
              ) : (
                <Textarea
                  rows={3}
                  value={(editData[field] ?? call[field]) as string ?? ""}
                  onChange={e => setEditData(d => ({ ...d, [field]: e.target.value }))}
                  className="text-sm"
                  data-testid={`edit-${field}`}
                />
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Claim Tracking */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Warranty Claim</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <ClaimBadge status={displayCall.claimStatus ?? call.claimStatus} />
            {(displayCall.claimStatus === "Approved") && <CheckCircle2 className="w-4 h-4 text-green-500" />}
            {(displayCall.claimStatus === "Denied") && <AlertCircle className="w-4 h-4 text-red-500" />}
          </div>
          {!isEditing ? (
            call.claimNotes ? <p className="text-sm text-foreground whitespace-pre-wrap">{call.claimNotes}</p> : <p className="text-sm text-muted-foreground">No claim notes.</p>
          ) : (
            <Textarea
              rows={2}
              value={(editData.claimNotes ?? call.claimNotes) as string ?? ""}
              onChange={e => setEditData(d => ({ ...d, claimNotes: e.target.value }))}
              placeholder="Claim reference numbers, notes…"
              className="text-sm"
              data-testid="edit-claim-notes"
            />
          )}
        </CardContent>
      </Card>

      {/* Visit History (Follow-up chain) */}
      {relatedCalls && relatedCalls.length > 0 && (
        <Card data-testid="visit-history-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Visit History</CardTitle>
          </CardHeader>
          <CardContent>
            {call.parentCallId && (
              <p className="text-xs text-muted-foreground mb-3">
                Follow-up to{" "}
                <Link href={`/calls/${call.parentCallId}`} className="text-primary font-medium underline" data-testid="parent-call-link">
                  Call #{call.parentCallId}
                </Link>
              </p>
            )}
            <div className="space-y-2">
              {relatedCalls.map((rc) => {
                const isCurrent = rc.id === callId;
                return (
                  <div
                    key={rc.id}
                    className={`flex items-center gap-3 p-2 rounded-lg text-sm ${isCurrent ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/30"}`}
                    data-testid={`visit-${rc.id}`}
                  >
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: isCurrent ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {isCurrent ? (
                          <span className="font-medium">Call #{rc.id} (current)</span>
                        ) : (
                          <Link href={`/calls/${rc.id}`} className="font-medium text-primary hover:underline">
                            Call #{rc.id}
                          </Link>
                        )}
                        <StatusBadge status={rc.status} />
                        <span className="text-xs text-muted-foreground">{formatDate(rc.callDate)}</span>
                      </div>
                      {rc.issueDescription && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{rc.issueDescription.slice(0, 80)}{rc.issueDescription.length > 80 ? "…" : ""}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Photos */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Photos ({call.photos.length})</CardTitle>
          <div className="flex items-center gap-2">
            {isUploading && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Uploading…
              </div>
            )}
            {isEditing ? (
              <label className="cursor-pointer">
                <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoAddForEdit} />
                <Button type="button" variant="outline" size="sm" asChild>
                  <span><Camera className="w-3.5 h-3.5 mr-1" />Add Photos</span>
                </Button>
              </label>
            ) : (
              <>
                <input
                  ref={directPhotoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleDirectPhotoUpload}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUploading}
                  onClick={() => directPhotoInputRef.current?.click()}
                  data-testid="button-add-photos-direct"
                >
                  <Camera className="w-3.5 h-3.5 mr-1" />Add Photos
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {call.photos.length === 0 && newPhotoFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No photos attached.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {call.photos.map((photo) => (
                <div
                  key={photo.id}
                  className="relative rounded-lg overflow-hidden border border-border cursor-pointer group"
                  onClick={() => !isEditing && setLightboxPhoto(photo)}
                  data-testid={`photo-${photo.id}`}
                >
                  <img src={photo.photoUrl} alt={photo.caption || "Photo"} className="w-full aspect-square object-cover group-hover:opacity-90 transition-opacity" />
                  {isEditing && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); deletePhotoMutation.mutate(photo.id); }}
                      className="absolute top-1.5 right-1.5 bg-black/60 rounded-full p-0.5 text-white"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <div className="p-1.5 bg-background/90">
                    <p className="text-[10px] font-medium text-muted-foreground">{photo.photoType}</p>
                    {photo.caption && <p className="text-xs text-foreground truncate">{photo.caption}</p>}
                  </div>
                </div>
              ))}
              {newPhotoFiles.length > 0 && (
                <SortablePhotoGrid photos={newPhotoFiles} onChange={setNewPhotoFiles} />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Parts Used */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Parts Used ({call.parts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {call.parts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No parts logged.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-xs font-medium text-muted-foreground">Part #</th>
                    <th className="text-left py-2 text-xs font-medium text-muted-foreground">Description</th>
                    <th className="text-center py-2 text-xs font-medium text-muted-foreground">Qty</th>
                    <th className="text-left py-2 text-xs font-medium text-muted-foreground">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {call.parts.map((part) => (
                    <tr key={part.id} className="border-b border-border last:border-0" data-testid={`part-row-${part.id}`}>
                      <td className="py-2 pr-3 font-mono text-xs">{part.partNumber}</td>
                      <td className="py-2 pr-3">{part.partDescription}</td>
                      <td className="py-2 pr-3 text-center">{part.quantity}</td>
                      <td className="py-2 text-muted-foreground text-xs">{part.source || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      {!isEditing && (
        <div className="flex justify-end pt-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" data-testid="button-delete">
                <Trash2 className="w-4 h-4 mr-1.5" />Delete Call
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Service Call?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete Call #{call.id} and all associated photos and parts. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteCallMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-confirm-delete"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxPhoto(null)}
          data-testid="photo-lightbox"
        >
          <div className="max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <img src={lightboxPhoto.photoUrl} alt={lightboxPhoto.caption || "Photo"} className="w-full max-h-[80vh] object-contain rounded-lg" />
            {lightboxPhoto.caption && (
              <p className="text-center text-white mt-3 text-sm">{lightboxPhoto.caption}</p>
            )}
            <p className="text-center text-white/60 text-xs mt-1">{lightboxPhoto.photoType}</p>
          </div>
          <button
            onClick={() => setLightboxPhoto(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
}
