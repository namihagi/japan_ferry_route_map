import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");

export const paths = {
  dataDir: join(root, "data"),
  osmSnapshot: join(root, "data", "osm", "ways.geojson"),
  estimatedDir: join(root, "data", "estimated"),
  publicDataDir: join(root, "public", "data"),
  /** ダウンロードしたデータ・中間生成物。リポジトリには入れない。 */
  cacheDir: join(root, ".cache"),
  /** 網羅の進捗（pnpm data:survey-osm が生成する）。 */
  coverageDoc: join(root, "docs", "coverage.md"),
};
