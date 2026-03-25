import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Navigation } from "lucide-react";
import { MANUFACTURERS, SERVICE_STATUSES } from "@shared/schema";
import { subDays, format } from "date-fns";

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

function createColoredIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="5" fill="#fff"/>
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
}

export default function ServiceMap() {
  const { toast } = useToast();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  const defaultFrom = format(subDays(new Date(), 365), "yyyy-MM-dd");
  const defaultTo = format(new Date(), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [manufacturer, setManufacturer] = useState("");
  const [status, setStatus] = useState("");

  const params = new URLSearchParams();
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (manufacturer) params.set("manufacturer", manufacturer);
  const qs = params.toString();

  const { data: mapData, isLoading } = useQuery<MapCallData[]>({
    queryKey: ["/api/analytics/map-data", qs],
    queryFn: async () => {
      const url = qs ? `/api/analytics/map-data?${qs}` : "/api/analytics/map-data";
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const geocodeAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/geocode-all");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Geocoding complete", description: `${data.geocoded} calls geocoded.` });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/map-data"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Filter by status client-side
  const filteredData = useMemo(() => {
    if (!mapData) return [];
    if (!status) return mapData;
    return mapData.filter(d => d.status === status);
  }, [mapData, status]);

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [41.5, -111.8],
      zoom: 7,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    markersRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    // Force a resize after mount to fix gray tiles
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Update markers when data changes
  useEffect(() => {
    if (!markersRef.current || !mapInstanceRef.current) return;

    markersRef.current.clearLayers();

    for (const call of filteredData) {
      const color = MANUFACTURER_COLORS[call.manufacturer] || MANUFACTURER_COLORS["Other"];
      const icon = createColoredIcon(color);
      const marker = L.marker([call.lat, call.lng], { icon });

      marker.bindPopup(`
        <div style="font-family: sans-serif; min-width: 200px;">
          <div style="font-weight: 700; font-size: 13px; margin-bottom: 4px;">${call.customerName}</div>
          <div style="font-size: 12px; color: #64748b; margin-bottom: 6px;">${call.jobSiteName}</div>
          <div style="font-size: 11px; margin-bottom: 2px;"><strong>Manufacturer:</strong> ${call.manufacturer}</div>
          <div style="font-size: 11px; margin-bottom: 2px;"><strong>Model:</strong> ${call.productModel}</div>
          <div style="font-size: 11px; margin-bottom: 2px;"><strong>Date:</strong> ${call.callDate}</div>
          <div style="font-size: 11px; margin-bottom: 6px;"><strong>Status:</strong> ${call.status}</div>
          <div style="font-size: 11px; margin-bottom: 2px;">${call.jobSiteCity}, ${call.jobSiteState}</div>
          <a href="#/calls/${call.id}" style="font-size: 11px; color: #2563EB; text-decoration: none; font-weight: 600;">View Details →</a>
        </div>
      `);

      marker.addTo(markersRef.current!);
    }
  }, [filteredData]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen" data-testid="service-map-page">
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => geocodeAllMutation.mutate()}
          disabled={geocodeAllMutation.isPending}
          className="h-8 text-xs"
          data-testid="button-geocode-all"
        >
          {geocodeAllMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Navigation className="w-3 h-3 mr-1" />}
          Geocode All
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {isLoading ? "Loading..." : `${filteredData.length} pins`}
        </span>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <div ref={mapRef} className="absolute inset-0" style={{ zIndex: 1 }} />

        {/* Legend */}
        <div className="absolute bottom-4 right-4 bg-background/95 border border-border rounded-lg p-3 shadow-md text-xs space-y-1.5 max-h-60 overflow-y-auto" style={{ zIndex: 1000 }}>
          <p className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wide mb-1">Legend</p>
          {Object.entries(MANUFACTURER_COLORS).filter(([k]) => k !== "Other").map(([name, color]) => (
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
