import { describe, expect, it } from "vitest";
import { buildSurvey, type OsmTerminal, type OsmWay } from "./osmSurvey.ts";
import type { Port, Registry } from "./registry.ts";
import { buildDrafts, DraftPortBook, portIdFromRomaji, renderDraftYaml } from "./routeDraft.ts";

const matsuyama: Port = { id: "matsuyama", name: "松山", lon: 132.7047, lat: 33.8781 };

function registry(ports: Port[] = [matsuyama]): Registry {
  return { ports: new Map(ports.map((p) => [p.id, p])), routes: [] };
}

function terminal(name: string, lon: number, lat: number, romaji?: string): OsmTerminal {
  return {
    id: Math.round(lon * 1000),
    type: "node",
    tags: romaji ? { name, "name:ja-Latn": romaji } : { name },
    lon,
    lat,
  };
}

function way(id: number, tags: Record<string, string>, points: [number, number][]): OsmWay {
  return {
    id,
    tags: { route: "ferry", ...tags },
    geometry: points.map(([lon, lat]) => ({ lon, lat })),
  };
}

/** 候補1件を作る。survey を通すことで、実際の入力と同じ形にする。 */
function candidates(ways: OsmWay[], terminals: OsmTerminal[], reg: Registry) {
  return buildSurvey(ways, terminals, reg, "test").routes;
}

describe("buildDrafts", () => {
  it("つながった way を寄港地の並びにして、区間ごとに way を割り当てる", () => {
    const terminals = [
      terminal("釣島港", 132.64, 33.894, "Tsurushima"),
      terminal("二神港", 132.537, 33.933, "Futagami"),
    ];
    const ways = [
      way(1, { name: "西線", operator: "中島汽船" }, [
        [132.7047, 33.8781],
        [132.64, 33.894],
      ]),
      way(2, { name: "西線", operator: "中島汽船" }, [
        [132.64, 33.894],
        [132.537, 33.933],
      ]),
    ];
    const reg = registry();
    const [draft] = buildDrafts(
      candidates(ways, terminals, reg)[0] as never,
      new DraftPortBook(terminals, reg),
    );
    expect(draft?.ports.map((p) => p.name)).toEqual(["松山", "釣島港", "二神港"]);
    expect(draft?.legs).toEqual([
      { from: "matsuyama", to: "tsurushima", osmWays: [1] },
      { from: "tsurushima", to: "futagami", osmWays: [2] },
    ]);
  });

  it("枝分かれしてつなげない候補は way ごとの下書きに分け、注意を書く", () => {
    const hub = terminal("拠点港", 132.7, 33.87, "Hub");
    const terminals = [hub, terminal("島A", 132.6, 33.9, "Shima A"), terminal("島B", 132.8, 33.9)];
    const ways = [
      way(1, { name: "network", operator: "X" }, [
        [132.7, 33.87],
        [132.6, 33.9],
      ]),
      way(2, { name: "network", operator: "X" }, [
        [132.7, 33.87],
        [132.8, 33.9],
      ]),
      way(3, { name: "network", operator: "X" }, [
        [132.6, 33.9],
        [132.8, 33.9],
      ]),
    ];
    const reg = registry([]);
    const drafts = buildDrafts(
      candidates(ways, terminals, reg)[0] as never,
      new DraftPortBook(terminals, reg),
    );
    expect(drafts).toHaveLength(3);
    expect(drafts[0]?.warnings[0]).toContain("way ごとに分けた");
  });

  it("同じ港は下書きをまたいで1つにまとめ、ID を付けられない港には仮 ID を振る", () => {
    const terminals = [terminal("師崎港", 136.9725, 34.6977)];
    const ways = [
      way(1, { name: "A" }, [
        [136.9725, 34.6977],
        [137.01, 34.7],
      ]),
      way(2, { name: "B" }, [
        [136.9726, 34.6978],
        [137.02, 34.68],
      ]),
    ];
    const reg = registry([]);
    const book = new DraftPortBook(terminals, reg);
    const list = candidates(ways, terminals, reg);
    for (const candidate of list) buildDrafts(candidate, book);
    expect(book.newPorts.filter((p) => p.name === "師崎港")).toHaveLength(1);
    expect(book.newPorts.map((p) => p.id)).toEqual(["todo-1", "todo-2", "todo-3"]);
  });

  it("港台帳にすでにある港は、その ID と座標をそのまま使う", () => {
    const terminals = [terminal("二神港", 132.537, 33.933, "Futagami")];
    const ways = [
      way(1, { name: "A" }, [
        [132.7047, 33.8781],
        [132.537, 33.933],
      ]),
    ];
    const reg = registry();
    const book = new DraftPortBook(terminals, reg);
    const [draft] = buildDrafts(candidates(ways, terminals, reg)[0] as never, book);
    expect(draft?.ports[0]).toMatchObject({ id: "matsuyama", existing: true });
    expect(book.newPorts).toHaveLength(1);
  });

  it("車を積める線は ferry、積めない線は passenger と推定する", () => {
    const reg = registry([]);
    const ferry = candidates(
      [
        way(1, { name: "A", motor_vehicle: "yes" }, [
          [133, 34],
          [133.1, 34],
        ]),
      ],
      [],
      reg,
    );
    const boat = candidates(
      [
        way(2, { name: "B", motor_vehicle: "no" }, [
          [133, 34],
          [133.1, 34],
        ]),
      ],
      [],
      reg,
    );
    expect(buildDrafts(ferry[0] as never, new DraftPortBook([], reg))[0]?.vesselType).toBe("ferry");
    expect(buildDrafts(boat[0] as never, new DraftPortBook([], reg))[0]?.vesselType).toBe(
      "passenger",
    );
  });
});

describe("renderDraftYaml", () => {
  it("照合前だと分かる下書きを書く（verification は書かない）", () => {
    const terminals = [terminal("金谷港", 139.8174, 35.1694, "Kanaya")];
    const ways = [
      way(1, { name: "東京湾フェリー", motor_vehicle: "yes", website: "https://example.com/" }, [
        [132.7047, 33.8781],
        [139.8174, 35.1694],
      ]),
    ];
    const reg = registry();
    const [draft] = buildDrafts(
      candidates(ways, terminals, reg)[0] as never,
      new DraftPortBook(terminals, reg),
    );
    const yaml = renderDraftYaml(draft as never);
    expect(yaml).toContain("portsOfCall: [matsuyama, kanaya]");
    expect(yaml).toContain("officialUrl: https://example.com/");
    expect(yaml).not.toMatch(/^verification:/m);
  });
});

describe("portIdFromRomaji", () => {
  it("OSM のローマ字から港 ID を作る", () => {
    expect(portIdFromRomaji("Tsuwaji Port")).toBe("tsuwaji");
    expect(portIdFromRomaji("Kurihama Ferry Terminal")).toBe("kurihama");
    expect(portIdFromRomaji("Ōmishima")).toBe("omishima");
    expect(portIdFromRomaji(undefined)).toBe("TODO");
  });
});
