import { useState, useRef, useEffect } from "react";
import { useLocation, Link, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { getUser } from "@/lib/auth";
import { PageHero } from "@/components/PageHero";
import { todayISO } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { savePendingCall } from "@/lib/offline-queue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  MANUFACTURERS, SERVICE_STATUSES, CLAIM_STATUSES, PRODUCT_TYPES
} from "@shared/schema";
import type { ServiceCall, Contact } from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Camera, Plus, Trash2, ChevronLeft, Save, WifiOff, ArrowLeft, UserPlus, X, FilePlus
} from "lucide-react";
import { SortablePhotoGrid } from "@/components/SortablePhotoGrid";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

const formSchema = z.object({
  callType: z.string().default("residential"),
  serviceMethod: z.string().default("In-Person"),
  callDate: z.string().min(1, "Required"),
  manufacturer: z.string().min(1, "Required"),
  manufacturerOther: z.string().optional().nullable(),
  customerName: z.string().optional().nullable(),
  jobSiteName: z.string().optional().nullable(),
  jobSiteAddress: z.string().optional().nullable(),
  jobSiteCity: z.string().optional().nullable(),
  jobSiteState: z.string().optional().nullable(),
  jobSiteZip: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactCompany: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),
  siteContactName: z.string().optional().nullable(),
  siteContactPhone: z.string().optional().nullable(),
  siteContactEmail: z.string().optional().nullable(),
  productModel: z.string().optional().nullable(),
  productSerial: z.string().optional().nullable(),
  productType: z.string().optional().nullable(),
  installationDate: z.string().optional().nullable(),
  issueDescription: z.string().optional().nullable(),
  diagnosis: z.string().optional().nullable(),
  resolution: z.string().optional().nullable(),
  status: z.string().min(1),
  claimStatus: z.string().min(1),
  claimNotes: z.string().optional().nullable(),
  claimNumber: z.string().optional().nullable(),
  partsCost: z.string().optional().nullable(),
  laborCost: z.string().optional().nullable(),
  otherCost: z.string().optional().nullable(),
  claimAmount: z.string().optional().nullable(),
  techNotes: z.string().optional().nullable(),
  hoursOnJob: z.string().optional().nullable(),
  milesTraveled: z.string().optional().nullable(),
  scheduledDate: z.string().optional().nullable(),
  scheduledTime: z.string().optional().nullable(),
  followUpDate: z.string().optional().nullable(),
  parentCallId: z.number().optional().nullable(),
  wholesalerName: z.string().optional().nullable(),
  wholesalerPhone: z.string().optional().nullable(),
  isTest: z.number().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface PhotoEntry {
  photoUrl: string;
  caption: string;
  photoType: string;
  name?: string;
}

interface PartEntry {
  partNumber: string;
  partDescription: string;
  quantity: number;
  source: string;
}

// Simple contact suggest hook with debounce
function useContactSuggest(type: string, query: string) {
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!query || query.length < 2) {
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
  }, [type, query]);

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
          data-testid={`suggest-item-${c.id}`}
        >
          <span className="font-medium">{c.companyName || c.contactName}</span>
          {c.companyName && <span className="text-muted-foreground ml-1">— {c.contactName}</span>}
        </button>
      ))}
    </div>
  );
}

