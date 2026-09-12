import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Feature, LineString, Position } from "geojson";

/**
 * tools/sea-router が書き出す推定形状の計算方法。tools/sea-router の METHOD と揃える。
 * 食い違ったら、古い推定形状が残っているので pnpm data:estimate で作り直す。
 */
export const EXPECTED_ESTIMATE_METHOD = "corridor-grid-v2";

/** tools/sea-router が data/estimated/<a>--<b>.geojson に書き出す推定形状（a < b の向き）。 */
export interface EstimatedLegProperties {
  from: string;
  to: string;
  fromCoord: Position;
  toCoord: Position;
  method: string;
  stage: "single" | "corridor" | "fallback";
  cellSizeM: number;
  snapFromM: number;
  snapToM: number;
  landCrossingM: number;
}

export type EstimatedLegFeature = Feature<LineString, EstimatedLegProperties>;

/** 推定形状は向きを持たない港の組ごとに1つ。ID の辞書順で小さい方を a にした "a--b" をキーにする。 */
export function portPairKey(x: string, y: string): string {
  return x < y ? `${x}--${y}` : `${y}--${x}`;
}

/** data/estimated/ を読み込み、港の組のキー → 推定形状 の対応を返す。ディレクトリがなければ空。 */
export async function readEstimatedLegs(dir: string): Promise<Map<string, EstimatedLegFeature>> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".geojson"));
  } catch {
    return new Map();
  }
  const legs = new Map<string, EstimatedLegFeature>();
  for (const file of files) {
    const feature = JSON.parse(await readFile(join(dir, file), "utf8")) as EstimatedLegFeature;
    legs.set(portPairKey(feature.properties.from, feature.properties.to), feature);
  }
  return legs;
}
