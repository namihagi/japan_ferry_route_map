import type { Feature, FeatureCollection, LineString, Point, Position } from "geojson";
import type { LegFeatureProperties, PortFeatureProperties } from "../../src/domain/publicData.ts";
import { buildLegGeometry } from "./legGeometry.ts";
import type { OsmWayFeature } from "./osmSnapshot.ts";
import { findRegistryProblems, type Port, type Registry } from "./registry.ts";

export interface PublicData {
  routes: FeatureCollection<LineString, LegFeatureProperties>;
  ports: FeatureCollection<Point, PortFeatureProperties>;
  /** 照合前のため公開しなかった航路の ID。 */
  skippedRouteIds: string[];
}

const position = (port: Port): Position => [port.lon, port.lat];

/**
 * 照合済みの航路だけを、区間ごとのフィーチャーにして返す。
 * 台帳の食い違いや、形状を作れない区間があれば、まとめて例外にする。
 */
export function buildPublicData(
  registry: Registry,
  osmWays: Map<number, OsmWayFeature>,
): PublicData {
  const problems = findRegistryProblems(registry);
  const legFeatures: Feature<LineString, LegFeatureProperties>[] = [];
  const usedPortIds = new Set<string>();
  const skippedRouteIds: string[] = [];

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
      if (!leg.osmWays) {
        problems.push(`${where}: 実測形状（osmWays）がない`);
        return;
      }
      const ways: Position[][] = [];
      for (const id of leg.osmWays) {
        const way = osmWays.get(id);
        if (way) ways.push(way.geometry.coordinates);
        else
          problems.push(
            `${where}: OSM スナップショットに way ${id} がない（pnpm data:import-osm で取り込む）`,
          );
      }
      if (ways.length !== leg.osmWays.length) return;

      try {
        legFeatures.push({
          type: "Feature",
          properties: {
            routeId: route.id,
            legIndex,
            name: route.name,
            operator: route.operator,
            vesselType: route.vesselType,
            status: route.status,
            geometrySource: "osm",
          },
          geometry: {
            type: "LineString",
            coordinates: buildLegGeometry(ways, position(from), position(to)),
          },
        });
        usedPortIds.add(from.id);
        usedPortIds.add(to.id);
      } catch (error) {
        problems.push(`${where}: ${(error as Error).message}`);
      }
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
    skippedRouteIds,
  };
}
