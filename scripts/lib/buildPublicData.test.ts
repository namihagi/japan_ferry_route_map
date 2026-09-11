import { describe, expect, it } from "vitest";
import { buildPublicData } from "./buildPublicData.ts";
import type { OsmWayFeature } from "./osmSnapshot.ts";
import type { Registry, Route } from "./registry.ts";

const way: OsmWayFeature = {
  type: "Feature",
  properties: { osmId: 1 },
  geometry: {
    type: "LineString",
    coordinates: [
      [133.0, 34.0],
      [133.1, 34.0],
    ],
  },
};

function route(id: string, verified: boolean): Route {
  return {
    id,
    name: id,
    operator: "サンプル汽船",
    vesselType: "ferry",
    status: "operating",
    seasonal: false,
    officialUrl: "https://example.com/",
    portsOfCall: ["a", "b"],
    legs: [{ from: "a", to: "b", osmWays: [1] }],
    ...(verified
      ? { verification: { checkedOn: "2026-09-11", sources: ["https://example.com/"] } }
      : {}),
  };
}

const registry = (routes: Route[]): Registry => ({
  ports: new Map([
    ["a", { id: "a", name: "A港", lon: 133.0, lat: 34.0 }],
    ["b", { id: "b", name: "B港", lon: 133.1, lat: 34.0 }],
  ]),
  routes,
});

describe("buildPublicData", () => {
  it("照合済みの航路だけを公開し、照合前の航路は外す", () => {
    const data = buildPublicData(
      registry([route("verified", true), route("draft", false)]),
      new Map([[1, way]]),
    );
    expect(data.routes.features.map((f) => f.properties.routeId)).toEqual(["verified"]);
    expect(data.skippedRouteIds).toEqual(["draft"]);
    expect(data.ports.features.map((f) => f.properties.name)).toEqual(["A港", "B港"]);
  });

  it("スナップショットにない way を参照していたら例外にする", () => {
    expect(() => buildPublicData(registry([route("verified", true)]), new Map())).toThrow(
      "way 1 がない",
    );
  });
});