export default function NewServiceCall({ followUpId: followUpIdProp }: { followUpId?: string }) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [parts, setParts] = useState<PartEntry[]>([]);
  const isOnline = useOnlineStatus();
  const [savingOffline, setSavingOffline] = useState(false);

  const searchParams = new URLSearchParams(search || "");
  const copyFromId = searchParams.get("copyFrom") ? parseInt(searchParams.get("copyFrom")!) : null;
  const followUpId = followUpIdProp ? parseInt(followUpIdProp) : null;
  const currentUser = getUser();
  const [createdBy, setCreatedBy] = useState<number | string>(currentUser?.id ?? "");
  const [createdByError, setCreatedByError] = useState("");

  // Fetch wholesalers for dropdown
  const { data: wholesalers = [] } = useQuery<{ id: number; companyName: string; contactName: string; phone: string | null }[]>({
    queryKey: ["/api/contacts", "wholesalers"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/contacts?type=wholesaler");
      return res.json();
    },
  });

  // Fetch team members for "Created By" dropdown
  const { data: teamMembers = [] } = useQuery<{ id: number; displayName: string; role: string }[]>({
    queryKey: ["/api/users/names"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/users/names");
      return res.json();
    },
  });

  // Fetch parent call data for follow-up
  const { data: parentCall } = useQuery<ServiceCall & { photos: any[]; parts: any[] }>({
    queryKey: ["/api/service-calls", followUpId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/service-calls/${followUpId}`);
      return res.json();
    },
    enabled: !!followUpId,
  });

  // Fetch source call data for copyFrom (New Issue)
  const { data: copyFromCall } = useQuery<ServiceCall & { photos: any[]; parts: any[] }>({
    queryKey: ["/api/service-calls", copyFromId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/service-calls/${copyFromId}`);
      return res.json();
    },
    enabled: !!copyFromId && !followUpId,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      callType: "residential",
      serviceMethod: "In-Person",
      callDate: todayISO(),
      manufacturer: "",
      customerName: "",
      jobSiteName: "",
      jobSiteAddress: "",
      jobSiteCity: "",
      jobSiteState: "",
      jobSiteZip: "",
      contactName: "",
      contactCompany: "",
      contactPhone: "",
      contactEmail: "",
      siteContactName: "",
      siteContactPhone: "",
      siteContactEmail: "",
      productModel: "",
      productSerial: "",
      productType: "",
      installationDate: "",
      issueDescription: "",
      diagnosis: "",
      resolution: "",
      status: "Scheduled",
      claimStatus: "Not Filed",
      claimNotes: "",
      claimNumber: "",
      partsCost: "",
      laborCost: "",
      otherCost: "",
      claimAmount: "",
      techNotes: "",
      hoursOnJob: "",
      milesTraveled: "",
      scheduledDate: "",
      scheduledTime: "",
      followUpDate: "",
      parentCallId: null,
      wholesalerName: "",
      wholesalerPhone: "",
      isTest: 0,
    },
  });

  // Pre-fill from parent call when it loads
  useEffect(() => {
    if (parentCall && followUpId) {
      form.reset({
        ...form.getValues(),
        customerName: parentCall.customerName,
        jobSiteName: parentCall.jobSiteName,
        jobSiteAddress: parentCall.jobSiteAddress,
        jobSiteCity: parentCall.jobSiteCity,
        jobSiteState: parentCall.jobSiteState,
        jobSiteZip: parentCall.jobSiteZip ?? "",
        contactName: parentCall.contactName ?? "",
        contactCompany: parentCall.contactCompany ?? "",
        contactPhone: parentCall.contactPhone ?? "",
        contactEmail: parentCall.contactEmail ?? "",
        siteContactName: parentCall.siteContactName ?? "",
        siteContactPhone: parentCall.siteContactPhone ?? "",
        siteContactEmail: parentCall.siteContactEmail ?? "",
        manufacturer: parentCall.manufacturer,
        manufacturerOther: parentCall.manufacturerOther ?? "",
        productModel: parentCall.productModel,
        productSerial: parentCall.productSerial ?? "",
        productType: parentCall.productType ?? "",
        installationDate: parentCall.installationDate ?? "",
        parentCallId: followUpId,
      });
    }
  }, [parentCall, followUpId]);

  // Pre-fill from source call for "New Issue" (copyFrom)
  useEffect(() => {
    if (copyFromCall && copyFromId && !followUpId) {
      form.setValue("customerName", copyFromCall.customerName ?? "");
      form.setValue("jobSiteName", copyFromCall.jobSiteName ?? "");
      form.setValue("jobSiteAddress", copyFromCall.jobSiteAddress ?? "");
      form.setValue("jobSiteCity", copyFromCall.jobSiteCity ?? "");
      form.setValue("jobSiteState", copyFromCall.jobSiteState ?? "");
      form.setValue("jobSiteZip", copyFromCall.jobSiteZip ?? "");
      if (copyFromCall.callType) form.setValue("callType", copyFromCall.callType);
      if (copyFromCall.serviceMethod) form.setValue("serviceMethod", copyFromCall.serviceMethod);
      form.setValue("contactName", copyFromCall.contactName ?? "");
      form.setValue("contactCompany", copyFromCall.contactCompany ?? "");
      form.setValue("contactPhone", copyFromCall.contactPhone ?? "");
      form.setValue("contactEmail", copyFromCall.contactEmail ?? "");
      form.setValue("siteContactName", copyFromCall.siteContactName ?? "");
      form.setValue("siteContactPhone", copyFromCall.siteContactPhone ?? "");
      form.setValue("siteContactEmail", copyFromCall.siteContactEmail ?? "");
      form.setValue("manufacturer", copyFromCall.manufacturer ?? "");
      form.setValue("wholesalerName", copyFromCall.wholesalerName ?? "");
      form.setValue("wholesalerPhone", copyFromCall.wholesalerPhone ?? "");
      form.setValue("productModel", copyFromCall.productModel ?? "");
      form.setValue("productSerial", copyFromCall.productSerial ?? "");
      form.setValue("productType", copyFromCall.productType ?? "");
      form.setValue("installationDate", copyFromCall.installationDate ?? "");
      // Do NOT copy: callDate (defaults to today), status (defaults to Scheduled),
      // notes, techNotes, diagnosis, resolution, hoursOnJob, milesTraveled,
      // scheduledDate, scheduledTime, parentCallId
    }
  }, [copyFromCall, copyFromId, followUpId]);

  const manufacturer = form.watch("manufacturer");

  // Contact auto-suggest state
  const customerNameValue = form.watch("customerName");
  const contractorNameValue = form.watch("contactName");
  const siteContactNameValue = form.watch("siteContactName");
  const [showCustomerSuggest, setShowCustomerSuggest] = useState(false);
  const [showContractorSuggest, setShowContractorSuggest] = useState(false);
  const [showSiteContactSuggest, setShowSiteContactSuggest] = useState(false);

  const customerSuggest = useContactSuggest("customer", showCustomerSuggest ? (customerNameValue ?? "") : "");
  const contractorSuggest = useContactSuggest("contractor", showContractorSuggest ? (contractorNameValue ?? "") : "");
  const siteContactSuggest = useContactSuggest("site_contact", showSiteContactSuggest ? (siteContactNameValue ?? "") : "");

  const createMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await apiRequest("POST", "/api/service-calls", {
        ...values,
        createdBy: createdBy !== "" ? Number(createdBy) : null,
      });
      return res.json();
    },
    onSuccess: async (newCall) => {
      // Upload photos
      for (const photo of photos) {
        await apiRequest("POST", `/api/service-calls/${newCall.id}/photos`, {
          photoUrl: photo.photoUrl,
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
    if (!createdBy) {
      setCreatedByError("Please select who created this call");
      return;
    }
    setCreatedByError("");
    if (isOnline) {
      createMutation.mutate(values);
    } else {
      setSavingOffline(true);
      try {
        await savePendingCall({
          formData: values as unknown as Record<string, unknown>,
          photos: photos.map((p) => ({
            photoUrl: p.photoUrl,
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
        toast({ title: "Saved offline", description: "Will sync when back online." });
        navigate("/");
      } catch (err: any) {
        toast({ title: "Error", description: err?.message ?? "Failed to save offline.", variant: "destructive" });
      } finally {
        setSavingOffline(false);
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { compressImage } = await import("@/lib/image-utils");
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      try {
        const dataUrl = await compressImage(file);
        setPhotos((prev) => [...prev, { photoUrl: dataUrl, caption: "", photoType: "Other", name: file.name }]);
      } catch (err) {
        console.error("Failed to compress image:", err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addPart = () => setParts((p) => [...p, { partNumber: "", partDescription: "", quantity: 1, source: "" }]);
  const removePart = (idx: number) => setParts((p) => p.filter((_, i) => i !== idx));
  const updatePart = (idx: number, field: keyof PartEntry, value: string | number) => {
    setParts((p) => p.map((pt, i) => (i === idx ? { ...pt, [field]: value } : pt)));
  };

  // Save to contacts helper
  const saveToContacts = async (type: string, name: string, company?: string, phone?: string, email?: string, address?: string, city?: string, state?: string) => {
    if (!name) return;
    try {
      await apiRequest("POST", "/api/contacts", {
        contactType: type,
        contactName: name,
        companyName: company || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        city: city || null,
        state: state || null,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact saved", description: `${name} added to contacts.` });
    } catch {
      toast({ title: "Error saving contact", variant: "destructive" });
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto pb-32 md:pb-10 space-y-5">
      <PageHero
        backHref="/calls"
        backLabel="Back to Service Calls"
        title={followUpId ? "Follow-up Service Call" : "New Service Call"}
        subtitle={<span>Fill out all required fields to create a service call</span>}
      />

      {/* Copy-from banner (New Issue) */}
      {copyFromId && copyFromCall && !followUpId && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 mb-4 flex items-center gap-2" data-testid="copy-from-banner">
          <FilePlus className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            New issue — pre-filled from{" "}
            <Link href={`/calls/${copyFromId}`} className="font-medium underline" data-testid="copy-from-link">
              Call #{copyFromId} — {copyFromCall.customerName}
            </Link>
          </p>
        </div>
      )}

      {/* Follow-up banner */}
      {followUpId && parentCall && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4 flex items-center gap-2" data-testid="followup-banner">
          <ArrowLeft className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <p className="text-sm text-blue-700 dark:text-blue-400">
            Follow-up to{" "}
            <Link href={`/calls/${followUpId}`} className="font-medium underline" data-testid="followup-link">
              Call #{followUpId} — {parentCall.customerName}
            </Link>
          </p>
        </div>
      )}

      {!isOnline && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-4 flex items-center gap-2" data-testid="offline-banner">
          <WifiOff className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">You're offline. Service calls will be saved locally and synced when you reconnect.</p>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

          {/* Call Type Toggle */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1.5">Call Type</p>
            <div className="flex gap-2">
              {["residential", "commercial"].map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => form.setValue("callType", t)}
                  className={`flex-1 py-3 rounded-lg border-2 text-sm font-semibold transition-all ${
                    form.watch("callType") === t
                      ? "border-[hsl(200,72%,40%)] bg-[hsl(200,72%,40%)]/10 text-[hsl(200,72%,40%)]"
                      : "border-border bg-card text-muted-foreground hover:border-muted-foreground/30"
                  }`}
                  data-testid={`button-call-type-${t}`}
                >
                  {t === "residential" ? "Residential" : "Commercial"}
                </button>
              ))}
            </div>
          </div>

          {/* Service Method */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-1.5">Service Method</p>
            <div className="flex gap-2">
              {[
                { v: "In-Person", label: "In-Person" },
                { v: "Phone Call", label: "Phone Call" },
                { v: "Video Call", label: "Video Call" },
              ].map(m => (
                <button
                  key={m.v}
                  type="button"
                  onClick={() => form.setValue("serviceMethod", m.v)}
                  className={`flex-1 py-3 rounded-lg border-2 text-sm font-semibold transition-all ${
                    form.watch("serviceMethod") === m.v
                      ? "border-[hsl(200,72%,40%)] bg-[hsl(200,72%,40%)]/10 text-[hsl(200,72%,40%)]"
                      : "border-border bg-card text-muted-foreground hover:border-muted-foreground/30"
                  }`}
                  data-testid={`button-service-method-${m.v.toLowerCase().replace(" ", "-")}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

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

              {currentUser?.role !== "staff" && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="new-is-test"
                    checked={(form.watch("isTest") ?? 0) === 1}
                    onCheckedChange={(checked) => form.setValue("isTest", checked ? 1 : 0)}
                    data-testid="checkbox-is-test"
                  />
                  <label htmlFor="new-is-test" className="text-xs text-muted-foreground cursor-pointer">
                    Mark as test call (excluded from reports)
                  </label>
                </div>
              )}

              <div>
                <label className="text-sm font-medium">Call Created By <span className="text-destructive">*</span></label>
                <Select value={String(createdBy)} onValueChange={v => { setCreatedBy(v === "" ? "" : Number(v)); setCreatedByError(""); }}>
                  <SelectTrigger className={`mt-1${createdByError ? " border-destructive" : ""}`}>
                    <SelectValue placeholder="Select team member…" />
                  </SelectTrigger>
                  <SelectContent>
                    {teamMembers.map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {createdByError && <p className="text-xs text-destructive mt-1">{createdByError}</p>}
              </div>
            </CardContent>
          </Card>

          {/* ── Scheduling ─────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Scheduling</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="scheduledDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scheduled Date</FormLabel>
                    <FormControl><Input type="date" {...field} value={field.value ?? ""} data-testid="input-scheduled-date" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="scheduledTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scheduled Time (approx.)</FormLabel>
                    <FormControl><Input type="time" {...field} value={field.value ?? ""} data-testid="input-scheduled-time" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="followUpDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Follow-up Date</FormLabel>
                    <FormControl><Input type="date" {...field} value={field.value ?? ""} data-testid="input-follow-up-date" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          {/* ── Customer / Site ───────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Customer & Job Site</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="customerName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{form.watch("callType") === "residential" ? "Homeowner Name" : "Customer / Company Name"}</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          placeholder="e.g. Mountain West Plumbing"
                          {...field}
                          value={field.value ?? ""}
                          onFocus={() => setShowCustomerSuggest(true)}
                          onBlur={() => setTimeout(() => setShowCustomerSuggest(false), 200)}
                          data-testid="input-customer-name"
                        />
                      </FormControl>
                      <SuggestDropdown
                        suggestions={customerSuggest.suggestions}
                        onSelect={(c) => {
                          form.setValue("customerName", c.companyName || c.contactName);
                          if (c.address) form.setValue("jobSiteAddress", c.address);
                          if (c.city) form.setValue("jobSiteCity", c.city);
                          if (c.state) form.setValue("jobSiteState", c.state);
                        }}
                        onClose={() => { setShowCustomerSuggest(false); customerSuggest.clear(); }}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                {form.watch("callType") === "commercial" && (
                  <FormField control={form.control} name="jobSiteName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job Site / Project Name</FormLabel>
                      <FormControl><Input placeholder="e.g. Riverview Apartments Phase 2" {...field} value={field.value ?? ""} data-testid="input-job-site-name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>

              {/* Wholesaler dropdown */}
              <div>
                <label className="text-sm font-medium">Wholesaler</label>
                <Select
                  value={form.watch("wholesalerName") || "__none__"}
                  onValueChange={v => {
                    if (v === "__none__") {
                      form.setValue("wholesalerName", "");
                      form.setValue("wholesalerPhone", "");
                    } else {
                      const w = wholesalers.find(w => w.companyName === v || w.contactName === v);
                      form.setValue("wholesalerName", v);
                      form.setValue("wholesalerPhone", w?.phone || "");
                    }
                  }}
                >
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select wholesaler (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {wholesalers.map(w => (
                      <SelectItem key={w.id} value={w.companyName || w.contactName}>{w.companyName || w.contactName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.watch("wholesalerPhone") && (
                  <p className="text-sm text-muted-foreground mt-1">{form.watch("wholesalerPhone")}</p>
                )}
              </div>

              <FormField control={form.control} name="jobSiteAddress" render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl><Input placeholder="Street address" {...field} value={field.value ?? ""} data-testid="input-address" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="jobSiteCity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl><Input placeholder="City" {...field} value={field.value ?? ""} data-testid="input-city" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="jobSiteState" render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                      <FormControl>
                        <SelectTrigger data-testid="select-state">
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Select state</SelectItem>
                        {US_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="jobSiteZip" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ZIP</FormLabel>
                    <FormControl><Input placeholder="ZIP" {...field} value={field.value ?? ""} className="w-24" data-testid="input-zip" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Installing Contractor */}
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Installing Contractor</p>
                {form.watch("contactName") && (
                  <button
                    type="button"
                    className="text-xs text-primary flex items-center gap-1 hover:underline"
                    onClick={() => saveToContacts("contractor", form.getValues("contactName") ?? "", form.getValues("contactCompany") ?? undefined, form.getValues("contactPhone") ?? "", form.getValues("contactEmail") ?? "")}
                    data-testid="save-contractor-contact"
                  >
                    <UserPlus className="w-3 h-3" /> Save to contacts
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <FormField control={form.control} name="contactName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          placeholder="Contractor name"
                          {...field}
                          value={field.value ?? ""}
                          onFocus={() => setShowContractorSuggest(true)}
                          onBlur={() => setTimeout(() => setShowContractorSuggest(false), 200)}
                          data-testid="input-contact-name"
                        />
                      </FormControl>
                      <SuggestDropdown
                        suggestions={contractorSuggest.suggestions}
                        onSelect={(c) => {
                          form.setValue("contactName", c.contactName);
                          if (c.companyName) form.setValue("contactCompany", c.companyName);
                          if (c.phone) form.setValue("contactPhone", c.phone);
                          if (c.email) form.setValue("contactEmail", c.email);
                        }}
                        onClose={() => { setShowContractorSuggest(false); contractorSuggest.clear(); }}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="contactCompany" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company</FormLabel>
                    <FormControl><Input placeholder="Company name" {...field} value={field.value ?? ""} data-testid="input-contact-company" /></FormControl>
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

              {/* On-Site Contact — Commercial only */}
              {form.watch("callType") === "commercial" && <><div className="flex items-center justify-between pt-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">On-Site Contact</p>
                {form.watch("siteContactName") && (
                  <button
                    type="button"
                    className="text-xs text-primary flex items-center gap-1 hover:underline"
                    onClick={() => saveToContacts("site_contact", form.getValues("siteContactName") ?? "", undefined, form.getValues("siteContactPhone") ?? "", form.getValues("siteContactEmail") ?? "")}
                    data-testid="save-site-contact"
                  >
                    <UserPlus className="w-3 h-3" /> Save to contacts
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="siteContactName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          placeholder="Homeowner / facility contact"
                          {...field}
                          value={field.value ?? ""}
                          onFocus={() => setShowSiteContactSuggest(true)}
                          onBlur={() => setTimeout(() => setShowSiteContactSuggest(false), 200)}
                          data-testid="input-site-contact-name"
                        />
                      </FormControl>
                      <SuggestDropdown
                        suggestions={siteContactSuggest.suggestions}
                        onSelect={(c) => {
                          form.setValue("siteContactName", c.contactName);
                          if (c.phone) form.setValue("siteContactPhone", c.phone);
                          if (c.email) form.setValue("siteContactEmail", c.email);
                        }}
                        onClose={() => { setShowSiteContactSuggest(false); siteContactSuggest.clear(); }}
                      />
                    </div>
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
              </>}
            </CardContent>
          </Card>

          {/* ── Product Info ──────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Product Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="productModel" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model Number</FormLabel>
                    <FormControl><Input placeholder="e.g. HVHPT-50-240-PE" {...field} value={field.value ?? ""} data-testid="input-model" /></FormControl>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="productType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product Type</FormLabel>
                    <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                      <FormControl>
                        <SelectTrigger data-testid="select-product-type">
                          <SelectValue placeholder="Select type…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Not specified</SelectItem>
                        {PRODUCT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="installationDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Installation Date</FormLabel>
                    <FormControl><Input type="date" {...field} value={field.value ?? ""} data-testid="input-install-date" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          {/* ── Job Logistics ─────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Job Logistics</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="hoursOnJob" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hours on Job</FormLabel>
                    <FormControl><Input type="number" step="0.25" min="0" placeholder="e.g. 2.5" {...field} value={field.value ?? ""} data-testid="input-hours" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="milesTraveled" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Miles Traveled</FormLabel>
                    <FormControl><Input type="number" step="1" min="0" placeholder="e.g. 45" {...field} value={field.value ?? ""} data-testid="input-miles" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          {/* ── Issue / Diagnosis ─────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Issue & Diagnosis</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="issueDescription" render={({ field }) => (
                <FormItem>
                  <FormLabel>Issue Description</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="Describe what the customer reported…" {...field} value={field.value ?? ""} data-testid="textarea-issue" />
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
              <FormField control={form.control} name="claimNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>Claim / Reference Number</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. WC-2026-04512" {...field} value={field.value ?? ""} className="font-mono" data-testid="input-claim-number" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="claimNotes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Claim Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Claim notes…" {...field} value={field.value ?? ""} data-testid="textarea-claim-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { name: "partsCost" as const, label: "Parts Cost" },
                  { name: "laborCost" as const, label: "Labor Cost" },
                  { name: "otherCost" as const, label: "Other Cost" },
                  { name: "claimAmount" as const, label: "Claim Amount" },
                ].map(({ name, label }) => (
                  <FormField key={name} control={form.control} name={name} render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                          <Input type="number" step="0.01" min="0" placeholder="0.00" {...field} value={field.value ?? ""} className="pl-7" data-testid={`input-${name}`} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                ))}
              </div>
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


          {/* spacer so content doesn't hide behind floating bar */}
          <div className="h-16" />

        </form>
      </Form>

      {/* Floating save bar — fixed to bottom of viewport */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur border-t border-border md:left-[216px]">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/calls")} data-testid="button-cancel-new">
            <X className="w-4 h-4 mr-1.5" /> Cancel
          </Button>
          <Button
            size="sm"
            disabled={createMutation.isPending || savingOffline}
            onClick={() => form.handleSubmit(onSubmit)()}
            data-testid="button-floating-save"
          >
            <Save className="w-4 h-4 mr-1.5" />
            {(createMutation.isPending || savingOffline) ? "Saving…" : isOnline ? "Save Service Call" : "Save Offline"}
          </Button>
        </div>
      </div>
    </div>
  );
}

