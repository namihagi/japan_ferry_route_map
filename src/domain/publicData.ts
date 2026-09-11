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

/** route-details.json の各要素。地図で航路を選んだときに見せる情報。 */
export interface RouteDetail {
  id: string;
  name: string;
  operator: string;
  vesselType: VesselType;
  status: RouteStatus;
  seasonal: boolean;
  officialUrl: string;
  durationMinutes?: number;
  /** 寄港地（代表的な順序） */
  portsOfCall: { id: string; name: string }[];
  /** 推定形状の区間を含むか */
  hasEstimatedLegs: boolean;
}

/** public/data/ 以下のファイル名。 */
export const PUBLIC_DATA_FILES = {
  routes: "routes.geojson",
  ports: "ports.geojson",
  routeDetails: "route-details.json",
} as const;
