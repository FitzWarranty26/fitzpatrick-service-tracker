import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { formatDate, formatDateTime, formatTime } from "@/lib/utils";
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
import { MANUFACTURERS, SERVICE_STATUSES, CLAIM_STATUSES, PRODUCT_TYPES, getWarrantyStatus } from "@shared/schema";
import type { ServiceCall, Photo, Part, Contact } from "@shared/schema";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { getUser } from "@/lib/auth";
import {
  ChevronLeft, Edit3, Save, X, Trash2, FileText, Camera, Plus, Receipt,
  MapPin, Phone, User, Building, AlertCircle, CheckCircle2,
  Mail, Loader2, Clock, Car, DollarSign, CornerDownRight, Shield, ShieldAlert, ShieldQuestion, Send, MessageSquare, GripVertical, Bell, CalendarDays, FilePlus, Video, PhoneCall, UserCheck,
  Image as ImageIcon, Wrench, ListChecks, MapPin as MapPinIcon,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generatePDF } from "@/lib/pdf";
import { PhoneLink } from "@/components/PhoneLink";
import { SortablePhotoGrid } from "@/components/SortablePhotoGrid";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, rectSortingStrategy, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { todayLocalISO, localDateISO, shiftDays } from "@shared/datetime";

interface ServiceCallFull extends ServiceCall {
  photos: Photo[];
  parts: Part[];
  activities: Array<{ id: number; serviceCallId: number; note: string; createdAt: string }>;
  [key: string]: any; // allow dynamic field access for newer schema additions
}

interface ServiceCallVisit {
  id: number;
  serviceCallId: number;
  visitNumber: number;
  visitDate: string;
  technicianId: number | null;
  notes: string | null;
  status: string;
  hoursOnJob: string | null;
  milesTraveled: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AppUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
  active: number;
}

const VISIT_STATUSES = ["Scheduled", "In Progress", "Completed", "Needs Return Visit", "Cancelled"] as const;

function VisitStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    "Scheduled": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    "In Progress": "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
    "Completed": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    "Needs Return Visit": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    "Cancelled": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${colors[status] || colors["Scheduled"]}`}>
      {status}
    </span>
  );
}

function KPICell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      <p className="text-sm md:text-base font-bold text-foreground tabular-nums mt-1 truncate" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</p>
    </div>
  );
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

// ─── Sortable existing photo for edit mode (Fix 4) ─────────────────────────

function SortableExistingPhoto({ photo, onDelete }: { photo: Photo; onDelete: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(photo.id) });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : ("auto" as any),
  };

  return (
    <div ref={setNodeRef} style={style} className={`relative rounded-lg overflow-hidden border ${isDragging ? "border-primary shadow-lg" : "border-border"}`} data-testid={`photo-${photo.id}`}>
      <div className="relative">
        <img src={photo.photoUrl} alt={photo.caption || "Photo"} className="w-full aspect-square object-cover" />
        <div {...attributes} {...listeners} className="absolute top-1.5 left-1.5 bg-black/60 rounded-full p-1.5 text-white cursor-grab active:cursor-grabbing touch-none" title="Drag to reorder">
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        <button type="button" onClick={() => onDelete(photo.id)} className="absolute top-1.5 right-1.5 bg-black/60 rounded-full p-1 text-white hover:bg-red-600/80">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-1.5 bg-background/90">
        <p className="text-[10px] font-medium text-muted-foreground">{photo.photoType}</p>
        {photo.caption && <p className="text-xs text-foreground truncate">{photo.caption}</p>}
      </div>
    </div>
  );
}

function EditablePhotoGrid({ photos, onReorder, onDelete }: {
  photos: Photo[];
  onReorder: (ids: number[]) => void;
  onDelete: (id: number) => void;
}) {
  const [items, setItems] = useState(photos.map(p => p.id));

  useEffect(() => {
    setItems(photos.map(p => p.id));
  }, [photos]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.indexOf(Number(active.id));
      const newIndex = items.indexOf(Number(over.id));
      const newOrder = arrayMove(items, oldIndex, newIndex);
      setItems(newOrder);
      onReorder(newOrder);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(String)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {items.map((photoId) => {
            const photo = photos.find(p => p.id === photoId);
            if (!photo) return null;
            return <SortableExistingPhoto key={photoId} photo={photo} onDelete={onDelete} />;
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export default function ServiceCallDetail({ id }: { id: string }) {
  const callId = parseInt(id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<ServiceCallFull>>({});
  const [showCompletePrompt, setShowCompletePrompt] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);
  const [newPhotoFiles, setNewPhotoFiles] = useState<Array<{ photoUrl: string; caption: string; photoType: string }>>([]);

  // Controlled tab (lets us jump Overview from a Visit-1 link)
  const [activeTab, setActiveTab] = useState("overview");

  // Schedule history
  const [showRescheduleDialog, setShowRescheduleDialog] = useState(false);
  const [showEditActiveDialog, setShowEditActiveDialog] = useState(false);
  const [reschedForm, setReschedForm] = useState({ date: "", time: "", reason: "" });
  const [editActiveForm, setEditActiveForm] = useState({ date: "", time: "" });

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

  const saveEdit = (force = false) => {
    // If marking Completed, check for missing hours/miles
    if (!force && editData.status === "Completed") {
      const effectiveHours = (editData.hoursOnJob ?? call?.hoursOnJob) as string | null;
      const effectiveMiles = (editData.milesTraveled ?? call?.milesTraveled) as string | null;
      const missingHours = !effectiveHours || parseFloat(effectiveHours) <= 0;
      const missingMiles = !effectiveMiles || parseFloat(effectiveMiles) <= 0;
      if (missingHours || missingMiles) {
        setShowCompletePrompt(true);
        return;
      }
    }
    const { photos: _p, parts: _pt, ...updateFields } = editData as any;
    updateMutation.mutate(updateFields);
  };

  const handlePhotoAddForEdit = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { compressImage, UnsupportedImageError } = await import("@/lib/image-utils");
    const files = Array.from(e.target.files ?? []);
    let added = 0;
    let skipped = 0;
    let lastError: string | null = null;
    for (const file of files) {
      try {
        const dataUrl = await compressImage(file);
        setNewPhotoFiles(prev => [...prev, { photoUrl: dataUrl, caption: "", photoType: "Other" }]);
        added++;
      } catch (err: any) {
        skipped++;
        // Show the friendly UnsupportedImageError message; otherwise fall back
        // to a generic note. Either way, never silently drop the photo.
        lastError = err instanceof UnsupportedImageError
          ? err.message
          : `Couldn't add ${file.name}: ${err?.message ?? "unknown error"}`;
        console.error("Failed to add photo:", err);
      }
    }
    if (skipped > 0) {
      toast({
        title: skipped === 1 ? "Photo skipped" : `${skipped} photos skipped`,
        description: lastError ?? "Some photos couldn't be added.",
        variant: "destructive",
      });
    } else if (added > 0) {
      toast({ title: `${added} photo${added !== 1 ? "s" : ""} ready` });
    }
    // Reset the input so picking the same file again still triggers onChange
    if (e.target) e.target.value = "";
  };

  const [isUploading, setIsUploading] = useState(false);
  const directPhotoInputRef = useRef<HTMLInputElement>(null);

  // Activity log
  const [newNote, setNewNote] = useState("");
  const addActivityMutation = useMutation({
    mutationFn: async (note: string) => {
      const res = await apiRequest("POST", `/api/service-calls/${callId}/activities`, { note });
      return res.json();
    },
    onSuccess: () => {
      setNewNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteActivityMutation = useMutation({
    mutationFn: (activityId: number) => apiRequest("DELETE", `/api/activities/${activityId}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
    },
  });

  // Fix 2: Add Part state and mutations
  const [showAddPart, setShowAddPart] = useState(false);
  const [newPart, setNewPart] = useState({ partNumber: "", partDescription: "", quantity: 1, unitCost: "", source: "" });

  // ─── Scheduled Appointments ───────────────────────────────────────────────────────
  interface AppointmentEntry {
    id: number;
    callId: number;
    scheduledDate: string;
    scheduledTime: string | null;
    status: "active" | "rescheduled" | string;
    reason: string | null;
    createdById: number | null;
    createdByName: string | null;
    createdAt: string;
  }

  const { data: appointments } = useQuery<AppointmentEntry[]>({
    queryKey: [`/api/service-calls/${callId}/appointments`],
    queryFn: async () => (await apiRequest("GET", `/api/service-calls/${callId}/appointments`)).json(),
    enabled: !!callId,
  });

  // Helper: invalidate every surface that shows scheduled dates/times so a
  // reschedule or edit reflects everywhere immediately. Previously we only
  // refreshed /dashboard/today and /briefing; this missed /my-calls,
  // /upcoming-week, /watchlist, /recent, /stats, /trend, /follow-ups,
  // /activity — causing the tech dashboard to show the stale old time.
  const invalidateSchedulingSurfaces = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/service-calls/${callId}/appointments`] });
    queryClient.invalidateQueries({ queryKey: [`/api/service-calls/${callId}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/service-calls/${callId}/visits`] });
    queryClient.invalidateQueries({ queryKey: ["/api/service-calls"] });
    queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
    // Hit every dashboard endpoint that surfaces a scheduled date or time
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/today"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/briefing"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/my-calls"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/upcoming-week"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/watchlist"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/trend"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/follow-ups"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/activity"] });
  };

  const rescheduleMutation = useMutation({
    mutationFn: async (data: { scheduledDate: string; scheduledTime: string | null; reason: string }) => {
      const res = await apiRequest("POST", `/api/service-calls/${callId}/appointments/reschedule`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidateSchedulingSurfaces();
      setShowRescheduleDialog(false);
      setReschedForm({ date: "", time: "", reason: "" });
      toast({ title: "Rescheduled", description: "New appointment created." });
    },
    onError: (e: any) => {
      toast({ title: "Reschedule failed", description: e?.message || "Try again.", variant: "destructive" });
    },
  });

  const editActiveAppointmentMutation = useMutation({
    mutationFn: async (data: { scheduledDate: string; scheduledTime: string | null }) => {
      const res = await apiRequest("PUT", `/api/service-calls/${callId}/appointments/active`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidateSchedulingSurfaces();
      setShowEditActiveDialog(false);
      toast({ title: "Updated", description: "Active appointment updated." });
    },
    onError: (e: any) => {
      toast({ title: "Update failed", description: e?.message || "Try again.", variant: "destructive" });
    },
  });

  const addPartMutation = useMutation({
    mutationFn: async (part: { partNumber: string; partDescription: string; quantity: number; unitCost: string; source: string }) => {
      const res = await apiRequest("POST", `/api/service-calls/${callId}/parts`, { ...part, serviceCallId: callId });
      return res.json();
    },
    onSuccess: () => {
      setNewPart({ partNumber: "", partDescription: "", quantity: 1, unitCost: "", source: "" });
      setShowAddPart(false);
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
      toast({ title: "Part added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deletePartMutation = useMutation({
    mutationFn: (partId: number) => apiRequest("DELETE", `/api/parts/${partId}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
      toast({ title: "Part removed" });
    },
  });

  // Fix 4: Reorder photos mutation
  const reorderPhotosMutation = useMutation({
    mutationFn: async (photoIds: number[]) => {
      const res = await apiRequest("PUT", `/api/service-calls/${callId}/photos/reorder`, { photoIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
    },
  });

  // ─── Return Visits ──────────────────────────────────────────────────────────
  const currentUser = getUser();
  const canEdit = currentUser && currentUser.role !== "staff";
  const canDelete = currentUser && currentUser.role === "manager";

  const { data: visits = [], refetch: refetchVisits } = useQuery<ServiceCallVisit[]>({
    queryKey: ["/api/service-calls", callId, "visits"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/service-calls/${callId}/visits`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!call,
  });

  const { data: allUsers = [] } = useQuery<AppUser[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/users`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!canEdit,
  });
  const techUsers = allUsers.filter(u => u.active && ["tech", "manager", "sales"].includes(u.role));

  // All active team members — for "Created By" display + edit (accessible to all roles)
  const { data: teamMembers = [] } = useQuery<{ id: number; displayName: string; role: string }[]>({
    queryKey: ["/api/users/names"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/users/names");
      if (!res.ok) return [];
      return res.json();
    },
  });
  const createdByName = teamMembers.find(u => u.id === call?.createdBy)?.displayName ?? null;

  // Wholesaler contacts for edit dropdown
  const { data: wholesalers = [] } = useQuery<{ id: number; companyName: string; contactName: string; phone: string | null }[]>({
    queryKey: ["/api/contacts", "wholesalers"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/contacts?type=wholesaler");
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!isEditing,
  });

  const [showAddVisit, setShowAddVisit] = useState(false);
  const [editingVisit, setEditingVisit] = useState<ServiceCallVisit | null>(null);
  const [visitForm, setVisitForm] = useState({
    visitDate: todayLocalISO(),
    status: "Scheduled",
    technicianId: "",
    notes: "",
    hoursOnJob: "",
    milesTraveled: "",
  });
  const [visitDateError, setVisitDateError] = useState("");

  const openAddVisit = () => {
    setVisitForm({
      visitDate: todayLocalISO(),
      status: "Scheduled",
      technicianId: "",
      notes: "",
      hoursOnJob: "",
      milesTraveled: "",
    });
    setVisitDateError("");
    setEditingVisit(null);
    setShowAddVisit(true);
  };

  const openEditVisit = (v: ServiceCallVisit) => {
    setVisitForm({
      visitDate: v.visitDate,
      status: v.status,
      technicianId: v.technicianId ? String(v.technicianId) : "",
      notes: v.notes || "",
      hoursOnJob: v.hoursOnJob || "",
      milesTraveled: v.milesTraveled || "",
    });
    setVisitDateError("");
    setEditingVisit(v);
    setShowAddVisit(true);
  };

  const createVisitMutation = useMutation({
    mutationFn: async (data: { visitDate: string; status: string; technicianId: number | null; notes: string }) => {
      const res = await apiRequest("POST", `/api/service-calls/${callId}/visits`, data);
      return res.json();
    },
    onSuccess: () => {
      setShowAddVisit(false);
      refetchVisits();
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
      toast({ title: "Return visit added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateVisitMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PUT", `/api/service-calls/${callId}/visits/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      setShowAddVisit(false);
      setEditingVisit(null);
      refetchVisits();
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
      toast({ title: "Visit updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteVisitMutation = useMutation({
    mutationFn: async (vid: number) => {
      const res = await apiRequest("DELETE", `/api/service-calls/${callId}/visits/${vid}`);
      return res.json();
    },
    onSuccess: () => {
      refetchVisits();
      toast({ title: "Visit deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleVisitSubmit = () => {
    if (!visitForm.visitDate) {
      setVisitDateError("Visit date is required");
      return;
    }
    const payload = {
      visitDate: visitForm.visitDate,
      status: visitForm.status,
      technicianId: visitForm.technicianId ? parseInt(visitForm.technicianId) : null,
      notes: visitForm.notes || null,
      hoursOnJob: visitForm.hoursOnJob || null,
      milesTraveled: visitForm.milesTraveled || null,
    };
    if (editingVisit) {
      updateVisitMutation.mutate({ id: editingVisit.id, data: payload });
    } else {
      createVisitMutation.mutate(payload as any);
    }
  };

  const handleDirectPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!call) return;
    const { compressImage, UnsupportedImageError } = await import("@/lib/image-utils");
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setIsUploading(true);
    let uploaded = 0;
    let skipped = 0;
    let lastError: string | null = null;
    for (const file of files) {
      try {
        const dataUrl = await compressImage(file);
        await apiRequest("POST", `/api/service-calls/${call.id}/photos`, { photoUrl: dataUrl, caption: "", photoType: "Other" });
        uploaded++;
      } catch (err: any) {
        skipped++;
        lastError = err instanceof UnsupportedImageError
          ? err.message
          : `Couldn't upload ${file.name}: ${err?.message ?? "unknown error"}`;
        console.error("Failed to upload photo:", err);
      }
    }
    setIsUploading(false);
    if (directPhotoInputRef.current) directPhotoInputRef.current.value = "";
    queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
    if (skipped > 0) {
      toast({
        title: `${uploaded} uploaded, ${skipped} skipped`,
        description: lastError ?? "Some photos couldn't be uploaded.",
        variant: "destructive",
      });
    } else if (uploaded > 0) {
      toast({ title: "Photos added", description: `${uploaded} photo${uploaded !== 1 ? "s" : ""} uploaded.` });
    }
  };

  // Follow-up reminder quick-set
  const setFollowUpMutation = useMutation({
    mutationFn: async (date: string | null) => {
      const res = await apiRequest("PATCH", `/api/service-calls/${callId}`, { followUpDate: date });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/follow-ups"] });
      toast({ title: date ? "Reminder set" : "Reminder cleared" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);
  const [date, setDate] = useState("");

  const setFollowUpPreset = (days: number) => {
    // Compute the follow-up date in business timezone, not UTC — so '+7 days'
    // from May 6 evening doesn't accidentally become May 14 (UTC slip).
    const iso = shiftDays(days);
    setFollowUpMutation.mutate(iso);
    setShowFollowUpPicker(false);
  };

  // Email / Share handler
  const [isEmailing, setIsEmailing] = useState(false);
  const handleEmail = async () => {
    if (!call) return;
    const subject = `Service Call #${call.id} \u2014 ${call.customerName || ""} \u2014 ${call.manufacturer}`;
    const bodyText = `Service Call #${call.id}\nDate: ${call.callDate}\nCustomer: ${call.customerName || ""}\nSite: ${call.jobSiteName || ""}\nManufacturer: ${call.manufacturer}\nModel: ${call.productModel || ""}\nStatus: ${call.status}\nClaim: ${call.claimStatus}\n\nIssue: ${(call.issueDescription || "").slice(0, 500)}`;

    // Try Web Share API with real PDF file (works on iOS Safari)
    if (navigator.share && navigator.canShare) {
      try {
        setIsEmailing(true);
        // Generate the PDF HTML and render to a real PDF via html2canvas + jspdf
        const { generatePDFHtml } = await import("@/lib/pdf");
        const techNamesById = Object.fromEntries(techUsers.map(u => [u.id, u.displayName || u.username]));
        const html = await generatePDFHtml(call, { visits, techNamesById });

        // Render HTML in a hidden iframe
        const iframe = document.createElement("iframe");
        iframe.style.cssText = "position:fixed;left:-9999px;top:0;width:800px;height:1200px;border:none;";
        document.body.appendChild(iframe);
        iframe.contentDocument!.open();
        iframe.contentDocument!.write(html);
        iframe.contentDocument!.close();

        // Wait for images/fonts to load
        await new Promise(r => setTimeout(r, 800));

        const html2canvas = (await import("html2canvas")).default;
        const { jsPDF } = await import("jspdf");

        const body = iframe.contentDocument!.body;
        const canvas = await html2canvas(body, {
          scale: 2,
          useCORS: true,
          width: 800,
          windowWidth: 800,
        });
        document.body.removeChild(iframe);

        // Convert canvas to PDF (letter size)
        const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = pageWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        // Add pages as needed
        let yOffset = 0;
        while (yOffset < imgHeight) {
          if (yOffset > 0) pdf.addPage();
          pdf.addImage(
            canvas.toDataURL("image/jpeg", 0.92),
            "JPEG", 0, -yOffset, imgWidth, imgHeight
          );
          yOffset += pageHeight;
        }

        const pdfBlob = pdf.output("blob");
        const file = new File([pdfBlob], `Service-Call-${call.id}.pdf`, { type: "application/pdf" });

        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: subject,
            text: bodyText,
            files: [file],
          });
          setIsEmailing(false);
          return;
        }
      } catch (err) {
        // Share cancelled or failed — fall through to mailto
        console.error("Share failed:", err);
      } finally {
        setIsEmailing(false);
      }
    }
    // Fallback: mailto
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText + "\n\nFull PDF report attached separately.")}`);
  };

  const handlePDF = async () => {
    if (!call) return;
    try {
      const techNamesById = Object.fromEntries(techUsers.map(u => [u.id, u.displayName || u.username]));
      await generatePDF(call, { visits, techNamesById });
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

  // KPI strip values
  const daysOpen = (() => {
    if (!call.callDate) return 0;
    const start = new Date(call.callDate + "T00:00:00").getTime();
    return Math.max(0, Math.floor((Date.now() - start) / 86400000));
  })();
  const visitCount = (call.visits?.length || 0) + 1;
  const photoCount = call.photos?.length || 0;
  const partsCount = call.parts?.length || 0;
  const activityCount = call.activities?.length || 0;

  const subtitleParts = [
    call.jobSiteName,
    call.jobSiteCity && (call.jobSiteState ? `${call.jobSiteCity}, ${call.jobSiteState}` : call.jobSiteCity),
    call.manufacturer,
  ].filter(Boolean) as string[];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto pb-32 md:pb-10 space-y-5">
      {/* ── Back link ── */}
      <button
        onClick={() => navigate("/calls")}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        data-testid="button-back"
      >
        <ChevronLeft className="w-4 h-4" /> Back to Service Calls
      </button>

      {/* ── Hero Header ── */}
      <div className="bg-card rounded-xl border border-border/50 p-5 md:p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight truncate">
              Call #{call.id} — {call.customerName || "Unnamed"}
            </h1>
            {call.isTest === 1 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5" data-testid="badge-test">TEST</Badge>
            )}
          </div>
          {subtitleParts.length > 0 && (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
              {subtitleParts.map((p, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i === 0 && <Building className="w-3.5 h-3.5 text-muted-foreground/60" />}
                  {i === 1 && <MapPinIcon className="w-3.5 h-3.5 text-muted-foreground/60" />}
                  {i === 2 && <Wrench className="w-3.5 h-3.5 text-muted-foreground/60" />}
                  <span>{p}</span>
                  {i < subtitleParts.length - 1 && <span className="text-border ml-1.5">·</span>}
                </span>
              ))}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap mt-3">
            <StatusBadge status={displayCall.status ?? call.status} />
            <ClaimBadge status={displayCall.claimStatus ?? call.claimStatus} />
            {(() => {
              const method = (displayCall as any).serviceMethod ?? (call as any).serviceMethod;
              if (!method) return null;
              const Icon = method === "Phone Call" ? PhoneCall : method === "Video Call" ? Video : UserCheck;
              return (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-foreground/80" data-testid="badge-service-method">
                  <Icon className="w-3 h-3" /> {method}
                </span>
              );
            })()}
            <WarrantyBadge installationDate={call.installationDate} manufacturer={call.manufacturer} productType={call.productType} />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isEditing ? (
            <>
              <Button variant="outline" size="sm" onClick={() => navigate(`/new/followup/${call.id}`)} data-testid="button-create-followup">
                <CornerDownRight className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">Follow-up</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate(`/new?copyFrom=${call.id}`)} data-testid="button-new-issue">
                <FilePlus className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">New Issue</span>
              </Button>
              <Button variant="outline" size="sm" onClick={handleEmail} disabled={isEmailing} data-testid="button-email">
                {isEmailing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Mail className="w-4 h-4 mr-1.5" />}
                <span className="hidden sm:inline">{isEmailing ? "Preparing…" : "Email"}</span>
              </Button>

              <Button variant="outline" size="sm" onClick={handlePDF} data-testid="button-generate-pdf">
                <FileText className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">PDF</span>
              </Button>
              <Link href={`/invoices/new?callId=${id}`}>
                <Button variant="outline" size="sm" data-testid="button-create-invoice" className="text-[hsl(200,72%,40%)] border-[hsl(200,72%,40%)] hover:bg-[hsl(200,72%,40%)]/10">
                  <Receipt className="w-4 h-4 mr-1.5" />
                  <span className="hidden sm:inline">Invoice</span>
                </Button>
              </Link>
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
              <Button size="sm" onClick={() => saveEdit()} disabled={updateMutation.isPending} data-testid="button-save-edit">
                <Save className="w-4 h-4 mr-1.5" />
                {updateMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          )}
        </div>
        </div>

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 md:gap-4 mt-5 pt-5 border-t border-border/50">
          <KPICell label="Call Date" value={formatDate(call.callDate)} />
          <KPICell label="Scheduled" value={call.scheduledDate ? formatDate(call.scheduledDate) + (call.scheduledTime ? ` · ${formatTime(call.scheduledTime)}` : "") : "—"} />
          <KPICell label="Days Open" value={call.status === "Completed" ? "—" : `${daysOpen}d`} />
          <KPICell label="Visits" value={String(visitCount)} />
          <KPICell label="Hours on Job" value={call.hoursOnJob ? `${call.hoursOnJob}h` : "—"} />
          <KPICell label="Photos" value={String(photoCount)} />
        </div>
      </div>

      {/* Quick Status Buttons — view mode only, editors only */}
      {!isEditing && canEdit && (() => {
        const status = call.status;
        type Transition = { label: string; next: string; variant?: "default" | "outline" };
        const transitions: Transition[] = [];
        if (status === "Scheduled") transitions.push({ label: "Start", next: "In Progress" });
        if (status === "In Progress") {
          transitions.push({ label: "Complete", next: "Completed", variant: "default" });
          transitions.push({ label: "Needs Return", next: "Needs Return Visit" });
        }
        if (status === "Completed") transitions.push({ label: "Reopen", next: "In Progress" });
        if (status === "Pending Parts") transitions.push({ label: "Start", next: "In Progress" });
        if (status === "Escalated") transitions.push({ label: "Start", next: "In Progress" });
        if (transitions.length === 0) return null;
        return (
          <div className="flex items-center gap-2 flex-wrap" data-testid="quick-status-buttons">
            <span className="text-xs text-muted-foreground mr-1">Quick actions:</span>
            {transitions.map(t => (
              <Button
                key={t.next}
                variant={t.variant || "outline"}
                size="sm"
                className="h-7 text-xs"
                data-testid={`quick-status-${t.next.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={async () => {
                  if (t.next === "Completed") {
                    // Trigger the existing completion check flow
                    const missingHours = !call.hoursOnJob || parseFloat(call.hoursOnJob) <= 0;
                    const missingMiles = !call.milesTraveled || parseFloat(call.milesTraveled) <= 0;
                    if (missingHours || missingMiles) {
                      // Set up editData so the completion prompt works, then trigger it
                      setEditData({ ...call, status: "Completed" });
                      setShowCompletePrompt(true);
                      return;
                    }
                  }
                  try {
                    await apiRequest("PATCH", `/api/service-calls/${callId}`, { status: t.next });
                    queryClient.invalidateQueries({ queryKey: ["/api/service-calls", callId] });
                    queryClient.invalidateQueries({ queryKey: ["/api/service-calls"] });
                    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
                    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent"] });
                    toast({ title: "Status updated", description: `Status changed to ${t.next}` });
                  } catch (e: any) {
                    toast({ title: "Error", description: e.message, variant: "destructive" });
                  }
                }}
              >
                {t.label}
              </Button>
            ))}
          </div>
        );
      })()}

      {/* ─── TABS ─── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto bg-card border border-border/50 rounded-xl p-1 h-auto flex-wrap md:flex-nowrap">
          <TabsTrigger value="overview" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 px-3 md:px-4" data-testid="tab-overview">
            <FileText className="w-3.5 h-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="visits" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 px-3 md:px-4" data-testid="tab-visits">
            <ListChecks className="w-3.5 h-3.5" /> Visits <span className="text-[10px] opacity-60">{visitCount}</span>
          </TabsTrigger>
          <TabsTrigger value="photos" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 px-3 md:px-4" data-testid="tab-photos">
            <ImageIcon className="w-3.5 h-3.5" /> Photos <span className="text-[10px] opacity-60">{photoCount}</span>
          </TabsTrigger>
          <TabsTrigger value="parts" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 px-3 md:px-4" data-testid="tab-parts">
            <Wrench className="w-3.5 h-3.5" /> Parts <span className="text-[10px] opacity-60">{partsCount}</span>
          </TabsTrigger>
          <TabsTrigger value="activity" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 px-3 md:px-4" data-testid="tab-activity">
            <MessageSquare className="w-3.5 h-3.5" /> Activity <span className="text-[10px] opacity-60">{activityCount}</span>
          </TabsTrigger>
          <TabsTrigger value="schedule" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 px-3 md:px-4" data-testid="tab-schedule">
            <CalendarDays className="w-3.5 h-3.5" /> Schedule
          </TabsTrigger>
          <TabsTrigger value="claim" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 px-3 md:px-4" data-testid="tab-claim">
            <Shield className="w-3.5 h-3.5" /> Claim
          </TabsTrigger>
        </TabsList>

        {/* ─── OVERVIEW TAB ─── */}
        <TabsContent value="overview" className="space-y-5 mt-5">

      {/* Status / Claim (editable) */}
      {isEditing && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Service Method</label>
                <Select
                  value={(editData as any).serviceMethod ?? (call as any).serviceMethod ?? "In-Person"}
                  onValueChange={v => setEditData(d => ({ ...d, serviceMethod: v } as any))}
                >
                  <SelectTrigger className="h-8 text-sm" data-testid="edit-service-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="In-Person">In-Person</SelectItem>
                    <SelectItem value="Phone Call">Phone Call</SelectItem>
                    <SelectItem value="Video Call">Video Call</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {currentUser?.role !== "staff" && (
              <div className="flex items-center gap-2 mt-3">
                <Checkbox
                  id="edit-is-test"
                  checked={((editData as any).isTest ?? (call as any).isTest ?? 0) === 1}
                  onCheckedChange={(checked) => setEditData(d => ({ ...d, isTest: checked ? 1 : 0 }))}
                  data-testid="edit-is-test"
                />
                <label htmlFor="edit-is-test" className="text-xs text-muted-foreground cursor-pointer">
                  Mark as test call (excluded from reports)
                </label>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Main Info */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Call Info */}
        <Card>
          <CardHeader className="pb-3 border-b border-border"><CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Call Information</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!isEditing ? (
              <>
                {call.callType && <DetailRow label="Type" value={call.callType === "commercial" ? "Commercial" : "Residential"} />}
                <DetailRow label="Date" value={formatDate(call.callDate)} />
                <DetailRow label="Manufacturer" value={call.manufacturer === "Other" ? (call.manufacturerOther ?? "Other") : call.manufacturer} />
                <DetailRow label="Status" value={call.status} />
                {call.wholesalerName && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Wholesaler</p>
                    <p className="text-sm text-foreground">{call.wholesalerName}{call.wholesalerPhone ? <> · <PhoneLink phone={call.wholesalerPhone} /></> : ""}</p>
                  </div>
                )}
                {createdByName && <DetailRow label="Created By" value={createdByName} />}
                <DetailRow label="Created" value={formatDateTime(call.createdAt)} />
                {/* Follow-up Reminder */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Follow-up Reminder</p>
                  {call.followUpDate ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-sm text-foreground">
                        <Bell className="w-3.5 h-3.5 text-amber-500" />
                        {formatDate(call.followUpDate)}
                        {(() => {
                          const diff = Math.ceil((new Date(call.followUpDate + "T00:00:00").getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                          if (diff < 0) return <span className="text-xs text-red-500 ml-1">({Math.abs(diff)}d overdue)</span>;
                          if (diff === 0) return <span className="text-xs text-amber-500 ml-1">(today)</span>;
                          return <span className="text-xs text-muted-foreground ml-1">(in {diff}d)</span>;
                        })()}
                      </span>
                      <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowFollowUpPicker(true)} data-testid="button-change-followup">Change</button>
                      <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => setFollowUpMutation.mutate(null)} data-testid="button-clear-followup">Clear</button>
                    </div>
                  ) : (
                    <button type="button" className="text-sm text-primary hover:underline inline-flex items-center gap-1" onClick={() => setShowFollowUpPicker(true)} data-testid="button-set-followup">
                      <Bell className="w-3.5 h-3.5" /> Set Reminder
                    </button>
                  )}
                  {showFollowUpPicker && (
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFollowUpPreset(1)} data-testid="followup-tomorrow">Tomorrow</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFollowUpPreset(3)} data-testid="followup-3days">3 Days</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFollowUpPreset(7)} data-testid="followup-1week">1 Week</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFollowUpPreset(14)} data-testid="followup-2weeks">2 Weeks</Button>
                      <Input type="date" className="h-7 text-xs w-36" value={date} onChange={e => setDate(e.target.value)} data-testid="followup-custom-date" />
                      <Button variant="default" size="sm" className="h-7 text-xs" disabled={!date} onClick={() => { setFollowUpMutation.mutate(date); setShowFollowUpPicker(false); setDate(""); }} data-testid="followup-set-custom">Set</Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowFollowUpPicker(false)}>Cancel</Button>
                    </div>
                  )}
                </div>
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
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Created By</label>
                  <Select
                    value={String(editData.createdBy ?? call.createdBy ?? "")}
                    onValueChange={v => setEditData(d => ({ ...d, createdBy: v ? Number(v) : null }))}
                  >
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select team member…" /></SelectTrigger>
                    <SelectContent>
                      {teamMembers.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.displayName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Follow-up Date</label>
                  <Input
                    type="date"
                    value={(editData.followUpDate ?? call.followUpDate ?? "") as string}
                    onChange={e => setEditData(d => ({ ...d, followUpDate: e.target.value || null }))}
                    className="h-8 text-sm"
                    data-testid="edit-follow-up-date"
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Customer & Site */}
        <Card>
          <CardHeader className="pb-3 border-b border-border"><CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Customer & Site</CardTitle></CardHeader>
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
                  <p className="text-sm">{call.jobSiteAddress}, {call.jobSiteCity}, {call.jobSiteState}{call.jobSiteZip ? ` ${call.jobSiteZip}` : ""}</p>
                </div>
                {(call.contactName || call.contactPhone || call.contactEmail) && (
                  <div className="pt-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Installing Contractor</p>
                    {call.contactName && (
                      <div className="flex items-center gap-2 mb-1">
                        <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <p className="text-sm">{call.contactName}{call.contactCompany ? <span className="text-muted-foreground"> — {call.contactCompany}</span> : ""}</p>
                      </div>
                    )}
                    {call.contactPhone && (
                      <div className="flex items-center gap-2 mb-1">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm"><PhoneLink phone={call.contactPhone} /></span>
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
                        <span className="text-sm"><PhoneLink phone={call.siteContactPhone} /></span>
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
                <div>
                  <label className="text-xs text-muted-foreground">State</label>
                  <Select
                    value={(editData.jobSiteState ?? call.jobSiteState) as string || "__none__"}
                    onValueChange={v => setEditData(d => ({ ...d, jobSiteState: v === "__none__" ? "" : v }))}
                  >
                    <SelectTrigger className="h-8 text-sm mt-0.5"><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select state</SelectItem>
                      {["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
                        "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
                        "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">ZIP</label>
                  <Input
                    value={(editData.jobSiteZip ?? call.jobSiteZip) as string ?? ""}
                    onChange={e => setEditData(d => ({ ...d, jobSiteZip: e.target.value }))}
                    className="h-8 text-sm mt-0.5 w-24"
                    placeholder="ZIP"
                  />
                </div>
                {/* Wholesaler */}
                <div>
                  <label className="text-xs text-muted-foreground">Wholesaler</label>
                  <Select
                    value={(editData.wholesalerName ?? call.wholesalerName) as string || "__none__"}
                    onValueChange={v => {
                      if (v === "__none__") {
                        setEditData(d => ({ ...d, wholesalerName: "", wholesalerPhone: "" }));
                      } else {
                        const w = wholesalers.find(w => (w.companyName || w.contactName) === v);
                        setEditData(d => ({ ...d, wholesalerName: v, wholesalerPhone: w?.phone || "" }));
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 text-sm mt-0.5"><SelectValue placeholder="Select wholesaler" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {wholesalers.map(w => (
                        <SelectItem key={w.id} value={w.companyName || w.contactName}>{w.companyName || w.contactName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {((editData.wholesalerPhone ?? call.wholesalerPhone) as string) && (
                    <p className="text-xs text-muted-foreground mt-1"><PhoneLink phone={(editData.wholesalerPhone ?? call.wholesalerPhone) as string} /></p>
                  )}
                </div>
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
                      setEditData(d => ({ ...d, contactName: c.contactName, contactCompany: c.companyName ?? "", contactPhone: c.phone ?? "", contactEmail: c.email ?? "" }));
                    }}
                    onClose={() => { setShowContractorSuggest(false); contractorSuggest.clear(); }}
                  />
                </div>
                {[
                  { key: "contactCompany", label: "Contractor Company" },
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

      {/* Product with Warranty Badge */}
      <Card>
        <CardHeader className="pb-3 border-b border-border"><CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Product</CardTitle></CardHeader>
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
          <CardHeader className="pb-3 border-b border-border"><CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Job Logistics</CardTitle></CardHeader>
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
            <CardHeader className="pb-2 border-b border-border">
              <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
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


        </TabsContent>

        {/* ─── VISITS TAB ─── */}
        <TabsContent value="visits" className="space-y-5 mt-5">

      {/* Visit History (Return Visits) */}
      <Card data-testid="visit-history-card">
        <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Visit History</CardTitle>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={openAddVisit} data-testid="button-add-visit"
              className="text-[hsl(200,72%,40%)] border-[hsl(200,72%,40%)] hover:bg-[hsl(200,72%,40%)]/10">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Return Visit
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Empty state when there are no return visits at all — don't render a
              synthesized 'Visit 1' card because the original visit data lives on
              the Overview tab. Showing a non-editable Visit 1 card confused users. */}
          {visits.length === 0 && (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-5 text-center" data-testid="visits-empty-state">
              <p className="text-sm text-foreground mb-1 font-medium">No return visits yet</p>
              <p className="text-xs text-muted-foreground mb-3">
                The initial on-site work is captured on the <strong>Overview</strong> tab — Issue, Diagnosis, Resolution, Hours, Miles.
                <br />Add a return visit only when the technician has to come back.
              </p>
              {canEdit && (
                <Button variant="outline" size="sm" onClick={openAddVisit}
                  className="text-[hsl(200,72%,40%)] border-[hsl(200,72%,40%)] hover:bg-[hsl(200,72%,40%)]/10">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Return Visit
                </Button>
              )}
            </div>
          )}
          {/* Visit N cards — sorted newest first */}
          {[...visits].sort((a, b) => b.visitNumber - a.visitNumber).map((v) => {
            const tech = techUsers.find(u => u.id === v.technicianId);
            return (
              <div key={v.id} className="rounded-lg border border-border bg-card p-4" data-testid={`visit-${v.visitNumber}-card`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold bg-[hsl(200_72%_40%)] text-white px-2 py-0.5 rounded">VISIT {v.visitNumber}</span>
                  <span className="text-sm text-foreground">{formatDate(v.visitDate)}</span>
                  <VisitStatusBadge status={v.status} />
                  <div className="ml-auto flex items-center gap-1">
                    {canEdit && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEditVisit(v)} data-testid={`button-edit-visit-${v.id}`}>
                        <Edit3 className="w-3 h-3 mr-1" /> Edit
                      </Button>
                    )}
                    {canDelete && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" data-testid={`button-delete-visit-${v.id}`}>
                            <Trash2 className="w-3 h-3 mr-1" /> Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Visit {v.visitNumber}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently remove Visit {v.visitNumber} from this service call.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteVisitMutation.mutate(v.id)}
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
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-muted-foreground">Technician: <span className="text-foreground">{tech ? tech.displayName : "—"}</span></p>
                  {(v.hoursOnJob || v.milesTraveled) && (
                    <p className="text-xs text-muted-foreground">
                      {v.hoursOnJob && <>Hours: {v.hoursOnJob} hrs</>}
                      {v.hoursOnJob && v.milesTraveled && <span className="mx-2">|</span>}
                      {v.milesTraveled && <>Miles: {v.milesTraveled} mi</>}
                    </p>
                  )}
                  {v.notes ? (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Notes</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap" data-testid={`visit-${v.visitNumber}-notes`}>{v.notes}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Notes: <span className="text-sm text-foreground">—</span></p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Visit 1 — synthesized from call. Only shown when there are return
              visits (Visit 2+) so the list reads chronologically. Links back to
              Overview for editing because that's where the data lives. */}
          {visits.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4" data-testid="visit-1-card">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold bg-[hsl(220_22%_14%)] text-white px-2 py-0.5 rounded">VISIT 1</span>
                <span className="text-sm text-foreground">{formatDate(call.callDate)}</span>
                <StatusBadge status={call.status} />
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 text-xs"
                    onClick={() => setActiveTab("overview")}
                    data-testid="button-edit-visit-1"
                  >
                    <Edit3 className="w-3 h-3 mr-1" /> Edit on Overview
                  </Button>
                )}
              </div>
              <div className="mt-2 space-y-1">
                {(call.hoursOnJob || call.milesTraveled) && (
                  <p className="text-xs text-muted-foreground">
                    {call.hoursOnJob && <>Hours: {call.hoursOnJob} hrs</>}
                    {call.hoursOnJob && call.milesTraveled && <span className="mx-2">|</span>}
                    {call.milesTraveled && <>Miles: {call.milesTraveled} mi</>}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/70">
                  Visit 1 reflects the initial on-site work — captured on the Overview tab.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>


        </TabsContent>

        {/* ─── PHOTOS TAB ─── */}
        <TabsContent value="photos" className="space-y-5 mt-5">

      {/* Photos */}
      <Card>
        <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Photos ({call.photos.length})</CardTitle>
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
          ) : isEditing ? (
            <>
              {call.photos.length > 0 && (
                <EditablePhotoGrid
                  photos={call.photos}
                  onReorder={(photoIds) => reorderPhotosMutation.mutate(photoIds)}
                  onDelete={(photoId) => deletePhotoMutation.mutate(photoId)}
                />
              )}
              {newPhotoFiles.length > 0 && (
                <div className={call.photos.length > 0 ? "mt-3" : ""}>
                  <SortablePhotoGrid photos={newPhotoFiles} onChange={setNewPhotoFiles} />
                </div>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {call.photos.map((photo) => (
                <div
                  key={photo.id}
                  className="relative rounded-lg overflow-hidden border border-border cursor-pointer group"
                  onClick={() => setLightboxPhoto(photo)}
                  data-testid={`photo-${photo.id}`}
                >
                  <img src={photo.photoUrl} alt={photo.caption || "Photo"} className="w-full aspect-square object-cover group-hover:opacity-90 transition-opacity" />
                  {visits.length > 0 && (
                    <span className="absolute bottom-8 left-1 text-[9px] font-bold bg-black/60 text-white px-1.5 py-0.5 rounded">
                      VISIT {(photo as any).visitNumber || 1}
                    </span>
                  )}
                  <div className="p-1.5 bg-background/90">
                    <p className="text-[10px] font-medium text-muted-foreground">{photo.photoType}</p>
                    {photo.caption && <p className="text-xs text-foreground truncate">{photo.caption}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>


        </TabsContent>

        {/* ─── PARTS TAB ─── */}
        <TabsContent value="parts" className="space-y-5 mt-5">

      {/* Parts Used */}
      <Card>
        <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Parts Used ({call.parts.length})</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setShowAddPart(!showAddPart)} data-testid="button-add-part">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Part
          </Button>
        </CardHeader>
        <CardContent>
          {showAddPart && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3 p-3 bg-muted/50 rounded-lg">
              <Input
                placeholder="Part #"
                value={newPart.partNumber}
                onChange={e => setNewPart(p => ({ ...p, partNumber: e.target.value }))}
                className="text-sm"
                data-testid="input-part-number"
              />
              <Input
                placeholder="Description"
                value={newPart.partDescription}
                onChange={e => setNewPart(p => ({ ...p, partDescription: e.target.value }))}
                className="text-sm col-span-2"
                data-testid="input-part-description"
              />
              <Input
                type="number"
                placeholder="Qty"
                min={1}
                value={newPart.quantity}
                onChange={e => setNewPart(p => ({ ...p, quantity: parseInt(e.target.value) || 1 }))}
                className="text-sm"
                data-testid="input-part-quantity"
              />
              <Input
                placeholder="Unit Cost"
                value={newPart.unitCost}
                onChange={e => setNewPart(p => ({ ...p, unitCost: e.target.value }))}
                className="text-sm"
                data-testid="input-part-unit-cost"
              />
              <Button
                size="sm"
                disabled={!newPart.partNumber || !newPart.partDescription || addPartMutation.isPending}
                onClick={() => addPartMutation.mutate(newPart)}
                data-testid="button-save-part"
              >
                Save Part
              </Button>
            </div>
          )}
          {call.parts.length === 0 && !showAddPart ? (
            <p className="text-sm text-muted-foreground text-center py-4">No parts logged.</p>
          ) : call.parts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-5 py-2.5 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Part #</th>
                    <th className="text-left px-5 py-2.5 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Description</th>
                    <th className="text-center px-5 py-2.5 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Qty</th>
                    <th className="text-left px-5 py-2.5 text-[10px] tracking-wider font-semibold text-muted-foreground uppercase">Source</th>
                    <th className="w-8 px-5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {call.parts.map((part) => (
                    <tr key={part.id} className="border-b border-border last:border-0 group" data-testid={`part-row-${part.id}`}>
                      <td className="px-5 py-2.5 font-mono text-xs">{part.partNumber}</td>
                      <td className="px-5 py-2.5">{part.partDescription}</td>
                      <td className="px-5 py-2.5 text-sm text-muted-foreground">{part.unitCost ? `$${part.unitCost}` : "—"}</td>
                      <td className="px-5 py-2.5 text-center">{part.quantity}</td>
                      <td className="px-5 py-2.5 text-muted-foreground text-xs">{part.source || "—"}</td>
                      <td className="px-5 py-2.5">
                        <button
                          onClick={() => deletePartMutation.mutate(part.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5"
                          title="Delete part"
                          data-testid={`button-delete-part-${part.id}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>


        </TabsContent>

        {/* ─── ACTIVITY TAB ─── */}
        <TabsContent value="activity" className="space-y-5 mt-5">

      {/* Activity Log */}
      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <span className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Activity Log ({call.activities?.length || 0})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Add note input */}
          <div className="flex gap-2">
            <Input
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="Add a note… e.g. Left voicemail, Parts shipped"
              className="text-sm"
              onKeyDown={e => {
                if (e.key === "Enter" && newNote.trim()) {
                  addActivityMutation.mutate(newNote.trim());
                }
              }}
              data-testid="input-activity-note"
            />
            <Button
              size="sm"
              disabled={!newNote.trim() || addActivityMutation.isPending}
              onClick={() => newNote.trim() && addActivityMutation.mutate(newNote.trim())}
              data-testid="button-add-activity"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
          {/* Activity timeline */}
          {call.activities && call.activities.length > 0 ? (
            <div className="space-y-2">
              {[...call.activities].reverse().map((activity) => {
                const date = new Date(activity.createdAt);
                const timeStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " at " + date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                return (
                  <div key={activity.id} className="flex items-start gap-2 group" data-testid={`activity-${activity.id}`}>
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{activity.note}</p>
                      <p className="text-[10px] text-muted-foreground">{timeStr}</p>
                    </div>
                    <button
                      onClick={() => deleteActivityMutation.mutate(activity.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5"
                      title="Delete note"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">No activity notes yet.</p>
          )}
        </CardContent>
      </Card>


        </TabsContent>

        {/* ─── SCHEDULE TAB ─── */}
        <TabsContent value="schedule" className="space-y-5 mt-5">

      {/* Scheduled Appointments */}
      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <span className="flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> Scheduled Appointments {appointments && appointments.length > 0 ? `(${appointments.length})` : ""}</span>
            </CardTitle>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  setReschedForm({
                    date: "",
                    time: "",
                    reason: "",
                  });
                  setShowRescheduleDialog(true);
                }}
                data-testid="button-reschedule"
              >
                <Plus className="w-3 h-3 mr-1" /> Reschedule
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!appointments || appointments.length === 0 ? (
            <div className="p-5 text-center">
              <p className="text-sm text-muted-foreground mb-1">No appointments scheduled yet.</p>
              <p className="text-xs text-muted-foreground/70 mb-3">The first scheduled date is the original call — see the Issue Description on the Overview tab for what to address.</p>
              {canEdit && (
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => {
                  setReschedForm({ date: "", time: "", reason: "" });
                  setShowRescheduleDialog(true);
                }}>
                  <Plus className="w-3 h-3 mr-1" /> Schedule
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {appointments.map((appt) => {
                const isActive = appt.status === "active";
                const ts = new Date(appt.createdAt);
                const tsStr = ts.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                return (
                  <div
                    key={appt.id}
                    className={`px-5 py-3.5 flex items-start gap-4 ${isActive ? "bg-primary/5" : "bg-transparent"}`}
                    data-testid={`appointment-${appt.id}`}
                  >
                    <div className="flex-shrink-0 pt-0.5">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> ACTIVE
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          Rescheduled
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold ${isActive ? "text-base text-foreground" : "text-sm text-muted-foreground/70"}`}>
                        {formatDate(appt.scheduledDate)}{appt.scheduledTime && <> &middot; {formatTime(appt.scheduledTime)}</>}
                      </p>
                      {/* Reason describes what THIS appointment is about — shown on whichever row it was saved to */}
                      {appt.reason && (
                        <p className={`text-xs mt-1 ${isActive ? "text-foreground/80" : "text-muted-foreground/70 italic"}`}>
                          {appt.reason}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        {appt.createdByName ? `Set by ${appt.createdByName}` : ""}{appt.createdByName ? " \u00b7 " : ""}{tsStr}
                      </p>
                    </div>
                    {isActive && canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs flex-shrink-0"
                        onClick={() => {
                          setEditActiveForm({
                            date: appt.scheduledDate,
                            time: appt.scheduledTime || "",
                          });
                          setShowEditActiveDialog(true);
                        }}
                        data-testid="button-edit-active-appt"
                      >
                        <Edit3 className="w-3 h-3 mr-1" /> Edit
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>


        </TabsContent>

        {/* ─── CLAIM TAB ─── */}
        <TabsContent value="claim" className="space-y-5 mt-5">

      {/* Claim Tracking */}
      <Card>
        <CardHeader className="pb-3 border-b border-border"><CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Warranty Claim</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <ClaimBadge status={displayCall.claimStatus ?? call.claimStatus} />
            {(displayCall.claimStatus === "Approved") && <CheckCircle2 className="w-4 h-4 text-green-500" />}
            {(displayCall.claimStatus === "Denied") && <AlertCircle className="w-4 h-4 text-red-500" />}
            {call.claimNumber && (
              <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded" data-testid="claim-number-display">#{call.claimNumber}</span>
            )}
          </div>
          {!isEditing ? (
            <>
              {call.claimNotes ? <p className="text-sm text-foreground whitespace-pre-wrap">{call.claimNotes}</p> : <p className="text-sm text-muted-foreground">No claim notes.</p>}
              {(call.partsCost || call.laborCost || call.otherCost || call.claimAmount) && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 mt-2 border-t border-border">
                  {call.partsCost && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Parts Cost</p>
                      <p className="text-sm font-medium">${parseFloat(call.partsCost).toFixed(2)}</p>
                    </div>
                  )}
                  {call.laborCost && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Labor Cost</p>
                      <p className="text-sm font-medium">${parseFloat(call.laborCost).toFixed(2)}</p>
                    </div>
                  )}
                  {call.otherCost && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Other Cost</p>
                      <p className="text-sm font-medium">${parseFloat(call.otherCost).toFixed(2)}</p>
                    </div>
                  )}
                  {call.claimAmount && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Claim Amount</p>
                      <p className="text-sm font-semibold text-green-600 dark:text-green-400">${parseFloat(call.claimAmount).toFixed(2)}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Claim / Reference Number</label>
                <Input
                  value={(editData.claimNumber ?? call.claimNumber ?? "") as string}
                  onChange={e => setEditData(d => ({ ...d, claimNumber: e.target.value }))}
                  placeholder="e.g. WC-2026-04512"
                  className="h-8 text-sm font-mono"
                  data-testid="edit-claim-number"
                />
              </div>
              <Textarea
                rows={2}
                value={(editData.claimNotes ?? call.claimNotes) as string ?? ""}
                onChange={e => setEditData(d => ({ ...d, claimNotes: e.target.value }))}
                placeholder="Claim notes…"
                className="text-sm"
                data-testid="edit-claim-notes"
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                {[
                  { key: "partsCost", label: "Parts Cost" },
                  { key: "laborCost", label: "Labor Cost" },
                  { key: "otherCost", label: "Other Cost" },
                  { key: "claimAmount", label: "Claim Amount" },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground">{label}</label>
                    <div className="relative mt-0.5">
                      <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={(editData[key as keyof typeof editData] ?? call[key as keyof ServiceCall]) as string ?? ""}
                        onChange={e => setEditData(d => ({ ...d, [key]: e.target.value }))}
                        className="h-8 text-sm pl-7"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>


        </TabsContent>
      </Tabs>

      {/* ─── Globally-mounted dialogs (work from any tab) ─── */}
      {/* Reschedule Dialog — also handles the very first schedule.
          If there's no prior active appointment, we treat this as the initial
          schedule and don't require a reason. */}
      <Dialog open={showRescheduleDialog} onOpenChange={setShowRescheduleDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {(appointments && appointments.length > 0) ? "Reschedule Appointment" : "Schedule Appointment"}
            </DialogTitle>
            <DialogDescription>
              {(appointments && appointments.length > 0)
                ? "The current appointment will be moved to history and a new active appointment will be created. The reason you enter describes the new appointment."
                : "Set the initial scheduled date for this service call."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">New Date <span className="text-red-500">*</span></label>
                <Input
                  type="date"
                  value={reschedForm.date}
                  onChange={e => setReschedForm(f => ({ ...f, date: e.target.value }))}
                  data-testid="reschedule-date"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">New Time</label>
                <Input
                  type="time"
                  value={reschedForm.time}
                  onChange={e => setReschedForm(f => ({ ...f, time: e.target.value }))}
                  data-testid="reschedule-time"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {(appointments && appointments.length > 0) ? <>Reason <span className="text-red-500">*</span></> : <>Note <span className="text-muted-foreground/60">(optional)</span></>}
              </label>
              <Textarea
                value={reschedForm.reason}
                onChange={e => setReschedForm(f => ({ ...f, reason: e.target.value }))}
                placeholder={(appointments && appointments.length > 0)
                  ? "e.g. Received the blower — scheduling the install…"
                  : "Leave blank to use the Issue Description…"}
                className="min-h-[70px] text-sm"
                data-testid="reschedule-reason"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {(appointments && appointments.length > 0)
                  ? "Required — describes the new appointment (not why the old one moved)."
                  : "Optional — only needed if different from the original Issue Description."}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowRescheduleDialog(false)} disabled={rescheduleMutation.isPending}>Cancel</Button>
            <Button
              onClick={() => {
                const isFirstSchedule = !appointments || appointments.length === 0;
                if (!reschedForm.date) {
                  toast({ title: "Missing date", description: "A scheduled date is required.", variant: "destructive" });
                  return;
                }
                if (!isFirstSchedule && !reschedForm.reason.trim()) {
                  toast({ title: "Missing reason", description: "Please describe what the new appointment is for.", variant: "destructive" });
                  return;
                }
                rescheduleMutation.mutate({
                  scheduledDate: reschedForm.date,
                  scheduledTime: reschedForm.time || null,
                  reason: reschedForm.reason.trim(),
                });
              }}
              disabled={rescheduleMutation.isPending}
              data-testid="button-confirm-reschedule"
            >
              {rescheduleMutation.isPending
                ? "Saving…"
                : (appointments && appointments.length > 0) ? "Reschedule" : "Schedule"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Active Appointment Dialog (typo/quick fix — no history entry) */}
      <Dialog open={showEditActiveDialog} onOpenChange={setShowEditActiveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Active Appointment</DialogTitle>
            <DialogDescription>
              Quick fix — update the date or time without creating a history entry. Use this for typos or small corrections.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Date</label>
              <Input
                type="date"
                value={editActiveForm.date}
                onChange={e => setEditActiveForm(f => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Time</label>
              <Input
                type="time"
                value={editActiveForm.time}
                onChange={e => setEditActiveForm(f => ({ ...f, time: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowEditActiveDialog(false)} disabled={editActiveAppointmentMutation.isPending}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editActiveForm.date) {
                  toast({ title: "Missing date", description: "Date is required.", variant: "destructive" });
                  return;
                }
                editActiveAppointmentMutation.mutate({
                  scheduledDate: editActiveForm.date,
                  scheduledTime: editActiveForm.time || null,
                });
              }}
              disabled={editActiveAppointmentMutation.isPending}
              data-testid="button-confirm-edit-active"
            >
              {editActiveAppointmentMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Visit Dialog */}
      <Dialog open={showAddVisit} onOpenChange={(open) => { if (!open) { setShowAddVisit(false); setEditingVisit(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingVisit ? `Edit Visit ${editingVisit.visitNumber}` : "Add Return Visit"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Visit Date *</label>
              <Input
                type="date"
                value={visitForm.visitDate}
                onChange={e => { setVisitForm(f => ({ ...f, visitDate: e.target.value })); setVisitDateError(""); }}
                className="h-8 text-sm"
                data-testid="input-visit-date"
              />
              {visitDateError && <p className="text-xs text-destructive mt-1">{visitDateError}</p>}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Status</label>
              <Select value={visitForm.status} onValueChange={v => setVisitForm(f => ({ ...f, status: v }))}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-visit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Technician</label>
              <Select value={visitForm.technicianId || "__none__"} onValueChange={v => setVisitForm(f => ({ ...f, technicianId: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-visit-tech">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Select —</SelectItem>
                  {techUsers.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Hours on Job</label>
                <Input
                  type="text"
                  value={visitForm.hoursOnJob}
                  onChange={e => setVisitForm(f => ({ ...f, hoursOnJob: e.target.value }))}
                  placeholder="e.g. 2.5"
                  className="h-8 text-sm"
                  data-testid="input-visit-hours"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Miles Traveled</label>
                <Input
                  type="text"
                  value={visitForm.milesTraveled}
                  onChange={e => setVisitForm(f => ({ ...f, milesTraveled: e.target.value }))}
                  placeholder="e.g. 45"
                  className="h-8 text-sm"
                  data-testid="input-visit-miles"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
              <Textarea
                rows={3}
                value={visitForm.notes}
                onChange={e => setVisitForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Visit notes…"
                className="text-sm"
                data-testid="input-visit-notes"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => { setShowAddVisit(false); setEditingVisit(null); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleVisitSubmit} disabled={createVisitMutation.isPending || updateVisitMutation.isPending} data-testid="button-save-visit">
                {(createVisitMutation.isPending || updateVisitMutation.isPending) ? "Saving…" : (editingVisit ? "Update Visit" : "Add Visit")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fixed save bar at bottom of viewport */}
      {isEditing && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur border-t border-border md:left-[216px]">
          <div className="max-w-4xl mx-auto px-4 md:px-6 py-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={cancelEdit} data-testid="button-cancel-edit-bottom">
              <X className="w-4 h-4 mr-1.5" /> Cancel
            </Button>
            <Button size="sm" onClick={() => saveEdit()} disabled={updateMutation.isPending} data-testid="button-save-edit-bottom">
              <Save className="w-4 h-4 mr-1.5" />
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>
      )}

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
      {/* Completion Warning Dialog */}
      <Dialog open={showCompletePrompt} onOpenChange={setShowCompletePrompt}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Missing Hours or Miles</DialogTitle>
            <DialogDescription>
              {(() => {
                const effectiveHours = (editData.hoursOnJob ?? call?.hoursOnJob) as string | null;
                const effectiveMiles = (editData.milesTraveled ?? call?.milesTraveled) as string | null;
                const missingHours = !effectiveHours || parseFloat(effectiveHours) <= 0;
                const missingMiles = !effectiveMiles || parseFloat(effectiveMiles) <= 0;
                const missing = [missingHours && "Hours on Job", missingMiles && "Miles Traveled"].filter(Boolean).join(" and ");
                return `${missing} ${missingHours && missingMiles ? "have" : "has"} not been entered. These fields auto-populate invoices.`;
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowCompletePrompt(false)}>Fill In First</Button>
            <Button onClick={() => { setShowCompletePrompt(false); saveEdit(true); }}>Mark Complete Anyway</Button>
          </div>
        </DialogContent>
      </Dialog>

      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
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
