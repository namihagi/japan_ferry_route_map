import { describe, expect, it } from "vitest";
import {
  findRegistryProblems,
  type Port,
  type Registry,
  type Route,
  referencedOsmWayIds,
} from "./registry.ts";

const port = (id: string): Port => ({ id, name: id, lon: 133, lat: 34 });

function registryWith(route: Partial<Route>): Registry {
  return {
    ports: new Map(["a", "b", "c"].map((id) => [id, port(id)])),
    routes: [
      {
        id: "sample",
        name: "サンプル航路",
        operator: "サンプル汽船",
        vesselType: "ferry",
        status: "operating",
        seasonal: false,
        officialUrl: "https://example.com/",
        portsOfCall: ["a", "b", "c"],
        legs: [
          { from: "a", to: "b", osmWays: [1] },
          { from: "b", to: "c", osmWays: [2, 1] },
        ],
        ...route,
      },
    ],
  };
}

describe("findRegistryProblems", () => {
  it("食い違いがなければ空を返す", () => {
    expect(findRegistryProblems(registryWith({}))).toEqual([]);
  });

  it("港台帳にない寄港地を指摘する", () => {
    const problems = findRegistryProblems(
      registryWith({ portsOfCall: ["a", "x"], legs: [{ from: "a", to: "x" }] }),
    );
    expect(problems).toEqual(["routes/sample.yaml: 港台帳にない港 x"]);
  });

  it("区間の数と向きが寄港地と合っていなければ指摘する", () => {
    const problems = findRegistryProblems(registryWith({ legs: [{ from: "b", to: "a" }] }));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("2 個必要");
    expect(problems[1]).toContain("a → b のはず");
  });
});

describe("referencedOsmWayIds", () => {
  it("全航路の way ID を重複なしの昇順で返す", () => {
    expect(referencedOsmWayIds(registryWith({}).routes)).toEqual([1, 2]);
  });
});
