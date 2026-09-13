/**
 * OSM の route=ferry の way を分母として、航路台帳にまだ入っていない航路の候補を洗い出す。
 *
 * 台帳が「どの航路が存在するか」を決める（ADR 0001）ので、この結果は候補にすぎない。
 * 公式サイトで照合して初めて台帳に入る（add-route スキル）。
 */
import type { Port, Registry, Route } from "./registry.ts";

export interface OsmPoint {
  lon: number;
  lat: number;
}

/** Overpass の `out tags geom;` が返す way。 */
export interface OsmWay {
  id: number;
  tags?: Record<string, string>;
  geometry: OsmPoint[];
}

/** Overpass の `out tags center;` が返すフェリーターミナル（node は lon/lat、way/relation は center）。 */
export interface OsmTerminal {
  id: number;
  type: string;
  tags?: Record<string, string>;
  lon?: number;
  lat?: number;
  center?: OsmPoint;
}

/** way の端が、どの港に着いているか。 */
export interface EndpointLabel {
  /** 港台帳の港に届いているときだけ入る。 */
  portId?: string;
  /** 港台帳の港名、OSM のターミナル名、どちらもなければ座標。 */
  name: string;
  lon: number;
  lat: number;
}

export type Coverage =
  /** 台帳のどれかの区間が、この way を実測形状として参照している。 */
  | "way"
  /** way は参照されていないが、両端の港を結ぶ区間が台帳にある（推定形状で描いている区間など）。 */
  | "leg"
  /** 台帳にない。 */
  | "none";

export interface Candidate {
  wayId: number;
  name?: string;
  operator?: string;
  website?: string;
  /** 車を積めるか（OSM の motor_vehicle / motorcar タグ）。船種の当たりを付けるのに使う。 */
  motorVehicle?: string;
  duration?: string;
  from: EndpointLabel;
  to: EndpointLabel;
  lengthKm: number;
  region: string;
  coverage: Coverage;
  /** 日本国内で完結していない可能性がある（端が日本の外にある）。 */
  international: boolean;
}

/**
 * 候補の航路。OSM では1つの航路が複数の way に分かれていることが多いので、
 * 運航会社と名称が同じ way をひとまとめにする。名称のない way は1本で1候補とする。
 */
export interface CandidateRoute {
  operator?: string;
  name?: string;
  website?: string;
  ways: Candidate[];
  /** way の端に現れた港を、出てきた順に重複なく並べたもの。寄港地の下書きになる。 */
  ports: string[];
  lengthKm: number;
  region: string;
  coverage: "covered" | "partial" | "none";
  international: boolean;
}

export interface OperatorGroup {
  /** OSM の operator タグ。タグがない way は空文字列にまとめる。 */
  operator: string;
  routes: CandidateRoute[];
  uncovered: number;
  /** 台帳にこの運航会社の航路がいくつあるか（運航会社名が一致するもの）。 */
  registeredRoutes: number;
}

export interface Survey {
  /** Overpass が返したデータの時点（osm3s.timestamp_osm_base）。 */
  osmTimestamp: string;
  ways: Candidate[];
  routes: CandidateRoute[];
  groups: OperatorGroup[];
  regions: { region: string; uncovered: number; covered: number }[];
}

/** 端点を港とみなす距離の上限（m）。legGeometry の MAX_PORT_DISTANCE_KM に合わせる。 */
const PORT_MATCH_M = 3000;
/** 港台帳に港がないときに、OSM のターミナル名を借りる距離の上限（m）。 */
const TERMINAL_MATCH_M = 2000;

export function distanceM(a: OsmPoint, b: OsmPoint): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lengthKm(geometry: OsmPoint[]): number {
  let total = 0;
  for (let i = 1; i < geometry.length; i++) {
    const a = geometry[i - 1];
    const b = geometry[i];
    if (a && b) total += distanceM(a, b);
  }
  return total / 1000;
}

/**
 * 読むときの手がかりにする、おおまかな地域区分。都道府県境ではなく緯度経度の目安で分ける。
 * 優先度を付けるときに「どのあたりが手つかずか」を見るためだけに使う。
 */
