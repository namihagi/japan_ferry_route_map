/**
 * OSM の route=ferry を全国分まとめて取得し、航路台帳にまだ入っていない航路の候補一覧を作る。
 * 人が手動で実行する（ADR 0003）。
 *
 *   pnpm data:survey-osm            # .cache のデータを使う（なければ取得する）
 *   pnpm data:survey-osm --refresh  # Overpass から取り直す
 *
 * 取得した生データは .cache/osm-survey/ に置く（リポジトリには入れない）。
 * 結果は docs/coverage.md に書き出す。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadExclusions } from "./lib/excluded.ts";
import type { OsmTerminal, OsmWay } from "./lib/osmSurvey.ts";
import { buildSurvey, renderMarkdown } from "./lib/osmSurvey.ts";
import { paths } from "./lib/paths.ts";
import { loadRegistry } from "./lib/registry.ts";

/** 混雑で失敗しやすいので、順に試す（add-route スキル「実測形状を探す」と同じ）。 */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const QUERIES = {
  ways: `[out:json][timeout:600];
area["ISO3166-1"="JP"][admin_level=2]->.jp;
way["route"="ferry"](area.jp);
out tags geom;`,
  terminals: `[out:json][timeout:600];
area["ISO3166-1"="JP"][admin_level=2]->.jp;
(
  node["amenity"="ferry_terminal"](area.jp);
  way["amenity"="ferry_terminal"](area.jp);
  relation["amenity"="ferry_terminal"](area.jp);
);
out tags center;`,
} as const;

interface OverpassResponse<T> {
  elements: T[];
  osm3s?: { timestamp_osm_base?: string };
}

async function fetchOverpass<T>(query: string): Promise<OverpassResponse<T>> {
  let lastError = "";
  for (const endpoint of ENDPOINTS) {
    const response = await fetch(endpoint, { method: "POST", body: query });
    if (response.ok) {
      const json = (await response.json()) as OverpassResponse<T>;
      if (Array.isArray(json.elements)) return json;
      lastError = `${endpoint}: elements がない`;
      continue;
    }
    lastError = `${endpoint}: HTTP ${response.status}`;
    console.warn(`Overpass が失敗した（${lastError}）。次のエンドポイントを試します。`);
  }
  throw new Error(`Overpass からデータを取得できなかった（最後の失敗：${lastError}）`);
}

async function load<T>(
  cacheDir: string,
  name: keyof typeof QUERIES,
  refresh: boolean,
): Promise<OverpassResponse<T>> {
  const file = join(cacheDir, `${name}.json`);
  if (!refresh) {
    try {
      return JSON.parse(await readFile(file, "utf8")) as OverpassResponse<T>;
    } catch {
      // キャッシュがない、または壊れている。取り直す。
    }
  }
  console.log(`Overpass から ${name} を取得します`);
  const json = await fetchOverpass<T>(QUERIES[name]);
  await writeFile(file, JSON.stringify(json));
  return json;
}

const refresh = process.argv.includes("--refresh");
const cacheDir = join(paths.cacheDir, "osm-survey");
await mkdir(cacheDir, { recursive: true });

const ways = await load<OsmWay>(cacheDir, "ways", refresh);
const terminals = await load<OsmTerminal>(cacheDir, "terminals", refresh);
const registry = await loadRegistry(paths.dataDir);
const exclusions = await loadExclusions(paths.dataDir);

const survey = buildSurvey(
  ways.elements,
  terminals.elements,
  registry,
  ways.osm3s?.timestamp_osm_base ?? "不明",
  exclusions,
);

await writeFile(join(cacheDir, "survey.json"), JSON.stringify(survey, null, 2));
await writeFile(paths.coverageDoc, renderMarkdown(survey));

const uncovered = survey.routes.filter(
  (r) => r.coverage !== "covered" && !r.international && !r.excluded,
).length;
console.log(
  `way ${survey.ways.length} 本 → 候補 ${survey.routes.length} 件。うち未収録は ${uncovered} 件。${paths.coverageDoc} に書き出しました`,
);
