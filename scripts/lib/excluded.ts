/**
 * OSM の `route=ferry` のうち、対象航路でないと判断したものの記録（data/excluded.yaml）。
 *
 * 候補一覧（docs/coverage.md）の分母から外すために使う。記録しておかないと、
 * セッションが変わるたびに同じ線を調べ直すことになる。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const EXCLUSION_REASONS = {
  /** 遊覧・周遊型。同じ港に戻る観光船、湖の遊覧船、テーマパークの乗り物を含む。 */
  sightseeing: "遊覧・周遊",
  /** 運航会社が航路をやめており、公式サイトにも載っていない。 */
  discontinued: "廃止済み",
  /** 一般の旅客が乗れない貨物航路。 */
  cargo: "貨物",
  /** 上のどれでもない。note に理由を書く。 */
  other: "その他",
} as const;

export type ExclusionReason = keyof typeof EXCLUSION_REASONS;

export const exclusionSchema = z.strictObject({
  /** 対象外と判断した OSM の way。 */
  osmWays: z.array(z.number().int().positive()).min(1),
  reason: z.enum(Object.keys(EXCLUSION_REASONS) as [ExclusionReason, ...ExclusionReason[]]),
  /** そう判断した根拠。あとで見直せるように、何を見て決めたかを書く。 */
  note: z.string().min(1),
});

export type Exclusion = z.infer<typeof exclusionSchema>;

/** way ID → 対象外の記録。 */
export type Exclusions = Map<number, Exclusion>;

export async function loadExclusions(dataDir: string): Promise<Exclusions> {
  const file = join(dataDir, "excluded.yaml");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return new Map(); // まだ1件も記録していない
  }
  const result = z.array(exclusionSchema).safeParse(parse(text) ?? []);
  if (!result.success) {
    throw new Error(
      result.error.issues.map((i) => `excluded.yaml: ${i.path.join(".")}: ${i.message}`).join("\n"),
    );
  }
  const byWay: Exclusions = new Map();
  for (const exclusion of result.data) {
    for (const wayId of exclusion.osmWays) {
      if (byWay.has(wayId)) throw new Error(`excluded.yaml: way ${wayId} が重複している`);
      byWay.set(wayId, exclusion);
    }
  }
  return byWay;
}
