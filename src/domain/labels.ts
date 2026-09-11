import type { RouteStatus, VesselType } from "./publicData.ts";

export const VESSEL_TYPES: readonly VesselType[] = ["ferry", "highspeed", "passenger"];
export const ROUTE_STATUSES: readonly RouteStatus[] = ["operating", "suspended"];

export const VESSEL_TYPE_LABELS: Record<VesselType, string> = {
  ferry: "フェリー",
  highspeed: "高速船",
  passenger: "旅客船",
};

export const STATUS_LABELS: Record<RouteStatus, string> = {
  operating: "運航中",
  suspended: "休止中",
};

/** 航路線の色。色覚の多様性に配慮した Okabe-Ito の配色から選んでいる。 */
export const VESSEL_TYPE_COLORS: Record<VesselType, string> = {
  ferry: "#0072B2",
  highspeed: "#D55E00",
  passenger: "#009E73",
};

/** 休止中の航路の色（船種によらない）。 */
export const SUSPENDED_COLOR = "#8A94A3";

export function routeColor(vesselType: VesselType, status: RouteStatus): string {
  return status === "suspended" ? SUSPENDED_COLOR : VESSEL_TYPE_COLORS[vesselType];
}

/** 所要時間（分）を「約1時間40分」の形にする。 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `約${rest}分`;
  return rest === 0 ? `約${hours}時間` : `約${hours}時間${rest}分`;
}
