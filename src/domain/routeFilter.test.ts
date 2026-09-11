import { describe, expect, it } from "vitest";
import { formatDuration } from "./labels.ts";
import type { RouteDetail } from "./publicData.ts";
import { matchesFilter, operatorsOf, routesByPort, SHOW_ALL } from "./routeFilter.ts";

function route(id: string, overrides: Partial<RouteDetail> = {}): RouteDetail {
  return {
    id,
    name: id,
    operator: "宮島松大汽船",
    vesselType: "ferry",
    status: "operating",
    seasonal: false,
    officialUrl: "https://example.com/",
    portsOfCall: [
      { id: "miyajimaguchi", name: "宮島口" },
      { id: "miyajima", name: "宮島" },
    ],
    hasEstimatedLegs: false,
    ...overrides,
  };
}

describe("matchesFilter", () => {
  it("初期状態ではすべての航路を表示する", () => {
    expect(matchesFilter(route("a", { status: "suspended" }), SHOW_ALL)).toBe(true);
  });

  it("船種・運航状態・運航会社のすべてに合う航路だけを表示する", () => {
    const filter = { ...SHOW_ALL, vesselTypes: new Set(["highspeed" as const]) };
    expect(matchesFilter(route("a"), filter)).toBe(false);
    expect(matchesFilter(route("b", { vesselType: "highspeed" }), filter)).toBe(true);
    expect(matchesFilter(route("c"), { ...SHOW_ALL, operator: "JR西日本宮島フェリー" })).toBe(
      false,
    );
  });
});

describe("operatorsOf", () => {
  it("運航会社を重複なしで返す", () => {
    const routes = [route("a"), route("b"), route("c", { operator: "オーシャントランス" })];
    expect(operatorsOf(routes)).toHaveLength(2);
  });
});

describe("routesByPort", () => {
  it("港ごとに、寄港する航路をまとめる", () => {
    const byPort = routesByPort([route("a"), route("b")]);
    expect(byPort.get("miyajima")?.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("formatDuration", () => {
  it("分を時間と分の表記にする", () => {
    expect(formatDuration(10)).toBe("約10分");
    expect(formatDuration(100)).toBe("約1時間40分");
    expect(formatDuration(120)).toBe("約2時間");
  });
});