export function classifyRegion(point: OsmPoint): string {
  const { lon, lat } = point;
  if (lat >= 41.4) return "北海道";
  if (lat >= 37.6) return "東北";
  if (lon >= 141.5 && lat < 30) return "小笠原";
  if (lon >= 138.9 && lat < 35.1 && lat >= 32.5) return "伊豆諸島";
  if (lon >= 138.9) return "関東";
  if (lon >= 136.4) return "中部・東海";
  if (lat < 27.6) return "沖縄";
  if (lon < 132.1 && lat < 34.8) return "九州・南西諸島";
  if (lon >= 134.4 && lat < 34.5) return "近畿";
  if (lat >= 35.0) return "山陰・北陸";
  return "瀬戸内・四国";
}

/** 端が日本の外にある way（国際航路）を見分ける。 */
function isInternational(way: OsmWay): boolean {
  const outsideJapan = (p: OsmPoint) =>
    p.lon < 122.5 || p.lon > 146.5 || p.lat < 23.5 || p.lat > 46.3;
  const ends = [way.geometry[0], way.geometry[way.geometry.length - 1]];
  if (ends.some((p) => p && outsideJapan(p))) return true;
  const text = `${way.tags?.name ?? ""} ${way.tags?.["name:en"] ?? ""}`;
  return /釜山|Busan|東海市|Donghae|上海|Shanghai|基隆|Keelung|ウラジオ|Vladivostok|コルサコフ|Korsakov/i.test(
    text,
  );
}

function terminalPoint(terminal: OsmTerminal): OsmPoint | undefined {
  if (terminal.lon !== undefined && terminal.lat !== undefined) {
    return { lon: terminal.lon, lat: terminal.lat };
  }
  return terminal.center;
}

export interface NearestTerminal {
  name: string;
  /** OSM に書かれているローマ字表記。港 ID の下書きに使う。 */
  romaji?: string;
  at: OsmPoint;
  distanceM: number;
}

/** 点に最も近い、名前のある OSM のフェリーターミナル。港台帳にない港の名前と座標の出どころになる。 */
export function nearestTerminal(
  point: OsmPoint,
  terminals: OsmTerminal[],
  withinM = TERMINAL_MATCH_M,
): NearestTerminal | undefined {
  let found: NearestTerminal | undefined;
  for (const terminal of terminals) {
    const name = terminal.tags?.name ?? terminal.tags?.["name:ja"];
    const at = terminalPoint(terminal);
    if (!name || !at) continue;
    const m = distanceM(point, at);
    if (m <= withinM && (!found || m < found.distanceM)) {
      const romaji =
        terminal.tags?.["name:ja-Latn"] ?? terminal.tags?.["name:en"] ?? terminal.tags?.int_name;
      found = { name, romaji, at, distanceM: m };
    }
  }
  return found;
}

function labelEndpoint(point: OsmPoint, ports: Port[], terminals: OsmTerminal[]): EndpointLabel {
  let nearestPort: { port: Port; m: number } | undefined;
  for (const port of ports) {
    const m = distanceM(point, port);
    if (m <= PORT_MATCH_M && (!nearestPort || m < nearestPort.m)) nearestPort = { port, m };
  }
  if (nearestPort) {
    return {
      portId: nearestPort.port.id,
      name: nearestPort.port.name,
      lon: point.lon,
      lat: point.lat,
    };
  }

  const terminal = nearestTerminal(point, terminals);
  const name = terminal?.name ?? `${point.lon.toFixed(3)},${point.lat.toFixed(3)}`;
  return { name, lon: point.lon, lat: point.lat };
}

function legKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function registeredLegKeys(routes: Route[]): Set<string> {
  const keys = new Set<string>();
  for (const route of routes) {
    for (const leg of route.legs) keys.add(legKey(leg.from, leg.to));
  }
  return keys;
}

/** OSM の operator タグは会社名の書きぶりが揺れるので、比較用に記号と法人格を落とす。 */
export function normalizeOperator(value: string): string {
  return value
    .replace(/株式会社|有限会社|（株）|\(株\)/g, "")
    .replace(/[\s・･]/g, "")
    .trim();
}

/** 同じ航路の way をまとめる鍵。名称のない way は、その way だけで1候補にする。 */
function routeKey(candidate: Candidate): string {
  const operator = candidate.operator ?? "";
  return candidate.name ? `${operator}|${candidate.name}` : `${operator}|way:${candidate.wayId}`;
}

function toCandidateRoute(ways: Candidate[]): CandidateRoute {
  const ports: string[] = [];
  for (const way of ways) {
    for (const end of [way.from, way.to]) {
      if (!ports.includes(end.name)) ports.push(end.name);
    }
  }
  const covered = ways.filter((w) => w.coverage !== "none").length;
  const first = ways[0];
  return {
    operator: first?.operator,
    name: first?.name,
    website: ways.find((w) => w.website)?.website,
    ways,
    ports,
    lengthKm: ways.reduce((sum, w) => sum + w.lengthKm, 0),
    region: first?.region ?? "不明",
    coverage: covered === 0 ? "none" : covered === ways.length ? "covered" : "partial",
    international: ways.some((w) => w.international),
  };
}

