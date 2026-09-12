import type { Map as MapLibreMap, PointLike } from "maplibre-gl";
import { PUBLIC_DATA_FILES } from "../domain/publicData.ts";
import { LABEL_FONT } from "./baseStyle.ts";

const SOURCE = "ports";
const CIRCLE_LAYER = "ports-circle";

/** 港の点を出し始めるズーム。日本全体を見ているときは航路線だけにする（docs/spec.md「港」）。 */
export const PORT_MIN_ZOOM = 7;
const LABEL_MIN_ZOOM = 8;

export function addPortLayers(map: MapLibreMap, dataBaseUrl: string): void {
  map.addSource(SOURCE, { type: "geojson", data: `${dataBaseUrl}${PUBLIC_DATA_FILES.ports}` });
  map.addLayer({
    id: CIRCLE_LAYER,
    type: "circle",
    source: SOURCE,
    minzoom: PORT_MIN_ZOOM,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], PORT_MIN_ZOOM, 3, 12, 6],
      "circle-color": "#ffffff",
      "circle-stroke-color": "#14213D",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "ports-label",
    type: "symbol",
    source: SOURCE,
    minzoom: LABEL_MIN_ZOOM,
    layout: {
      "text-field": ["get", "name"],
      "text-font": LABEL_FONT,
      "text-size": 13,
      "text-variable-anchor": ["top", "bottom", "left", "right"],
      "text-radial-offset": 0.8,
      "text-justify": "auto",
    },
    paint: {
      "text-color": "#14213D",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5,
    },
  });
}

/** 画面上の点の近くにある港の ID（最も近いものから）。 */
export function portIdsNear(
  map: MapLibreMap,
  point: { x: number; y: number },
  radius = window.matchMedia?.("(pointer: coarse)").matches ? 16 : 10,
): string[] {
  const box: [PointLike, PointLike] = [
    [point.x - radius, point.y - radius],
    [point.x + radius, point.y + radius],
  ];
  return map
    .queryRenderedFeatures(box, { layers: [CIRCLE_LAYER] })
    .map((f) => String(f.properties.portId));
}
