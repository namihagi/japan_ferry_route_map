import { describe, expect, it } from "vitest";
import { buildPublicData } from "./buildPublicData.ts";
import { type EstimatedLegFeature, EXPECTED_ESTIMATE_METHOD } from "./estimatedGeometry.ts";
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
    expect(data.routeDetails).toEqual([
      expect.objectContaining({
        id: "verified",
        portsOfCall: [
          { id: "a", name: "A港" },
          { id: "b", name: "B港" },
        ],
        hasEstimatedLegs: false,
      }),
    ]);
    expect(data.ports.features.map((f) => f.properties.name)).toEqual(["A港", "B港"]);
  });

  it("スナップショットにない way を参照していたら例外にする", () => {
    expect(() => buildPublicData(registry([route("verified", true)]), new Map())).toThrow(
      "way 1 がない",
    );
  });
});

describe("buildPublicData（推定形状）", () => {
  // 推定形状は港の組ごとに a < b の向きで保存されている
  const estimated: EstimatedLegFeature = {
    type: "Feature",
    properties: {
      from: "a",
      to: "b",
      fromCoord: [133.0, 34.0],
      toCoord: [133.1, 34.0],
      method: EXPECTED_ESTIMATE_METHOD,
      stage: "single",
      cellSizeM: 20,
      snapFromM: 0,
      snapToM: 0,
      landCrossingM: 0,
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [133.0, 34.0],
        [133.05, 34.01],
        [133.1, 34.0],
      ],
    },
  };

  function estimatedRoute(from: string, to: string): Route {
    return {
      ...route("estimated", true),
      portsOfCall: [from, to],
      legs: [{ from, to }],
    };
  }

  it("osmWays がない区間は推定形状を使い、出発港から始まる向きにそろえる", () => {
    const data = buildPublicData(
      registry([estimatedRoute("b", "a")]),
      new Map(),
      new Map([["a--b", estimated]]),
    );
    const leg = data.routes.features[0];
    expect(leg?.properties.geometrySource).toBe("estimated");
    expect(leg?.geometry.coordinates[0]).toEqual([133.1, 34.0]);
  });

  it("推定形状を計算したあとで港の座標が変わっていたら例外にする", () => {
    const moved = registry([estimatedRoute("a", "b")]);
    moved.ports.set("a", { id: "a", name: "A港", lon: 133.001, lat: 34.0 });
    expect(() => buildPublicData(moved, new Map(), new Map([["a--b", estimated]]))).toThrow(
      "港の座標が変わった",
    );
  });

  it("推定形状の計算方法が古ければ例外にする", () => {
    const stale: EstimatedLegFeature = {
      ...estimated,
      properties: { ...estimated.properties, method: "corridor-grid-v1" },
    };
    expect(() =>
      buildPublicData(registry([estimatedRoute("a", "b")]), new Map(), new Map([["a--b", stale]])),
    ).toThrow("計算方法が古い");
  });

  it("推定形状もなければ例外にする", () => {
    expect(() => buildPublicData(registry([estimatedRoute("a", "b")]), new Map())).toThrow(
      "推定形状もない",
    );
  });
});
