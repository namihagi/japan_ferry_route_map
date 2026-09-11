import type { Map as MapLibreMap } from "maplibre-gl";
import { PUBLIC_DATA_FILES } from "../domain/publicData.ts";

const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

/** 公開データの航路（区間ごとの線）を地図に重ねる。色分けなどの見た目は M4 で作り込む。 */
export function addRouteLayers(map: MapLibreMap, dataBaseUrl: string): void {
  map.addSource("routes", {
    type: "geojson",
    data: `${dataBaseUrl}${PUBLIC_DATA_FILES.routes}`,
    attribution: OSM_ATTRIBUTION,
  });
  map.addLayer({
    id: "routes",
    type: "line",
    source: "routes",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": "#1d4ed8",
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 10, 3],
    },
  });
}
