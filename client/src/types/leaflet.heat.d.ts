// Minimal module shim for leaflet.heat, which ships no type definitions.
// It augments the Leaflet namespace with the heatLayer factory it adds.
import "leaflet";

declare module "leaflet" {
  type HeatLatLngTuple = [number, number, number?];

  interface HeatMapOptions {
    minOpacity?: number;
    maxZoom?: number;
    max?: number;
    radius?: number;
    blur?: number;
    gradient?: Record<number, string>;
  }

  interface HeatLayer extends Layer {
    setLatLngs(latlngs: HeatLatLngTuple[]): this;
    addLatLng(latlng: HeatLatLngTuple): this;
    setOptions(options: HeatMapOptions): this;
    redraw(): this;
  }

  function heatLayer(latlngs: HeatLatLngTuple[], options?: HeatMapOptions): HeatLayer;
}

declare module "leaflet.heat";
