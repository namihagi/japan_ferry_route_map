/**
 * 航路台帳が参照している OSM の way を OSM API から取り込み、data/osm/ways.geojson に保存する。
 * 人が手動で実行し、差分をレビューしてからコミットする（ADR 0003）。
 *
 *   pnpm data:import-osm
 *
 * OSM API（https://api.openstreetmap.org）に way ごとに1回ずつ、順番に問い合わせる。
 */
import type { Position } from "geojson";
import { type OsmWayFeature, readOsmSnapshot, writeOsmSnapshot } from "./lib/osmSnapshot.ts";
import { paths } from "./lib/paths.ts";
import { loadRegistry, referencedOsmWayIds } from "./lib/registry.ts";

const OSM_API = "https://api.openstreetmap.org/api/0.6";
const USER_AGENT = "japan_ferry_route_map (https://github.com/namihagi/japan_ferry_route_map)";

interface OsmElement {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

/** way と、その node の座標を取得する。削除済み・存在しない way は null。 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 混雑や一時的な障害（429・5xx）は少し待って繰り返す。500 航路規模では途中で必ず出るため。 */
async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  let response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  for (let attempt = 1; attempt < attempts; attempt++) {
    if (response.status !== 429 && response.status < 500) return response;
    const waitMs = 2000 * 2 ** (attempt - 1);
    console.warn(`HTTP ${response.status}: ${waitMs / 1000} 秒待って再試行します（${url}）`);
    await sleep(waitMs);
    response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  }
  return response;
}

async function fetchWay(id: number): Promise<{ coordinates: Position[]; name?: string } | null> {
  const response = await fetchWithRetry(`${OSM_API}/way/${id}/full.json`);
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok)
    throw new Error(`OSM API から way ${id} を取得できなかった（HTTP ${response.status}）`);
  const { elements } = (await response.json()) as { elements: OsmElement[] };
  const nodes = new Map(
    elements.filter((e) => e.type === "node").map((e) => [e.id, [e.lon, e.lat]]),
  );
  const way = elements.find((e) => e.type === "way" && e.id === id);
  if (!way?.nodes) return null;
  const coordinates = way.nodes.map((nodeId) => {
    const position = nodes.get(nodeId);
    if (!position) throw new Error(`way ${id} の node ${nodeId} の座標がない`);
    return position as Position;
  });
  const name = way.tags?.name;
  return name ? { coordinates, name } : { coordinates };
}

const registry = await loadRegistry(paths.dataDir);
const ids = referencedOsmWayIds(registry.routes);
const previous = await readOsmSnapshot(paths.osmSnapshot);

console.log(`${ids.length} 本の way を OSM API から取得します`);
const next = new Map<number, OsmWayFeature>();
const missing: number[] = [];
for (const id of ids) {
  const way = await fetchWay(id);
  if (!way) {
    missing.push(id);
    const kept = previous.get(id);
    if (kept) next.set(id, kept);
    continue;
  }
  next.set(id, {
    type: "Feature",
    properties: way.name ? { osmId: id, name: way.name } : { osmId: id },
    geometry: { type: "LineString", coordinates: way.coordinates },
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
