import type { ExpressionSpecification } from "maplibre-gl";
import { ROUTE_STATUSES, VESSEL_TYPES } from "./labels.ts";
import type { RouteDetail, RouteStatus, VesselType } from "./publicData.ts";

/** 絞り込みの条件。船種・運航状態・運航会社の3軸（docs/spec.md「絞り込み」）。 */
export interface RouteFilter {
  vesselTypes: ReadonlySet<VesselType>;
  statuses: ReadonlySet<RouteStatus>;
  /** null ならすべての運航会社 */
  operator: string | null;
}

export const SHOW_ALL: RouteFilter = {
  vesselTypes: new Set(VESSEL_TYPES),
  statuses: new Set(ROUTE_STATUSES),
  operator: null,
};

type Filterable = Pick<RouteDetail, "vesselType" | "status" | "operator">;

export function matchesFilter(route: Filterable, filter: RouteFilter): boolean {
  return (
    filter.vesselTypes.has(route.vesselType) &&
    filter.statuses.has(route.status) &&
    (filter.operator === null || route.operator === filter.operator)
  );
}

/** routes.geojson の区間に対する、MapLibre のフィルタ式。 */
export function toFilterExpression(filter: RouteFilter): ExpressionSpecification {
  return [
    "all",
    ["in", ["get", "vesselType"], ["literal", [...filter.vesselTypes]]],
    ["in", ["get", "status"], ["literal", [...filter.statuses]]],
    filter.operator === null ? true : ["==", ["get", "operator"], filter.operator],
  ];
}

/** 運航会社の一覧（重複なし、五十音順）。 */
export function operatorsOf(routes: readonly RouteDetail[]): string[] {
  return [...new Set(routes.map((route) => route.operator))].sort((a, b) =>
    a.localeCompare(b, "ja"),
  );
}

/** 港 ID → その港に寄港する航路の一覧。 */
export function routesByPort(routes: readonly RouteDetail[]): Map<string, RouteDetail[]> {
  const byPort = new Map<string, RouteDetail[]>();
  for (const route of routes) {
    for (const port of new Set(route.portsOfCall.map((p) => p.id))) {
      byPort.set(port, [...(byPort.get(port) ?? []), route]);
    }
  }
  return byPort;
}
