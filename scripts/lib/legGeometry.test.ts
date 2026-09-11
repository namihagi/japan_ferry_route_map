import type { Position } from "geojson";
import { describe, expect, it } from "vitest";
import { buildLegGeometry, stitchWays, trimToPorts } from "./legGeometry.ts";

// 瀬戸内海あたりで東西にのびる線（経度 0.01 度 ≒ 0.9 km）
const A: Position = [133.0, 34.0];
const B: Position = [133.1, 34.0];
const C: Position = [133.2, 34.0];

describe("stitchWays", () => {
  it("逆向きの way を反転し、つなぎ目の重複点を除いてつなぐ", () => {
    const line = stitchWays(
      [
        [B, A],
        [C, B],
      ],
      A,
    );
    expect(line).toEqual([A, B, C]);
  });
});

describe("trimToPorts", () => {
  it("線の端が港の近くにあれば、そのまま返す", () => {
    expect(trimToPorts([A, B, C], [133.0, 34.001], [133.2, 34.001])).toEqual([A, B, C]);
  });

  it("港が線の端から少し（上限以内）ずれていても、端を削らない", () => {
    // 到着港が線の端より 1.8 km ほど手前・横にある（大きな港で別会社のターミナルを代表点にした場合）
    expect(trimToPorts([A, B, C], A, [133.19, 34.014])).toEqual([A, B, C]);
  });

  it("線が寄港地を通り過ぎていれば、寄港地で切る", () => {
    const line = trimToPorts([A, B, C], A, [133.1, 34.002]);
    expect(line[0]).toEqual(A);
    const end = line[line.length - 1] as Position;
    expect(end[0]).toBeCloseTo(133.1, 3);
  });

  it("港が線から離れすぎていたら例外にする", () => {
    expect(() => trimToPorts([A, B, C], A, [133.2, 34.1])).toThrow("到着港");
  });
});

describe("buildLegGeometry", () => {
  it("1本の way を、途中の寄港地で2つの区間に分けられる", () => {
    const way = [A, B, C];
    const first = buildLegGeometry([way], A, B);
    const second = buildLegGeometry([way], B, C);
    expect(first[first.length - 1]?.[0]).toBeCloseTo(133.1, 3);
    expect(second[0]?.[0]).toBeCloseTo(133.1, 3);
    expect(second[second.length - 1]).toEqual(C);
  });

  it("到着港側から描かれた way も、出発港から始まる向きにそろえる", () => {
    expect(buildLegGeometry([[C, B, A]], A, C)).toEqual([A, B, C]);
  });
});