export function buildSurvey(
  ways: OsmWay[],
  terminals: OsmTerminal[],
  registry: Registry,
  osmTimestamp: string,
): Survey {
  const ports = [...registry.ports.values()];
  const referenced = new Set(
    registry.routes.flatMap((route) => route.legs.flatMap((leg) => leg.osmWays ?? [])),
  );
  const legs = registeredLegKeys(registry.routes);

  const wayCandidates: Candidate[] = [];
  for (const way of ways) {
    const first = way.geometry[0];
    const last = way.geometry[way.geometry.length - 1];
    if (!first || !last) continue;
    const from = labelEndpoint(first, ports, terminals);
    const to = labelEndpoint(last, ports, terminals);
    const coverage: Coverage = referenced.has(way.id)
      ? "way"
      : from.portId && to.portId && legs.has(legKey(from.portId, to.portId))
        ? "leg"
        : "none";
    wayCandidates.push({
      wayId: way.id,
      name: way.tags?.name ?? way.tags?.["name:ja"],
      operator: way.tags?.operator,
      website: way.tags?.website ?? way.tags?.["operator:website"],
      motorVehicle: way.tags?.motor_vehicle ?? way.tags?.motorcar ?? way.tags?.vehicle,
      duration: way.tags?.duration,
      from,
      to,
      lengthKm: lengthKm(way.geometry),
      region: classifyRegion(first),
      coverage,
      international: isInternational(way),
    });
  }

  const grouped = new Map<string, Candidate[]>();
  for (const candidate of wayCandidates) {
    const key = routeKey(candidate);
    const list = grouped.get(key);
    if (list) list.push(candidate);
    else grouped.set(key, [candidate]);
  }
  const routes = [...grouped.values()].map(toCandidateRoute);

  const registeredByOperator = new Map<string, number>();
  for (const route of registry.routes) {
    const key = normalizeOperator(route.operator);
    registeredByOperator.set(key, (registeredByOperator.get(key) ?? 0) + 1);
  }

  const byOperator = new Map<string, CandidateRoute[]>();
  for (const route of routes) {
    const key = route.operator ?? "";
    const list = byOperator.get(key);
    if (list) list.push(route);
    else byOperator.set(key, [route]);
  }

  const groups: OperatorGroup[] = [...byOperator].map(([operator, list]) => ({
    operator,
    routes: [...list].sort((a, b) => a.region.localeCompare(b.region) || b.lengthKm - a.lengthKm),
    uncovered: list.filter((r) => r.coverage !== "covered" && !r.international).length,
    registeredRoutes: operator
      .split(";")
      .reduce(
        (max, part) => Math.max(max, registeredByOperator.get(normalizeOperator(part)) ?? 0),
        0,
      ),
  }));
  groups.sort(
    (a, b) =>
      b.uncovered - a.uncovered ||
      b.routes.length - a.routes.length ||
      a.operator.localeCompare(b.operator),
  );

  const regionCounts = new Map<string, { uncovered: number; covered: number }>();
  for (const route of routes) {
    if (route.international) continue;
    const counts = regionCounts.get(route.region) ?? { uncovered: 0, covered: 0 };
    if (route.coverage === "covered") counts.covered++;
    else counts.uncovered++;
    regionCounts.set(route.region, counts);
  }
  const regions = [...regionCounts]
    .map(([region, counts]) => ({ region, ...counts }))
    .sort((a, b) => b.uncovered - a.uncovered || a.region.localeCompare(b.region));

  return { osmTimestamp, ways: wayCandidates, routes, groups, regions };
}

const coverageMark = {
  covered: "収録済み",
  partial: "一部収録",
  none: "未収録",
} as const;

function routeRow(route: CandidateRoute): string {
  const note = [
    route.international ? "国際" : "",
    route.ways.some((w) => w.motorVehicle === "yes")
      ? "車可"
      : route.ways.every((w) => w.motorVehicle === "no")
        ? "車不可"
        : "",
    route.ways.find((w) => w.duration)?.duration ?? "",
  ]
    .filter(Boolean)
    .join("／");
  const wayIds = route.ways.map((w) => w.wayId).join(" ");
  return `| ${route.name ?? "—"} | ${route.ports.join(" / ")} | ${route.lengthKm.toFixed(1)} km | ${route.region} | ${coverageMark[route.coverage]} | ${note || "—"} | ${wayIds} |`;
}

