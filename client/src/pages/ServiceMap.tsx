import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.heat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Navigation, Crosshair, RefreshCw } from "lucide-react";
import { MANUFACTURERS, SERVICE_STATUSES } from "@shared/schema";
import { subDays, format } from "date-fns";

// Escape user content before injecting into Leaflet popup HTML
function escHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Colored marker icons for manufacturers
const MANUFACTURER_COLORS: Record<string, string> = {
  "A.O. Smith Water Heaters": "#2563EB",
  "State Water Heaters": "#16A34A",
  "Watts Water Technologies": "#DC2626",
  "American Water Heaters": "#9333EA",
  "Powers Controls": "#EA580C",
  "Sloan Valve Company": "#0891B2",
  "Watts ACV": "#E11D48",
  "Watts Leak Defense": "#4F46E5",
  "Other": "#6B7280",
};

// Distinct colors per service status (Phase 3 color-by-status mode).
const STATUS_COLORS: Record<string, string> = {
  "Scheduled": "#2563EB",
  "In Progress": "#EA580C",
  "Completed": "#16A34A",
  "Pending Parts": "#CA8A04",
  "Escalated": "#DC2626",
};
const STATUS_FALLBACK = "#6B7280";

// Utah bounding box (approx). The default view always shows all of Utah and
// only widens outward (e.g. southern Idaho) when pins fall outside it.
const UTAH_BOUNDS = L.latLngBounds([[36.95, -114.10], [42.05, -109.00]]);

