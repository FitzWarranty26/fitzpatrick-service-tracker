import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { todayISO } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { savePendingCall } from "@/lib/offline-queue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  MANUFACTURERS, SERVICE_STATUSES, CLAIM_STATUSES, PHOTO_TYPES, JOB_STATES
} from "@shared/schema";
import {
  Camera, Plus, Trash2, ChevronLeft, Upload, X, Save, WifiOff
} from "lucide-react";
import { SortablePhotoGrid } from "@/components/SortablePhotoGrid";

const formSchema = z.object({
  callDate: z.string().min(1, "Required"),
  manufacturer: z.string().min(1, "Required"),
  manufacturerOther: z.string().optional().nullable(),
  customerName: z.string().min(1, "Required"),
  jobSiteName: z.string().min(1, "Required"),
  jobSiteAddress: z.string().min(1, "Required"),
  jobSiteCity: z.string().min(1, "Required"),
  jobSiteState: z.string().min(1, "Required"),
  contactName: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),
  siteContactName: z.string().optional().nullable(),
  siteContactPhone: z.string().optional().nullable(),
  siteContactEmail: z.string().optional().nullable(),
  productModel: z.string().min(1, "Required"),
  productSerial: z.string().optional().nullable(),
  installationDate: z.string().optional().nullable(),
  issueDescription: z.string().min(1, "Required"),
  diagnosis: z.string().optional().nullable(),
  resolution: z.string().optional().nullable(),
  status: z.string().min(1),
  claimStatus: z.string().min(1),
  claimNotes: z.string().optional().nullable(),
  techNotes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

interface PhotoEntry {
  dataUrl: string;
  caption: string;
  photoType: string;
  name: string;
}

interface PartEntry {
  partNumber: string;
  partDescription: string;
  quantity: number;
  source: string;
}

export default function NewServiceCall() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [parts, setParts] = useState<PartEntry[]>([]);
  const isOnline = useOnlineStatus();
  const [savingOffline, setSavingOffline] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      callDate: todayISO(),
      manufacturer: "",
      customerName: "",
      jobSiteName: "",
      jobSiteAddress: "",
      jobSiteCity: "",
      jobSiteState: "UT",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      siteContactName: "",
      siteContactPhone: "",
      siteContactEmail: "",
      productModel: "",
      productSerial: "",
      installationDate: "",
      issueDescription: "",
      diagnosis: "",
      resolution: "",
      status: "Scheduled",
      claimStatus: "Not Filed",
      claimNotes: "",
      techNotes: "",
    },
  });

  const manufacturer = form.watch("manufacturer");

  const createMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await apiRequest("POST", "/api/service-calls", values);
      return res.json();
    },
    onSuccess: async (newCall) => {
      // Upload photos
      for (const photo of photos) {
        await apiRequest("POST", `/api/service-calls/${newCall.id}/photos`, {
          photoUrl: photo.dataUrl,
          caption: photo.caption,
          photoType: photo.photoType,
        });
      }
      // Upload parts
      for (const part of parts) {
        if (part.partNumber || part.partDescription) {
          await apiRequest("POST", `/api/service-calls/${newCall.id}/parts`, {
            partNumber: part.partNumber,
            partDescription: part.partDescription,
            quantity: part.quantity || 1,
            source: part.source,
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent"] });
      toast({ title: "Service call created", description: `Call #${newCall.id} saved.` });
      navigate(`/calls/${newCall.id}`);
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const onSubmit = async (values: FormValues) => {
    if (isOnline) {
      createMutation.mutate(values);
    } else {
      // Save to IndexedDB for later sync
      setSavingOffline(true);
      try {
        await savePendingCall({
          formData: values as unknown as Record<string, unknown>,
          photos: photos.map((p) => ({
            dataUrl: p.dataUrl,
            caption: p.caption,
            photoType: p.photoType,
          })),
          parts: parts.map((p) => ({
            partNumber: p.partNumber,
            partDescription: p.partDescription,
            quantity: p.quantity,
            source: p.source,
          })),
          savedAt: new Date().toISOString(),
        });
        toast({
          title: "Saved offline",
          description: "Will sync when back online.",
        });
        navigate("/");
      } catch (err: any) {
        toast({
          title: "Error",
          description: err?.message ?? "Failed to save offline.",
          variant: "destructive",
        });
      } finally {
        setSavingOffline(false);
      }
    }
  };

  // Photo handling — compress iPhone photos before storing
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { compressImage } = await import("@/lib/image-utils");
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      try {
        const dataUrl = await compressImage(file);
        setPhotos((prev) => [
          ...prev,
          {
            dataUrl,
            caption: "",
            photoType: "Other",
            name: file.name,
          },
        ]);
      } catch (err) {
        console.error("Failed to compress image:", err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Photo reordering/editing handled by SortablePhotoGrid component

  // Parts handling
  const addPart = () => setParts((p) => [...p, { partNumber: "", partDescription: "", quantity: 1, source: "" }]);
  const removePart = (idx: number) => setParts((p) => p.filter((_, i) => i !== idx));
  const updatePart = (idx: number, field: keyof PartEntry, value: string | number) => {
    setParts((p) => p.map((pt, i) => (i === idx ? { ...pt, [field]: value } : pt)));
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto pb-32 md:pb-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => history.back()}
          className="h-8 w-8"
          data-testid="button-back"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">New Service Call</h1>
          <p className="text-sm text-muted-foreground">Fill out all required fields</p>
        </div>
      </div>

      {!isOnline && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-4 flex items-center gap-2" data-testid="offline-banner">
          <WifiOff className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">You're offline. Service calls will be saved locally and synced when you reconnect.</p>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

          {/* ── Call Info ─────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Call Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="callDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Call Date *</FormLabel>
                    <FormControl><Input type="date" {...field} data-testid="input-call-date" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-status">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SERVICE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="manufacturer" render={({ field }) => (
                <FormItem>
                  <FormLabel>Manufacturer *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-manufacturer">
                        <SelectValue placeholder="Select manufacturer…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {MANUFACTURERS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {manufacturer === "Other" && (
                <FormField control={form.control} name="manufacturerOther" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Manufacturer Name</FormLabel>
                    <FormControl><Input placeholder="Enter manufacturer name…" {...field} value={field.value ?? ""} data-testid="input-manufacturer-other" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
            </CardContent>
          </Card>

          {/* ── Customer / Site ───────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Customer & Job Site</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="customerName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer Name *</FormLabel>
                    <FormControl><Input placeholder="e.g. Mountain West Plumbing" {...field} data-testid="input-customer-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="jobSiteName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Job Site / Project Name *</FormLabel>
                    <FormControl><Input placeholder="e.g. Riverview Apartments Phase 2" {...field} data-testid="input-job-site-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="jobSiteAddress" render={({ field }) => (
                <FormItem>
                  <FormLabel>Address *</FormLabel>
                  <FormControl><Input placeholder="Street address" {...field} data-testid="input-address" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="jobSiteCity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>City *</FormLabel>
                    <FormControl><Input placeholder="City" {...field} data-testid="input-city" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="jobSiteState" render={({ field }) => (
                  <FormItem>
                    <FormLabel>State *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-state">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="UT">Utah</SelectItem>
                        <SelectItem value="ID">Idaho</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Installing Contractor */}
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">Installing Contractor</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="contactName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl><Input placeholder="Contractor name" {...field} value={field.value ?? ""} data-testid="input-contact-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="contactPhone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl><Input type="tel" placeholder="801-555-0000" {...field} value={field.value ?? ""} data-testid="input-contact-phone" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="contactEmail" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" placeholder="email@example.com" {...field} value={field.value ?? ""} data-testid="input-contact-email" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* On-Site Contact */}
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">On-Site Contact</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="siteContactName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl><Input placeholder="Homeowner / facility contact" {...field} value={field.value ?? ""} data-testid="input-site-contact-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="siteContactPhone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl><Input type="tel" placeholder="801-555-0000" {...field} value={field.value ?? ""} data-testid="input-site-contact-phone" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="siteContactEmail" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" placeholder="email@example.com" {...field} value={field.value ?? ""} data-testid="input-site-contact-email" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          {/* ── Product Info ──────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Product Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="productModel" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model Number *</FormLabel>
                    <FormControl><Input placeholder="e.g. HVHPT-50-240-PE" {...field} data-testid="input-model" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="productSerial" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Serial Number</FormLabel>
                    <FormControl><Input placeholder="Serial number" {...field} value={field.value ?? ""} data-testid="input-serial" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="installationDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Installation Date</FormLabel>
                  <FormControl><Input type="date" {...field} value={field.value ?? ""} data-testid="input-install-date" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* ── Issue / Diagnosis ─────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Issue & Diagnosis</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="issueDescription" render={({ field }) => (
                <FormItem>
                  <FormLabel>Issue Description *</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Describe what the customer reported…"
                      {...field}
                      data-testid="textarea-issue"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="diagnosis" render={({ field }) => (
                <FormItem>
                  <FormLabel>Diagnosis</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="Tech findings…" {...field} value={field.value ?? ""} data-testid="textarea-diagnosis" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="resolution" render={({ field }) => (
                <FormItem>
                  <FormLabel>Resolution</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="What was done to resolve the issue…" {...field} value={field.value ?? ""} data-testid="textarea-resolution" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="techNotes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tech Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Additional notes…" {...field} value={field.value ?? ""} data-testid="textarea-tech-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* ── Claim Tracking ────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Warranty Claim</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="claimStatus" render={({ field }) => (
                <FormItem>
                  <FormLabel>Claim Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-claim-status">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CLAIM_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="claimNotes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Claim Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Claim reference numbers, notes…" {...field} value={field.value ?? ""} data-testid="textarea-claim-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* ── Photos ───────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Photos</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
                data-testid="input-photos"
              />
              <button
                type="button"
                className="photo-drop-zone w-full"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-add-photos"
              >
                <Camera className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                <p className="text-sm font-medium text-foreground">Tap to add photos</p>
                <p className="text-xs text-muted-foreground mt-0.5">JPG, PNG, HEIC supported</p>
              </button>

              {photos.length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground">Drag photos to reorder</p>
                  <SortablePhotoGrid photos={photos} onChange={setPhotos} />
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Parts Used ───────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Parts Used</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addPart} data-testid="button-add-part">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Part
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {parts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No parts added yet.</p>
              ) : (
                parts.map((part, idx) => (
                  <div key={idx} className="border border-border rounded-lg p-3 space-y-3" data-testid={`part-entry-${idx}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Part #{idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => removePart(idx)}
                        className="text-destructive hover:text-destructive/80"
                        data-testid={`button-remove-part-${idx}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Part #</label>
                        <Input
                          value={part.partNumber}
                          onChange={(e) => updatePart(idx, "partNumber", e.target.value)}
                          placeholder="Part number"
                          className="h-8 text-sm"
                          data-testid={`input-part-number-${idx}`}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Qty</label>
                        <Input
                          type="number"
                          min={1}
                          value={part.quantity}
                          onChange={(e) => updatePart(idx, "quantity", parseInt(e.target.value) || 1)}
                          className="h-8 text-sm"
                          data-testid={`input-part-qty-${idx}`}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                      <Input
                        value={part.partDescription}
                        onChange={(e) => updatePart(idx, "partDescription", e.target.value)}
                        placeholder="Part description"
                        className="h-8 text-sm"
                        data-testid={`input-part-desc-${idx}`}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Source</label>
                      <Input
                        value={part.source}
                        onChange={(e) => updatePart(idx, "source", e.target.value)}
                        placeholder="Where part came from"
                        className="h-8 text-sm"
                        data-testid={`input-part-source-${idx}`}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* ── Submit ───────────────────────────────────────────────── */}
          <div className="flex gap-3 pb-4">
            <Button
              type="submit"
              disabled={createMutation.isPending || savingOffline}
              className="flex-1"
              data-testid="button-submit"
            >
              {(createMutation.isPending || savingOffline) ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Saving…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Save className="w-4 h-4" />
                  {isOnline ? "Save Service Call" : "Save Offline"}
                </span>
              )}
            </Button>
          </div>

        </form>
      </Form>
    </div>
  );
}
