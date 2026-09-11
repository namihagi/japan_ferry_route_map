/**
 * データ生成スクリプト（scripts/build-data.ts）が public/data/ に書き出し、
 * 画面側が読み込む公開データの形。
 */

/** 船種。表示名は フェリー / 高速船 / 旅客船。 */
export type VesselType = "ferry" | "highspeed" | "passenger";

/** 運航状態。表示名は 運航中 / 休止中。 */
export type RouteStatus = "operating" | "suspended";

/** 区間の航路形状がどこから来たか。 */
export type GeometrySource = "osm" | "estimated";

/** routes.geojson の各フィーチャー（1区間 = 1フィーチャー）のプロパティ。 */
export interface LegFeatureProperties {
  routeId: string;
  legIndex: number;
  name: string;
  operator: string;
  vesselType: VesselType;
  status: RouteStatus;
  geometrySource: GeometrySource;
}

/** ports.geojson の各フィーチャーのプロパティ。 */
export interface PortFeatureProperties {
  portId: string;
  name: string;
}

/** public/data/ 以下のファイル名。 */
export const PUBLIC_DATA_FILES = {
  routes: "routes.geojson",
  ports: "ports.geojson",
} as const;