function createColoredIcon(color: string, locked: boolean) {
  const lockBadge = locked
    ? `<circle cx="19" cy="6" r="5" fill="#111827" stroke="#fff" stroke-width="1"/>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="5" fill="#fff"/>
    ${lockBadge}
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [24, 36],
    iconAnchor: [12, 36],
    popupAnchor: [0, -36],
  });
}

interface MapCallData {
  id: number;
  lat: number;
  lng: number;
  manufacturer: string;
  status: string;
  customerName: string;
  jobSiteName: string;
  jobSiteCity: string;
  jobSiteState: string;
  productModel: string;
  callDate: string;
  coordsLocked: number;
}

interface NeedsGeocodingCall {
  id: number;
  customerName: string;
  jobSiteName: string;
  jobSiteAddress: string;
  jobSiteCity: string;
  jobSiteState: string;
  callDate: string;
}

interface GeocodeJobStatus {
  running: boolean;
  total: number;
  done: number;
  geocoded: number;
  startedAt: string | null;
  finishedAt: string | null;
}

type ColorMode = "manufacturer" | "status";
type ViewMode = "pins" | "heat";

export default function ServiceMap() {
  const { toast } = useToast();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const heatRef = useRef<L.HeatLayer | null>(null);
  const didInitialFitRef = useRef(false);

  const canEdit = getUser()?.role !== "staff";

  const defaultFrom = format(subDays(new Date(), 365), "yyyy-MM-dd");
  const defaultTo = format(new Date(), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [manufacturer, setManufacturer] = useState("");
  const [status, setStatus] = useState("");
  const [colorMode, setColorMode] = useState<ColorMode>("manufacturer");
  const [viewMode, setViewMode] = useState<ViewMode>("pins");
  const [showNeedsPanel, setShowNeedsPanel] = useState(false);
  const [geocodePolling, setGeocodePolling] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState<{ done: number; total: number } | null>(null);

  const params = new URLSearchParams();
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (manufacturer) params.set("manufacturer", manufacturer);
  if (status) params.set("status", status);
  const qs = params.toString();

  const { data: mapData, isLoading } = useQuery<MapCallData[]>({
    queryKey: ["/api/analytics/map-data", qs],
    queryFn: async () => {
      const url = qs ? `/api/analytics/map-data?${qs}` : "/api/analytics/map-data";
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const { data: needsGeocoding } = useQuery<NeedsGeocodingCall[]>({
    queryKey: ["/api/analytics/needs-geocoding"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/analytics/needs-geocoding");
      return res.json();
    },
  });

  const calls = useMemo(() => mapData ?? [], [mapData]);

  // ─── Geocode-all background job ────────────────────────────────────────────
  const startGeocodeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/geocode-all");
      return res.json();
    },
    onSuccess: () => {
      setGeocodePolling(true);
      setGeocodeProgress({ done: 0, total: 0 });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!geocodePolling) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await apiRequest("GET", "/api/geocode-all/status");
        const job: GeocodeJobStatus = await res.json();
        if (cancelled) return;
        setGeocodeProgress({ done: job.done, total: job.total });
        if (!job.running) {
          setGeocodePolling(false);
          toast({ title: "Geocoding complete", description: `${job.geocoded} calls geocoded.` });
          queryClient.invalidateQueries({ queryKey: ["/api/analytics/map-data"] });
          queryClient.invalidateQueries({ queryKey: ["/api/analytics/needs-geocoding"] });
        }
      } catch {
        if (!cancelled) setGeocodePolling(false);
      }
    };
    poll();
    const interval = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [geocodePolling, toast]);

  // ─── Per-call geocode retry ────────────────────────────────────────────────
  const retryGeocodeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/service-calls/${id}/geocode`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Geocoded", description: "Coordinates updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/map-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/needs-geocoding"] });
    },
    onError: (e: any) => toast({ title: "Geocode failed", description: e.message, variant: "destructive" }),
  });

  // ─── Manual pin move (drag-to-correct) ─────────────────────────────────────
  const moveCoordsMutation = useMutation({
    mutationFn: async (vars: { id: number; latitude: number; longitude: number }) => {
      const res = await apiRequest("POST", `/api/service-calls/${vars.id}/coords`, {
        latitude: vars.latitude,
        longitude: vars.longitude,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pin saved", description: "Location updated and locked." });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/map-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/needs-geocoding"] });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/map-data"] });
    },
  });

  function colorFor(call: MapCallData): string {
    if (colorMode === "status") {
      return STATUS_COLORS[call.status] || STATUS_FALLBACK;
    }
    return MANUFACTURER_COLORS[call.manufacturer] || MANUFACTURER_COLORS["Other"];
  }

  function fitToUtah() {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.fitBounds(UTAH_BOUNDS, { padding: [30, 30] });
    }
  }

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, { zoomControl: true });
    map.fitBounds(UTAH_BOUNDS);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    clusterRef.current = L.markerClusterGroup();
    map.addLayer(clusterRef.current);
    mapInstanceRef.current = map;

    // Force a resize after mount to fix gray tiles
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      clusterRef.current = null;
      heatRef.current = null;
    };
  }, []);

  // Rebuild markers / heat layer when data, color mode, or view mode changes.
  useEffect(() => {
    const map = mapInstanceRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;

    cluster.clearLayers();

    for (const call of calls) {
      const icon = createColoredIcon(colorFor(call), !!call.coordsLocked);
      const marker = L.marker([call.lat, call.lng], { icon, draggable: canEdit });

      const lockedNote = call.coordsLocked
        ? `<div style="font-size: 10px; color: #111827; margin-top: 4px; font-weight: 600;">📌 Manually placed</div>`
        : "";
      marker.bindPopup(`
        <div style="font-family: sans-serif; min-width: 200px;">
          <div style="font-weight: 700; font-size: 13px; margin-bottom: 4px;">${escHtml(call.customerName)}</div>
          <div style="font-size: 12px; color: #64748b; margin-bottom: 6px;">${escHtml(call.jobSiteName)}</div>
          <div style="font-size: 11px; margin-bottom: 2px;"><strong>Manufacturer:</strong> ${escHtml(call.manufacturer)}</div>
          <div style="font-size: 11px; margin-bottom: 2px;"><strong>Model:</strong> ${escHtml(call.productModel)}</div>
          <div style="font-size: 11px; margin-bottom: 2px;"><strong>Date:</strong> ${escHtml(call.callDate)}</div>
          <div style="font-size: 11px; margin-bottom: 6px;"><strong>Status:</strong> ${escHtml(call.status)}</div>
          <div style="font-size: 11px; margin-bottom: 2px;">${escHtml(call.jobSiteCity)}, ${escHtml(call.jobSiteState)}</div>
          <a href="#/calls/${Number(call.id)}" style="font-size: 11px; color: hsl(200, 72%, 40%); text-decoration: none; font-weight: 600;">View Details →</a>
          ${lockedNote}
        </div>
      `);

      if (canEdit) {
        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          const ok = window.confirm(
            `Move this pin and lock its location?\n${call.customerName || "Call"} → ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`
          );
          if (ok) {
            moveCoordsMutation.mutate({ id: call.id, latitude: pos.lat, longitude: pos.lng });
          } else {
            marker.setLatLng([call.lat, call.lng]);
          }
        });
      }

      cluster.addLayer(marker);
    }

    // Heat layer rebuild
    if (heatRef.current) {
      map.removeLayer(heatRef.current);
      heatRef.current = null;
    }
    if (viewMode === "heat") {
      if (map.hasLayer(cluster)) map.removeLayer(cluster);
      const points: [number, number, number][] = calls.map(c => [c.lat, c.lng, 0.6]);
      heatRef.current = L.heatLayer(points, { radius: 25, blur: 15 });
      map.addLayer(heatRef.current);
    } else {
      if (!map.hasLayer(cluster)) map.addLayer(cluster);
    }

    // Fit view: union of Utah with pin bounds, never tighter than Utah. Only on
    // first data arrival to avoid jarring re-fits on every filter tweak.
    if (!didInitialFitRef.current && calls.length > 0) {
      const bounds = L.latLngBounds(UTAH_BOUNDS.getSouthWest(), UTAH_BOUNDS.getNorthEast());
      for (const c of calls) bounds.extend([c.lat, c.lng]);
      map.fitBounds(bounds, { padding: [30, 30] });
      didInitialFitRef.current = true;
    }
  }, [calls, colorMode, viewMode, canEdit]);

  const needsCount = needsGeocoding?.length ?? 0;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-[calc(100vh-2.75rem)]" data-testid="service-map-page">
      {/* Page Hero (compact for map layout) */}
      <div className="px-4 md:px-6 py-3 md:py-4 bg-card border-b border-border/50">
        <div className="flex items-center justify-between gap-3 max-w-[1400px] mx-auto">
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">Map</h1>
            <p className="text-xs md:text-sm text-muted-foreground mt-0.5">Service calls plotted by location</p>
          </div>
        </div>
      </div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-background border-b border-border">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground whitespace-nowrap">From</label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-xs w-32" />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground whitespace-nowrap">To</label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-xs w-32" />
        </div>
        <Select value={manufacturer || "__all__"} onValueChange={v => setManufacturer(v === "__all__" ? "" : v)}>
          <SelectTrigger className="h-8 text-xs w-44" data-testid="filter-manufacturer">
            <SelectValue placeholder="All Manufacturers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Manufacturers</SelectItem>
            {MANUFACTURERS.filter(m => m !== "Other").map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status || "__all__"} onValueChange={v => setStatus(v === "__all__" ? "" : v)}>
          <SelectTrigger className="h-8 text-xs w-36" data-testid="filter-status">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Statuses</SelectItem>
            {SERVICE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={colorMode} onValueChange={v => setColorMode(v as ColorMode)}>
          <SelectTrigger className="h-8 text-xs w-36" data-testid="toggle-color-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manufacturer">Color: Manufacturer</SelectItem>
            <SelectItem value="status">Color: Status</SelectItem>
          </SelectContent>
        </Select>
        <Select value={viewMode} onValueChange={v => setViewMode(v as ViewMode)}>
          <SelectTrigger className="h-8 text-xs w-28" data-testid="toggle-view-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pins">Pins</SelectItem>
            <SelectItem value="heat">Heat</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={fitToUtah}
          className="h-8 text-xs"
          data-testid="button-fit-utah"
        >
          <Crosshair className="w-3 h-3 mr-1" />
          Fit to Utah
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => startGeocodeMutation.mutate()}
          disabled={startGeocodeMutation.isPending || geocodePolling}
          className="h-8 text-xs"
          data-testid="button-geocode-all"
        >
          {geocodePolling ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Navigation className="w-3 h-3 mr-1" />}
          {geocodePolling && geocodeProgress
            ? `Geocoding ${geocodeProgress.done}/${geocodeProgress.total}`
            : "Geocode All"}
        </Button>
        {needsCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowNeedsPanel(v => !v)}
            className="h-8 text-xs"
            data-testid="button-needs-geocoding"
          >
            {needsCount} need geocoding
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {isLoading ? "Loading..." : `${calls.length} pins`}
        </span>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <div ref={mapRef} className="absolute inset-0" style={{ zIndex: 1 }} />

        {/* Needs-geocoding panel */}
        {showNeedsPanel && needsCount > 0 && (
          <div
            className="absolute top-4 left-4 bg-background/97 border border-border rounded-lg shadow-lg text-xs w-80 max-h-[60vh] overflow-y-auto"
            style={{ zIndex: 1000 }}
            data-testid="panel-needs-geocoding"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-background/97">
              <span className="font-semibold uppercase text-[10px] tracking-wide text-muted-foreground">
                Needs Geocoding ({needsCount})
              </span>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setShowNeedsPanel(false)}>✕</button>
            </div>
            <div className="divide-y divide-border">
              {(needsGeocoding ?? []).map(c => (
                <div key={c.id} className="px-3 py-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <a href={`#/calls/${c.id}`} className="font-medium text-foreground hover:underline truncate block">
                      {c.customerName || c.jobSiteName || `Call #${c.id}`}
                    </a>
                    <div className="text-muted-foreground truncate">
                      {[c.jobSiteAddress, c.jobSiteCity, c.jobSiteState].filter(Boolean).join(", ")}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs flex-shrink-0"
                    onClick={() => retryGeocodeMutation.mutate(c.id)}
                    disabled={retryGeocodeMutation.isPending}
                    data-testid={`button-retry-geocode-${c.id}`}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Retry
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 right-4 bg-background/95 border border-border rounded-lg p-3 shadow-md text-xs space-y-1.5 max-h-60 overflow-y-auto" style={{ zIndex: 1000 }}>
          <p className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wide mb-1">Legend</p>
          {colorMode === "status"
            ? SERVICE_STATUSES.map(name => (
                <div key={name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[name] || STATUS_FALLBACK }} />
                  <span className="text-foreground truncate">{name}</span>
                </div>
              ))
            : Object.entries(MANUFACTURER_COLORS).filter(([k]) => k !== "Other").map(([name, color]) => (
                <div key={name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-foreground truncate">{name}</span>
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}
