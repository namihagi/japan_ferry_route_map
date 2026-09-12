import type { Feature, FeatureCollection, LineString, Point, Position } from "geojson";
import type {
  GeometrySource,
  LegFeatureProperties,
  PortFeatureProperties,
  RouteDetail,
} from "../../src/domain/publicData.ts";
import {
  type EstimatedLegFeature,
  EXPECTED_ESTIMATE_METHOD,
  portPairKey,
} from "./estimatedGeometry.ts";
import { buildLegGeometry } from "./legGeometry.ts";
import type { OsmWayFeature } from "./osmSnapshot.ts";
import { findRegistryProblems, type Port, type Registry } from "./registry.ts";

export interface PublicData {
  routes: FeatureCollection<LineString, LegFeatureProperties>;
  ports: FeatureCollection<Point, PortFeatureProperties>;
  routeDetails: RouteDetail[];
  /** 照合前のため公開しなかった航路の ID。 */
  skippedRouteIds: string[];
}

const position = (port: Port): Position => [port.lon, port.lat];

/** 公開データの座標は小数7桁（約1cm）に丸める。切り出しで生まれる長い小数を持ち回らないため。 */
const round7 = (coordinates: Position[]): Position[] =>
  coordinates.map(([lon = 0, lat = 0]) => [
    Math.round(lon * 1e7) / 1e7,
    Math.round(lat * 1e7) / 1e7,
  ]);

const samePosition = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/**
 * 区間の推定形状を、出発港から始まる向きで返す。
 * 推定形状を計算したときの港の座標が今の港台帳と違えば、古いとみなして例外にする。
 */
function estimatedLegGeometry(
  estimated: EstimatedLegFeature | undefined,
  from: Port,
  to: Port,
): Position[] {
  const hint = "pnpm data:estimate を実行する";
  if (!estimated) throw new Error(`実測形状（osmWays）も推定形状もない（${hint}）`);
  const { properties, geometry } = estimated;
  if (properties.method !== EXPECTED_ESTIMATE_METHOD) {
    throw new Error(
      `推定形状の計算方法が古い（${properties.method} → ${EXPECTED_ESTIMATE_METHOD}。${hint}）`,
    );
  }
  const forward = properties.from === from.id;
  const [expectedFrom, expectedTo] = forward ? [from, to] : [to, from];
  if (
    !samePosition(properties.fromCoord, position(expectedFrom)) ||
    !samePosition(properties.toCoord, position(expectedTo))
  ) {
    throw new Error(`推定形状を計算したあとで港の座標が変わった（${hint}）`);
  }
  return forward ? geometry.coordinates : [...geometry.coordinates].reverse();
}

/**
 * 照合済みの航路だけを、区間ごとのフィーチャーにして返す。
 * 台帳の食い違いや、形状を作れない区間があれば、まとめて例外にする。
 */
export function buildPublicData(
  registry: Registry,
  osmWays: Map<number, OsmWayFeature>,
  estimatedLegs: Map<string, EstimatedLegFeature> = new Map(),
): PublicData {
  const problems = findRegistryProblems(registry);
  const legFeatures: Feature<LineString, LegFeatureProperties>[] = [];
  const usedPortIds = new Set<string>();
  const skippedRouteIds: string[] = [];
  const routeDetails: RouteDetail[] = [];

  for (const route of registry.routes) {
    if (!route.verification) {
      skippedRouteIds.push(route.id);
      continue;
    }
    route.legs.forEach((leg, legIndex) => {
      const where = `routes/${route.id}.yaml 区間 ${legIndex + 1}（${leg.from} → ${leg.to}）`;
      const from = registry.ports.get(leg.from);
      const to = registry.ports.get(leg.to);
      if (!from || !to) return; // findRegistryProblems が指摘済み
      let geometrySource: GeometrySource;
      let coordinates: Position[];
      try {
        if (leg.osmWays) {
          const missing = leg.osmWays.filter((id) => !osmWays.has(id));
          if (missing.length > 0) {
            throw new Error(
              `OSM スナップショットに way ${missing.join(", ")} がない（pnpm data:import-osm で取り込む）`,
            );
          }
          const ways = leg.osmWays.map(
            (id) => (osmWays.get(id) as OsmWayFeature).geometry.coordinates,
          );
          geometrySource = "osm";
          coordinates = buildLegGeometry(ways, position(from), position(to));
        } else {
          geometrySource = "estimated";
          coordinates = estimatedLegGeometry(
            estimatedLegs.get(portPairKey(from.id, to.id)),
            from,
            to,
          );
        }
      } catch (error) {
        problems.push(`${where}: ${(error as Error).message}`);
        return;
      }

      legFeatures.push({
        type: "Feature",
        properties: {
          routeId: route.id,
          legIndex,
          name: route.name,
          operator: route.operator,
          vesselType: route.vesselType,
          status: route.status,
          geometrySource,
        },
        geometry: { type: "LineString", coordinates: round7(coordinates) },
      });
      usedPortIds.add(from.id);
      usedPortIds.add(to.id);
    });

    routeDetails.push({
      id: route.id,
      name: route.name,
      operator: route.operator,
      vesselType: route.vesselType,
      status: route.status,
      seasonal: route.seasonal,
      officialUrl: route.officialUrl,
      ...(route.durationMinutes ? { durationMinutes: route.durationMinutes } : {}),
      portsOfCall: route.portsOfCall.map((id) => ({
        id,
        name: registry.ports.get(id)?.name ?? id,
      })),
      hasEstimatedLegs: route.legs.some((leg) => !leg.osmWays),
    });
  }

  if (problems.length > 0) throw new Error(problems.join("\n"));

  const portFeatures = [...usedPortIds].sort().map((id): Feature<Point, PortFeatureProperties> => {
    const port = registry.ports.get(id) as Port;
    return {
      type: "Feature",
      properties: { portId: port.id, name: port.name },
      geometry: { type: "Point", coordinates: position(port) },
    };
  });

  return {
    routes: { type: "FeatureCollection", features: legFeatures },
    ports: { type: "FeatureCollection", features: portFeatures },
    routeDetails,
    skippedRouteIds,
  };
}
