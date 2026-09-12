import distance from "@turf/distance";
import { lineString } from "@turf/helpers";
import lineSlice from "@turf/line-slice";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import type { Position } from "geojson";

/**
 * 港と線の距離の上限（km）。港は旅客が一つの名前で呼ぶ単位なので、同じ港でも会社ごとの
 * ターミナルが 1〜2 km 離れていることがある。その差を吸収できる値にしている。
 * - 線の端が港からこの距離以内なら、その端をその港の発着点とみなす。
 * - 線の端が港から遠い（way が港を通り過ぎて次の寄港地まで続いている）ときは、
 *   線上で港に最も近い点で切る。その点も港からこの距離以内でなければならない。
 */
export const MAX_PORT_DISTANCE_KM = 3;

/** way の継ぎ目がこれより離れていたら、つながっていない way を並べたとみなす（km）。 */
export const MAX_JOIN_GAP_KM = 0.2;

function squaredDistance(a: Position, b: Position): number {
  const dx = (a[0] ?? 0) - (b[0] ?? 0);
  const dy = (a[1] ?? 0) - (b[1] ?? 0);
  return dx * dx + dy * dy;
}

/**
 * 複数の way を1本の線につなぐ。各 way の向きは、前の線の終点に近い側から始まるように揃える。
 * 最初の way は、終点が2本目の way に近くなる向きにする（1本だけなら描かれた向きのまま）。
 */
export function stitchWays(ways: Position[][]): Position[] {
  const [first, ...rest] = ways;
  if (!first || first.length < 2) throw new Error("way の座標が足りない");

  const [second] = rest;
  const nearestToSecond = (p: Position) =>
    second
      ? Math.min(
          squaredDistance(p, second[0] as Position),
          squaredDistance(p, second[second.length - 1] as Position),
        )
      : 0;
  const line =
    nearestToSecond(first[first.length - 1] as Position) <= nearestToSecond(first[0] as Position)
      ? [...first]
      : [...first].reverse();

  for (const [index, way] of rest.entries()) {
    const tail = line[line.length - 1] as Position;
    const oriented =
      squaredDistance(tail, way[0] as Position) <=
      squaredDistance(tail, way[way.length - 1] as Position)
        ? way
        : [...way].reverse();
    const head = oriented[0] as Position;
    const gap = distance(tail, head);
    if (gap > MAX_JOIN_GAP_KM) {
      throw new Error(
        `${index + 1} 本目と ${index + 2} 本目の way が ${(gap * 1000).toFixed(0)} m 離れている（上限 ${MAX_JOIN_GAP_KM * 1000} m）。way の並び順か ID を見直す`,
      );
    }
    line.push(...(squaredDistance(tail, head) === 0 ? oriented.slice(1) : oriented));
  }
  return line;
}

/**
 * 出発港から到着港までの部分を取り出す。線の端が港の近くにあればその端をそのまま使い、
 * 線が港を通り過ぎているときだけ、港に最も近い点で切る。
 */
export function trimToPorts(line: Position[], fromPort: Position, toPort: Position): Position[] {
  const feature = lineString(line);
  const first = line[0] as Position;
  const last = line[line.length - 1] as Position;
  const from = nearestPointOnLine(feature, fromPort);
  const to = nearestPointOnLine(feature, toPort);

  for (const [label, snapped] of [
    ["出発港", from],
    ["到着港", to],
  ] as const) {
    if (snapped.properties.pointDistance > MAX_PORT_DISTANCE_KM) {
      throw new Error(
        `${label}から線まで ${snapped.properties.pointDistance.toFixed(1)} km 離れている（上限 ${MAX_PORT_DISTANCE_KM} km）`,
      );
    }
  }
  if (from.properties.totalDistance >= to.properties.totalDistance) {
    throw new Error("線上で出発港が到着港より後ろにある（way の並び順か向きが違う）");
  }

  const trimStart = distance(first, fromPort) > MAX_PORT_DISTANCE_KM;
  const trimEnd = distance(last, toPort) > MAX_PORT_DISTANCE_KM;
  if (!trimStart && !trimEnd) return line;

  const start = trimStart ? from.geometry.coordinates : first;
  const stop = trimEnd ? to.geometry.coordinates : last;
  return lineSlice(start, stop, feature).geometry.coordinates;
}

/**
 * 区間の実測形状を作る。ways は区間に割り当てた way の座標列（つながる順）。
 * 線上で出発港が到着港より後ろにあれば、線全体を逆向きにしてから切り取る
 * （1本の長い way を途中の寄港地で区切るとき、way の向きと区間の向きが逆のことがあるため）。
 */
export function buildLegGeometry(
  ways: Position[][],
  fromPort: Position,
  toPort: Position,
): Position[] {
  const line = stitchWays(ways);
  const feature = lineString(line);
  const along = (port: Position) => nearestPointOnLine(feature, port).properties.totalDistance;
  return trimToPorts(
    along(fromPort) > along(toPort) ? [...line].reverse() : line,
    fromPort,
    toPort,
  );
}