const TABLE_HEADER = [
  "| OSM の名称 | 端に出てくる港 | 距離 | 地域 | 状態 | 備考 | way |",
  "|---|---|---:|---|---|---|---|",
];

export function renderMarkdown(survey: Survey): string {
  const domestic = survey.routes.filter((r) => !r.international);
  const uncovered = domestic.filter((r) => r.coverage !== "covered");
  const lines: string[] = [];

  lines.push("# 網羅の進捗（OSM の route=ferry を分母にした候補一覧）");
  lines.push("");
  lines.push(
    "`pnpm data:survey-osm` が生成する。手で編集しない。ここに並ぶのは候補であって、台帳に入れてよいかは",
    "公式サイトで照合してから決める（[`add-route`](../.claude/skills/add-route/SKILL.md)）。",
  );
  lines.push("");
  lines.push(
    "OSM に線がない航路（推定形状で描く航路）はここに出てこない。逆に、OSM の `route=ferry` には対象航路で",
    "ないものも多く含まれる（湖の遊覧船、テーマパークの乗り物、貨物、廃止済みなど）。数は分母の目安として読む。",
  );
  lines.push("");
  lines.push(
    "候補は、OSM の `operator` と `name` が同じ way をひとまとめにしたもの。名称のない way は1本で1候補に",
    "なるので、実際の航路数より多めに出る。「端に出てくる港」は、港台帳の港名か、OSM のフェリーターミナル名。",
  );
  lines.push("");
  lines.push(
    `出典：© OpenStreetMap contributors（ODbL）。OSM のデータ時点：${survey.osmTimestamp}`,
  );
  lines.push("");
  lines.push("## まとめ");
  lines.push("");
  lines.push(`- OSM の \`route=ferry\` の way：${survey.ways.length} 本`);
  lines.push(`- まとめた候補：${survey.routes.length} 件`);
  lines.push(`  - 国際航路とみられるもの：${survey.routes.length - domestic.length} 件`);
  lines.push(
    `  - 台帳に入っているもの：${domestic.filter((r) => r.coverage === "covered").length} 件`,
  );
  lines.push(
    `  - **まだ台帳にないもの：${uncovered.length} 件**（うち一部だけ収録済み：${domestic.filter((r) => r.coverage === "partial").length} 件）`,
  );
  lines.push(
    `- 未収録の候補を持つ運航会社（OSM の operator タグ）：${survey.groups.filter((g) => g.uncovered > 0 && g.operator).length} 社`,
  );
  lines.push(
    `- operator タグのない未収録の候補：${uncovered.filter((r) => !r.operator).length} 件`,
  );
  lines.push("");
  lines.push("## 地域別");
  lines.push("");
  lines.push("| 地域 | 未収録 | 収録済み |");
  lines.push("|---|---:|---:|");
  for (const region of survey.regions) {
    lines.push(`| ${region.region} | ${region.uncovered} | ${region.covered} |`);
  }
  lines.push("");
  lines.push("## 運航会社別");
  lines.push("");
  lines.push("未収録の候補がある運航会社だけを、未収録の件数が多い順に並べる。");
  lines.push("");

  for (const group of survey.groups) {
    if (group.uncovered === 0 || !group.operator) continue;
    const registered =
      group.registeredRoutes > 0 ? `台帳に ${group.registeredRoutes} 航路あり` : "台帳になし";
    const website = group.routes.find((r) => r.website)?.website;
    lines.push(
      `### ${group.operator}（未収録 ${group.uncovered} / 候補 ${group.routes.length} 件・${registered}）`,
    );
    lines.push("");
    if (website) lines.push(`OSM に書かれている URL：${website}`, "");
    lines.push(...TABLE_HEADER);
    for (const route of group.routes) lines.push(routeRow(route));
    lines.push("");
  }

  const orphans = survey.groups.find((g) => !g.operator);
  if (orphans && orphans.uncovered > 0) {
    lines.push("## operator タグのない候補");
    lines.push("");
    lines.push("運航会社が OSM に書かれていないもの。名称や端の港から会社を調べる必要がある。");
    lines.push("");
    lines.push(...TABLE_HEADER);
    for (const route of orphans.routes) {
      if (route.coverage === "covered") continue;
      lines.push(routeRow(route));
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
