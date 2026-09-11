/**
 * 航路台帳が参照している OSM の way を Overpass API から取り込み、data/osm/ways.geojson に保存する。
 * 人が手動で実行し、差分をレビューしてからコミットする（ADR 0003）。
 *
 *   pnpm data:import-osm
 *
 * Overpass のエンドポイントは環境変数 OVERPASS_URL で変えられる。
 */
import type { Position } from "geojson";
import { type OsmWayFeature, readOsmSnapshot, writeOsmSnapshot } from "./lib/osmSnapshot.ts";
import { paths } from "./lib/paths.ts";
import { loadRegistry, referencedOsmWayIds } from "./lib/registry.ts";

const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const USER_AGENT = "japan_ferry_route_map (https://github.com/namihagi/japan_ferry_route_map)";

interface OverpassWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

async function fetchWays(ids: number[]): Promise<OverpassWay[]> {
  const query = `[out:json][timeout:120];way(id:${ids.join(",")});out tags geom;`;
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
  });
  const text = await response.text();
  if (!response.ok || !text.startsWith("{")) {
    throw new Error(
      `Overpass API から取得できなかった（HTTP ${response.status}）:\n${text.slice(0, 500)}`,
    );
  }
  return (JSON.parse(text) as { elements: OverpassWay[] }).elements.filter((e) => e.type === "way");
}

const registry = await loadRegistry(paths.dataDir);
const ids = referencedOsmWayIds(registry.routes);
const previous = await readOsmSnapshot(paths.osmSnapshot);

console.log(`${ids.length} 本の way を ${OVERPASS_URL} から取得します`);
const fetched = new Map((await fetchWays(ids)).map((way) => [way.id, way]));

const next = new Map<number, OsmWayFeature>();
const missing: number[] = [];
for (const id of ids) {
  const way = fetched.get(id);
  if (!way?.geometry) {
    missing.push(id);
    const kept = previous.get(id);
    if (kept) next.set(id, kept);
    continue;
  }
  const coordinates: Position[] = way.geometry.map(({ lon, lat }) => [lon, lat]);
  const name = way.tags?.name;
  next.set(id, {
    type: "Feature",
    properties: name ? { osmId: id, name } : { osmId: id },
    geometry: { type: "LineString", coordinates },
  });
}

await writeOsmSnapshot(paths.osmSnapshot, next);
console.log(`${next.size} 本を ${paths.osmSnapshot} に保存しました`);

if (missing.length > 0) {
  console.warn(
    `警告: OSM で見つからなかった way があります（削除・分割された可能性）: ${missing.join(", ")}\n` +
      "前回のスナップショットに残っていたものはそのまま残しました。航路台帳の osmWays を見直してください。",
  );
  process.exitCode = 1;
}
