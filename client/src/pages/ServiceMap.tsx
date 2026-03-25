import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MapPin, Loader2, Navigation, ExternalLink } from "lucide-react";
import { MANUFACTURERS, SERVICE_STATUSES } from "@shared/schema";

// Fix Leaflet default icon issue with bundlers
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

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

const iconCache = new Map<string, L.DivIcon>();
function getManufacturerIcon(manufacturer: string): L.DivIcon {
  const color = MANUFACTURER_COLORS[manufacturer] || MANUFACTURER_COLORS["Other"];
  if (!iconCache.has(color)) {
    iconCache.set(color, createColoredIcon(color));
  }
  return iconCache.get(color)!;
}

interface MapPoint {
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

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "Scheduled": "outline",
  "In Progress": "default",
  "Completed": "secondary",
  "Pending Parts": "destructive",
  "Escalated": "destructive",
};

export default function ServiceMap() {
  const { toast } = useToast();
  const [manufacturer, setManufacturer] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Build query params
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (manufacturer && manufacturer !== "all") params.set("manufacturer", manufacturer);
    if (status && status !== "all") params.set("status", status);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params.toString();
  }, [manufacturer, status, dateFrom, dateTo]);

  const { data: mapData = [], isLoading } = useQuery<MapPoint[]>({
    queryKey: ["/api/analytics/map-data", queryParams],
    queryFn: async () => {
      const url = queryParams ? `/api/analytics/map-data?${queryParams}` : "/api/analytics/map-data";
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const geocodeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/geocode-all");
      return res.json();
    },
    onSuccess: (data: { geocoded: number; total: number }) => {
      toast({
        title: "Geocoding complete",
        description: `Geocoded ${data.geocoded} of ${data.total} service calls.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/map-data"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Geocoding failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-dvh" data-testid="service-map-page">
      {/* Header / Filter Bar */}
      <div className="flex-shrink-0 border-b bg-background px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold" data-testid="text-map-title">Service Territory Map</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => geocodeMutation.mutate()}
            disabled={geocodeMutation.isPending}
            data-testid="button-geocode-all"
          >
            {geocodeMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Navigation className="w-4 h-4 mr-2" />
            )}
            Geocode All
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 items-end">
          <div className="w-full sm:w-48">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Manufacturer</label>
            <Select value={manufacturer} onValueChange={setManufacturer} data-testid="select-manufacturer-filter">
              <SelectTrigger className="h-9 text-sm" data-testid="select-manufacturer-trigger">
                <SelectValue placeholder="All Manufacturers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Manufacturers</SelectItem>
                {MANUFACTURERS.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-full sm:w-40">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
            <Select value={status} onValueChange={setStatus} data-testid="select-status-filter">
              <SelectTrigger className="h-9 text-sm" data-testid="select-status-trigger">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {SERVICE_STATUSES.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-full sm:w-auto">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">From</label>
            <Input
              type="date"
              className="h-9 text-sm w-full sm:w-36"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              data-testid="input-date-from"
            />
          </div>

          <div className="w-full sm:w-auto">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">To</label>
            <Input
              type="date"
              className="h-9 text-sm w-full sm:w-36"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              data-testid="input-date-to"
            />
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground ml-auto">
            <Badge variant="outline" className="font-normal" data-testid="text-marker-count">
              {mapData.length} marker{mapData.length !== 1 ? "s" : ""}
            </Badge>
          </div>
        </div>
      </div>

      {/* Map Area */}
      <div className="flex-1 relative" data-testid="map-container">
        {isLoading && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-background/60">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}
        <MapContainer
          center={[41.5, -111.8]}
          zoom={7}
          className="w-full h-full"
          style={{ width: "100%", height: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {mapData.map(point => (
            <Marker
              key={point.id}
              position={[point.lat, point.lng]}
              icon={getManufacturerIcon(point.manufacturer)}
            >
              <Popup>
                <div className="min-w-[200px] text-sm" data-testid={`popup-call-${point.id}`}>
                  <div className="font-semibold text-base mb-1">{point.customerName}</div>
                  <div className="text-muted-foreground mb-2">{point.jobSiteName}</div>
                  <div className="space-y-1 text-xs">
                    <div><span className="font-medium">Location:</span> {point.jobSiteCity}, {point.jobSiteState}</div>
                    <div>
                      <span className="font-medium">Manufacturer:</span>{" "}
                      <span style={{ color: MANUFACTURER_COLORS[point.manufacturer] || MANUFACTURER_COLORS["Other"] }}>
                        {point.manufacturer}
                      </span>
                    </div>
                    <div><span className="font-medium">Model:</span> {point.productModel}</div>
                    <div><span className="font-medium">Date:</span> {point.callDate}</div>
                    <div>
                      <span className="font-medium">Status:</span>{" "}
                      <Badge
                        variant={STATUS_BADGE_VARIANT[point.status] || "outline"}
                        className="text-[10px] px-1.5 py-0"
                        data-testid={`badge-status-${point.id}`}
                      >
                        {point.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t">
                    <Link href={`/calls/${point.id}`} data-testid={`link-view-call-${point.id}`}>
                      <span className="text-primary hover:underline text-xs font-medium inline-flex items-center gap-1">
                        View Details <ExternalLink className="w-3 h-3" />
                      </span>
                    </Link>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* Legend */}
        <div
          className="absolute bottom-4 right-4 z-[1000] bg-background/95 backdrop-blur border rounded-lg p-3 shadow-lg max-w-[180px]"
          data-testid="map-legend"
        >
          <div className="text-xs font-semibold mb-2">Manufacturers</div>
          <div className="space-y-1">
            {Object.entries(MANUFACTURER_COLORS)
              .filter(([key]) => key !== "Other")
              .map(([name, color]) => (
                <div key={name} className="flex items-center gap-2 text-[11px]">
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate">{name.replace(" Water Heaters", "").replace(" Water Technologies", "").replace(" Valve Company", "").replace(" Controls", "").replace(" Leak Defense", "")}</span>
                </div>
              ))}
            <div className="flex items-center gap-2 text-[11px]">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: MANUFACTURER_COLORS["Other"] }}
              />
              <span>Other</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom spacing to avoid bottom nav overlap */}
      <div className="h-14 md:hidden flex-shrink-0" />
    </div>
  );
}
