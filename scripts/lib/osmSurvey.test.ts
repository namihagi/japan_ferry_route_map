import { describe, expect, it } from "vitest";
import { buildSurvey, classifyRegion, normalizeOperator, type OsmWay } from "./osmSurvey.ts";
import type { Port, Registry, Route } from "./registry.ts";

const takamatsu: Port = { id: "takamatsu", name: "高松", lon: 134.0543, lat: 34.3527 };
const tonosho: Port = { id: "tonosho", name: "土庄", lon: 134.1832, lat: 34.4862 };

function registry(routes: Route[] = []): Registry {
  return { ports: new Map([takamatsu, tonosho].map((p) => [p.id, p])), routes };
}

function route(overrides: Partial<Route>): Route {
  return {
    id: "sample",
    name: "サンプル航路",
    operator: "サンプル汽船",
    vesselType: "ferry",
    status: "operating",
    seasonal: false,
    officialUrl: "https://example.com/",
    portsOfCall: ["takamatsu", "tonosho"],
    legs: [{ from: "takamatsu", to: "tonosho" }],
    ...overrides,
  };
}

function way(id: number, tags: Record<string, string>, from: Port, to: Port): OsmWay {
  return {
    id,
    tags: { route: "ferry", ...tags },
    geometry: [
      { lon: from.lon, lat: from.lat },
      { lon: to.lon, lat: to.lat },
    ],
  };
}

describe("buildSurvey", () => {
  it("台帳が参照している way は収録済みになる", () => {
    const ways = [way(1, { name: "土庄～高松", operator: "四国フェリー" }, takamatsu, tonosho)];
    const routes = [route({ legs: [{ from: "takamatsu", to: "tonosho", osmWays: [1] }] })];
    const survey = buildSurvey(ways, [], registry(routes), "test");
    expect(survey.routes).toHaveLength(1);
    expect(survey.routes[0]?.coverage).toBe("covered");
  });

  it("way は参照していなくても、同じ港を結ぶ区間が台帳にあれば収録済みとみなす", () => {
    const ways = [way(2, { name: "土庄～高松", operator: "四国フェリー" }, takamatsu, tonosho)];
    const survey = buildSurvey(ways, [], registry([route({})]), "test");
    expect(survey.routes[0]?.coverage).toBe("covered");
    expect(survey.ways[0]?.coverage).toBe("leg");
  });

  it("台帳にない way は未収録になり、端は港台帳の港名で表される", () => {
    const ways = [way(3, { name: "土庄～高松", operator: "四国フェリー" }, takamatsu, tonosho)];
    const survey = buildSurvey(ways, [], registry(), "test");
    expect(survey.routes[0]?.coverage).toBe("none");
    expect(survey.routes[0]?.ports).toEqual(["高松", "土庄"]);
  });

  it("運航会社と名称が同じ way は1つの候補にまとまる", () => {
    const middle: Port = { id: "mid", name: "中間", lon: 134.12, lat: 34.42 };
    const ways = [
      way(4, { name: "中島汽船西線", operator: "中島汽船" }, takamatsu, middle),
      way(5, { name: "中島汽船西線", operator: "中島汽船" }, middle, tonosho),
    ];
    const survey = buildSurvey(ways, [], registry(), "test");
    expect(survey.routes).toHaveLength(1);
    expect(survey.routes[0]?.ways).toHaveLength(2);
  });

  it("名称のない way は1本ずつ別の候補になる", () => {
    const ways = [
      way(6, { operator: "渡船" }, takamatsu, tonosho),
      way(7, { operator: "渡船" }, tonosho, takamatsu),
    ];
    const survey = buildSurvey(ways, [], registry(), "test");
    expect(survey.routes).toHaveLength(2);
  });

  it("日本の外に端がある way は国際航路として分ける", () => {
    const shanghai: Port = { id: "shanghai", name: "上海", lon: 121.49, lat: 31.25 };
    const osaka: Port = { id: "osaka", name: "大阪", lon: 135.42, lat: 34.64 };
    const survey = buildSurvey(
      [way(8, { name: "大阪 - 上海" }, osaka, shanghai)],
      [],
      registry(),
      "t",
    );
    expect(survey.routes[0]?.international).toBe(true);
    expect(survey.regions).toHaveLength(0);
  });

  it("港台帳にない端は、近くの OSM のフェリーターミナル名で表される", () => {
    const far: Port = { id: "far", name: "遠い港", lon: 133.0, lat: 34.0 };
    const terminals = [
      { id: 10, type: "node", tags: { name: "笠岡住吉港" }, lon: 133.0005, lat: 34.0005 },
    ];
    const survey = buildSurvey([way(9, {}, takamatsu, far)], terminals, registry(), "test");
    expect(survey.routes[0]?.ports).toEqual(["高松", "笠岡住吉港"]);
  });
});

describe("classifyRegion", () => {
  it("緯度経度からおおまかな地域を返す", () => {
    expect(classifyRegion({ lon: 141.0, lat: 43.0 })).toBe("北海道");
    expect(classifyRegion({ lon: 127.7, lat: 26.2 })).toBe("沖縄");
    expect(classifyRegion({ lon: 132.5, lat: 34.2 })).toBe("瀬戸内・四国");
    expect(classifyRegion({ lon: 139.8, lat: 35.6 })).toBe("関東");
  });
});

describe("normalizeOperator", () => {
  it("法人格と記号を落として比べられるようにする", () => {
    expect(normalizeOperator("中島汽船株式会社")).toBe("中島汽船");
    expect(normalizeOperator("瀬戸内海汽船・石崎汽船")).toBe("瀬戸内海汽船石崎汽船");
  });
});
