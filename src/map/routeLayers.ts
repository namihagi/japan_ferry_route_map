import type { ExpressionSpecification, Map as MapLibreMap, PointLike } from "maplibre-gl";
import { SUSPENDED_COLOR, VESSEL_TYPE_COLORS } from "../domain/labels.ts";
import { PUBLIC_DATA_FILES } from "../domain/publicData.ts";

const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

const SOURCE = "routes";
/** 実測形状（実線）と推定形状（点線）のレイヤー。クリックの判定もこの2つで行う。 */
export const ROUTE_LAYERS = ["routes-osm", "routes-estimated"] as const;
const CASING_LAYER = "routes-casing";

const OSM_ONLY: ExpressionSpecification = ["==", ["get", "geometrySource"], "osm"];
const ESTIMATED_ONLY: ExpressionSpecification = ["==", ["get", "geometrySource"], "estimated"];

/**
 * 船種ごとの色。色の値は labels.ts の VESSEL_TYPE_COLORS が持つ（labels.ts の routeColor と同じ規則）。
 * 船種を増やしたらここにも 1 行足す。
 */
const COLOR: ExpressionSpecification = [
  "case",
  ["==", ["get", "status"], "suspended"],
  SUSPENDED_COLOR,
  [
    "match",
    ["get", "vesselType"],
    "highspeed",
    VESSEL_TYPE_COLORS.highspeed,
    "passenger",
    VESSEL_TYPE_COLORS.passenger,
    VESSEL_TYPE_COLORS.ferry,
  ],
];

/** 指で押せる大きさにする。細い線は数ピクセルの判定では当たらない。 */
function tapRadius(fine: number, coarse: number): number {
  return window.matchMedia?.("(pointer: coarse)").matches ? coarse : fine;
}

function isHighlighted(routeIds: readonly string[]): ExpressionSpecification {
  return ["in", ["get", "routeId"], ["literal", [...routeIds]]];
}

/** ハイライト中の航路は太く、それ以外は細く描く。 */
function lineWidth(routeIds: readonly string[] | null, extra = 0): ExpressionSpecification {
  const width = (normal: number, highlighted: number): number | ExpressionSpecification =>
    routeIds === null
      ? normal + extra
      : ["case", isHighlighted(routeIds), highlighted + extra, normal + extra];
  return ["interpolate", ["linear"], ["zoom"], 4, width(1.6, 3), 10, width(3, 5)];
}

function lineOpacity(routeIds: readonly string[] | null): number | ExpressionSpecification {
  return routeIds === null ? 1 : ["case", isHighlighted(routeIds), 1, 0.25];
}

/**
 * 公開データの航路（区間ごとの線）を地図に重ねる。
 * 色は船種ごと（休止中は灰色）、推定形状の区間は点線。線の下に白いふちを敷いて背景地図から浮かせる。
 */
export function addRouteLayers(map: MapLibreMap, dataBaseUrl: string): void {
  map.addSource(SOURCE, {
    type: "geojson",
    data: `${dataBaseUrl}${PUBLIC_DATA_FILES.routes}`,
    attribution: OSM_ATTRIBUTION,
  });
  map.addLayer({
    id: CASING_LAYER,
    type: "line",
    source: SOURCE,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#ffffff", "line-width": lineWidth(null, 2), "line-opacity": 0.9 },
  });
  map.addLayer({
    id: "routes-osm",
    type: "line",
    source: SOURCE,
    filter: OSM_ONLY,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": COLOR, "line-width": lineWidth(null) },
  });
  map.addLayer({
    id: "routes-estimated",
    type: "line",
    source: SOURCE,
    filter: ESTIMATED_ONLY,
    layout: { "line-join": "round" },
    paint: { "line-color": COLOR, "line-width": lineWidth(null), "line-dasharray": [2, 1.5] },
  });
}

/** 絞り込みの条件を、すべての航路レイヤーに適用する。 */
export function setRouteFilter(map: MapLibreMap, filter: ExpressionSpecification): void {
  map.setFilter(CASING_LAYER, filter);
  map.setFilter("routes-osm", ["all", OSM_ONLY, filter]);
  map.setFilter("routes-estimated", ["all", ESTIMATED_ONLY, filter]);
}

/** 指定した航路を目立たせる。null で元に戻す。 */
export function highlightRoutes(map: MapLibreMap, routeIds: readonly string[] | null): void {
  map.setPaintProperty(CASING_LAYER, "line-width", lineWidth(routeIds, 2));
  map.setPaintProperty(
    CASING_LAYER,
    "line-opacity",
    routeIds === null ? 0.9 : lineOpacity(routeIds),
  );
  for (const layer of ROUTE_LAYERS) {
    map.setPaintProperty(layer, "line-width", lineWidth(routeIds));
    map.setPaintProperty(layer, "line-opacity", lineOpacity(routeIds));
  }
}

/** 画面上の点の近く（タップしやすいよう数ピクセルの幅を持たせる）を通る航路の ID。 */
export function routeIdsNear(
  map: MapLibreMap,
  point: { x: number; y: number },
  radius = tapRadius(8, 14),
): string[] {
  const box: [PointLike, PointLike] = [
    [point.x - radius, point.y - radius],
    [point.x + radius, point.y + radius],
  ];
  const features = map.queryRenderedFeatures(box, { layers: [...ROUTE_LAYERS] });
  return [...new Set(features.map((f) => String(f.properties.routeId)))];
}
