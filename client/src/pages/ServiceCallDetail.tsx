import { useState } from "react";
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
import { MANUFACTURERS, SERVICE_STATUSES, CLAIM_STATUSES, PHOTO_TYPES } from "@shared/schema";
import type { ServiceCall, Photo, Part } from "@shared/schema";
import {
  ChevronLeft, Edit3, Save, X, Trash2, FileText, Camera, Plus, Package,
  MapPin, Phone, User, Wrench, Calendar, Hash, Building, AlertCircle, CheckCircle2,
  Image as ImageIcon
} from "lucide-react";
import { generatePDF } from "@/lib/pdf";

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

export default function ServiceCallDetail({ id }: { id: string }) {
  const callId = parseInt(id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<ServiceCallFull>>({});
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);
  const [newPhotoFiles, setNewPhotoFiles] = useState<Array<{ dataUrl: string; caption: string; photoType: string }>>([]);

  const { data: call, isLoading } = useQuery<ServiceCallFull>({
    queryKey: ["/api/service-calls", callId],
    queryFn: async () => {
      const res = await fetch(`/api/service-calls/${callId}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<ServiceCallFull>) => {
      const res = await apiRequest("PATCH", `/api/service-calls/${callId}`, data);
      return res.json();
    },
    onSuccess: async () => {
      // Upload new photos
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

  const handlePhotoAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setNewPhotoFiles(prev => [...prev, {
          dataUrl: ev.target?.result as string,
          caption: "",
          photoType: "Other",
        }]);
      };
      reader.readAsDataURL(file);
    });
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
            <div className="grid grid-cols-2 gap-3">
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
            <DetailRow label="Date" value={formatDate(call.callDate)} />
            <DetailRow label="Manufacturer" value={call.manufacturer === "Other" ? (call.manufacturerOther ?? "Other") : call.manufacturer} />
            {!isEditing ? (
              <>
                <DetailRow label="Status" value={call.status} />
                <DetailRow label="Created" value={formatDateTime(call.createdAt)} />
              </>
            ) : (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Manufacturer</label>
                <Select value={editData.manufacturer ?? call.manufacturer} onValueChange={v => setEditData(d => ({ ...d, manufacturer: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{MANUFACTURERS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
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
                {call.contactName && (
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <p className="text-sm">{call.contactName}</p>
                  </div>
                )}
                {call.contactPhone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <a href={`tel:${call.contactPhone}`} className="text-sm text-primary">{call.contactPhone}</a>
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
                  { key: "contactName", label: "Contact" },
                  { key: "contactPhone", label: "Phone" },
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

      {/* Product */}
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
                  <p className="text-xs text-muted-foreground mb-0.5">Install Date</p>
                  <p className="text-sm">{formatDate(call.installationDate)}</p>
                </div>
              </>
            ) : (
              <>
                {[
                  { key: "productModel", label: "Model #" },
                  { key: "productSerial", label: "Serial #" },
                  { key: "installationDate", label: "Install Date", type: "date" },
                ].map(({ key, label, type }) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground">{label}</label>
                    <Input
                      type={type}
                      value={(editData[key as keyof typeof editData] ?? call[key as keyof ServiceCall]) as string ?? ""}
                      onChange={e => setEditData(d => ({ ...d, [key]: e.target.value }))}
                      className="h-8 text-sm mt-0.5"
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        </CardContent>
      </Card>

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

      {/* Photos */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Photos ({call.photos.length})</CardTitle>
          {isEditing && (
            <label className="cursor-pointer">
              <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoAdd} />
              <Button type="button" variant="outline" size="sm" asChild>
                <span><Camera className="w-3.5 h-3.5 mr-1" />Add Photos</span>
              </Button>
            </label>
          )}
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
              {newPhotoFiles.map((p, i) => (
                <div key={`new-${i}`} className="relative rounded-lg overflow-hidden border border-primary/40">
                  <img src={p.dataUrl} alt="New" className="w-full aspect-square object-cover" />
                  <button
                    type="button"
                    onClick={() => setNewPhotoFiles(prev => prev.filter((_, j) => j !== i))}
                    className="absolute top-1.5 right-1.5 bg-black/60 rounded-full p-0.5 text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <div className="p-1.5 bg-background/90">
                    <select
                      value={p.photoType}
                      onChange={e => setNewPhotoFiles(prev => prev.map((ph, j) => j === i ? { ...ph, photoType: e.target.value } : ph))}
                      className="w-full text-xs border border-input rounded px-1 py-0.5 bg-background mb-1"
                    >
                      {PHOTO_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input
                      type="text"
                      value={p.caption}
                      onChange={e => setNewPhotoFiles(prev => prev.map((ph, j) => j === i ? { ...ph, caption: e.target.value } : ph))}
                      placeholder="Caption…"
                      className="w-full text-xs border border-input rounded px-1 py-0.5 bg-background"
                    />
                  </div>
                </div>
              ))}
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
