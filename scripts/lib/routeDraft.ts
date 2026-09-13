/**
 * 候補一覧（osmSurvey）から、航路台帳と港台帳の下書きを組み立てる。
 *
 * 下書きは推測を含むので、そのままでは台帳に入れない。エージェントの仕事を
 * 「公式サイトで5項目を確かめて直し、`verification` を書く」だけに絞るためのもの（add-route スキル）。
 */
import type { Candidate, CandidateRoute, EndpointLabel, OsmTerminal } from "./osmSurvey.ts";
import { distanceM, nearestTerminal } from "./osmSurvey.ts";
import type { Registry } from "./registry.ts";

/** 確かめられなかったところに置く目印。下書きにこれが残っていたら台帳に入れない。 */
export const TODO = "TODO";

/** way の端どうしを同じ港とみなす距離（m）。OSM では隣り合う way は同じ node を共有していることが多い。 */
const JOIN_M = 300;

export interface DraftPort {
  id: string;
  name: string;
  lon: number;
  lat: number;
  /** 港台帳にすでにある港か。 */
  existing: boolean;
}

export interface RouteDraft {
  /** 下書きファイルの名前に使う。台帳に移すときは航路 ID に付け替える。 */
  fileStem: string;
  id: string;
  name: string;
  operator: string;
  vesselType: string;
  status: string;
  officialUrl: string;
  ports: DraftPort[];
  legs: { from: string; to: string; osmWays: number[] }[];
  /** OSM に書かれていた値。照合するときの手がかりとして下書きにコメントで残す。 */
  osm: { name?: string; operator?: string; website?: string; duration?: string; region: string };
  warnings: string[];
}

/** 端点をまとめた「節」。港台帳の港に届いていればその港、届いていなければ新しい港の候補。 */
interface Node {
  key: string;
  label: EndpointLabel;
  portId?: string;
}

function nodeKey(label: EndpointLabel, nodes: Node[]): string {
  if (label.portId) return label.portId;
  for (const node of nodes) {
    if (node.portId) continue;
    if (distanceM(label, node.label) <= JOIN_M) return node.key;
  }
  return `@${label.lon.toFixed(5)},${label.lat.toFixed(5)}`;
}

function collectNodes(ways: Candidate[]): Map<string, Node> {
  const nodes = new Map<string, Node>();
  for (const way of ways) {
    for (const label of [way.from, way.to]) {
      const key = nodeKey(label, [...nodes.values()]);
      if (!nodes.has(key)) nodes.set(key, { key, label, portId: label.portId });
    }
  }
  return nodes;
}

/**
 * way を1本の線につないだときの節の並びを返す。枝分かれしていたり、輪になっていたりしてつなげない
 * ときは undefined を返す（呼び出し側で way ごとの下書きに分ける）。
 */
export function orderNodes(
  ways: Candidate[],
  keyOf: (label: EndpointLabel) => string,
): { order: string[]; legWays: Map<string, number[]> } | undefined {
  const edges = ways.map((way) => ({
    a: keyOf(way.from),
    b: keyOf(way.to),
    wayId: way.wayId,
  }));
  const degree = new Map<string, number>();
  const neighbours = new Map<string, { to: string; wayId: number }[]>();
  const legWays = new Map<string, number[]>();
  for (const edge of edges) {
    if (edge.a === edge.b) return undefined; // 同じ港に戻る線。周遊型の可能性があるので人が見る。
    const key = edge.a < edge.b ? `${edge.a}|${edge.b}` : `${edge.b}|${edge.a}`;
    const existing = legWays.get(key);
    if (existing) {
      existing.push(edge.wayId); // 同じ港の組に線が2本ある（往復で別の線が引かれている）。
      continue;
    }
    legWays.set(key, [edge.wayId]);
    for (const [from, to] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ] as const) {
      degree.set(from, (degree.get(from) ?? 0) + 1);
      neighbours.set(from, [...(neighbours.get(from) ?? []), { to, wayId: edge.wayId }]);
    }
  }

  const ends = [...degree].filter(([, d]) => d === 1).map(([key]) => key);
  if (ends.length !== 2) return undefined; // 枝分かれか輪。人が見る。

  // 1本目の way の始点が端なら、そこから並べる（OSM に描かれた向きに合わせる）。
  const firstFrom = ways[0] ? keyOf(ways[0].from) : undefined;
  const start = (firstFrom && ends.includes(firstFrom) ? firstFrom : ends[0]) as string;
  const order: string[] = [start];
  const visited = new Set<number>();
  let current = start;
  for (;;) {
    const next = (neighbours.get(current) ?? []).find((n) => !visited.has(n.wayId));
    if (!next) break;
    visited.add(next.wayId);
    order.push(next.to);
    current = next.to;
  }
  if (order.length !== degree.size) return undefined; // たどり切れなかった（枝分かれ）。
  return { order, legWays };
}

/** OSM のローマ字表記から港 ID の下書きを作る。作れなければ TODO。 */
export function portIdFromRomaji(romaji: string | undefined): string {
  if (!romaji) return TODO;
  const slug = romaji
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/\b(port|ferry|terminal|pier|landing|wharf)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || TODO;
}

/** OSM の車の可否から船種の当たりを付ける。高速船かどうかは OSM では分からないので人が確かめる。 */
function guessVesselType(ways: Candidate[]): string {
  if (ways.some((way) => way.motorVehicle === "yes")) return "ferry";
  if (ways.length > 0 && ways.every((way) => way.motorVehicle === "no")) return "passenger";
  return TODO;
}

/**
 * 1回の実行で使う港の帳面。同じ港が複数の航路に出てきても1つにまとめ、ID を付けられなかった港には
 * 通し番号の仮 ID を振る（航路の下書きと港の下書きで同じ ID を指すようにするため）。
 */
export class DraftPortBook {
  private readonly added: DraftPort[] = [];
  private readonly terminals: OsmTerminal[];
  private readonly registry: Registry;

  constructor(terminals: OsmTerminal[], registry: Registry) {
    this.terminals = terminals;
    this.registry = registry;
  }

  /** 台帳にない港のうち、この帳面が新しく作ったもの。 */
  get newPorts(): DraftPort[] {
    return this.added;
  }

  resolve(node: Node): DraftPort {
    if (node.portId) {
      const port = this.registry.ports.get(node.portId);
      if (port) return { ...port, existing: true };
    }
    const terminal = nearestTerminal(node.label, this.terminals);
    const at = terminal?.at ?? node.label;
    const known = this.added.find((port) => distanceM(port, at) <= JOIN_M);
    if (known) return known;

    const id = portIdFromRomaji(terminal?.romaji);
    const port: DraftPort = {
      id: id === TODO ? `todo-${this.added.length + 1}` : id,
      name: terminal?.name ?? TODO,
      lon: at.lon,
      lat: at.lat,
      existing: false,
    };
    this.added.push(port);
    return port;
  }
}

function draftFrom(
  candidate: CandidateRoute,
  ways: Candidate[],
  book: DraftPortBook,
  warnings: string[],
): RouteDraft | undefined {
  const nodes = collectNodes(ways);
  const keyOf = (label: EndpointLabel) => nodeKey(label, [...nodes.values()]);
  const chain = orderNodes(ways, keyOf);
  if (!chain) return undefined;

  const ports = chain.order.map((key) => {
    const node = nodes.get(key);
    if (!node) throw new Error(`節 ${key} がない`);
    return book.resolve(node);
  });

  const legs = ports.slice(0, -1).map((from, i) => {
    const to = ports[i + 1];
    const a = chain.order[i];
    const b = chain.order[i + 1];
    const legKey = (a as string) < (b as string) ? `${a}|${b}` : `${b}|${a}`;
    return { from: from.id, to: to?.id ?? TODO, osmWays: chain.legWays.get(legKey) ?? [] };
  });
  for (const leg of legs) {
    if (leg.osmWays.length > 1) {
      warnings.push(
        `${leg.from}〜${leg.to} に線が ${leg.osmWays.length} 本ある（往復で別々に引かれている可能性）。1本に絞る`,
      );
    }
  }

  const first = ports[0];
  const last = ports[ports.length - 1];
  const operator = candidate.operator?.split(";")[0] ?? TODO;
  return {
    fileStem: `${ways[0]?.wayId}`,
    id: `${TODO}-${first?.id ?? TODO}-${last?.id ?? TODO}`,
    name: candidate.name ?? TODO,
    operator,
    vesselType: guessVesselType(ways),
    status: "operating",
    officialUrl: candidate.website ?? TODO,
    ports,
    legs,
    osm: {
      name: candidate.name,
      operator: candidate.operator,
      website: candidate.website,
      duration: ways.find((way) => way.duration)?.duration,
      region: candidate.region,
    },
    warnings,
  };
}

/**
 * 候補1件から下書きを作る。way がつながらない候補は、way ごとに1つの下書きに分ける。
 * 分けた下書きは寄港地が2つになるので、公式サイトを見て人がまとめ直す。
 */
export function buildDrafts(candidate: CandidateRoute, book: DraftPortBook): RouteDraft[] {
  const whole = draftFrom(candidate, candidate.ways, book, []);
  if (whole) return [whole];

  const drafts: RouteDraft[] = [];
  for (const way of candidate.ways) {
    const draft = draftFrom(candidate, [way], book, [
      "OSM の線がつながらないため way ごとに分けた。公式サイトを見て寄港地の並びをまとめ直す",
    ]);
    if (draft) drafts.push(draft);
  }
  return drafts;
}

function comment(draft: RouteDraft): string[] {
  const lines = [
    "# 下書き。公式サイトで5項目（航路名・運航会社・寄港地・船種・運航状態）を確かめ、",
    `# ${TODO} を埋めてから data/routes/<id>.yaml に移す（.claude/skills/add-route/SKILL.md）。`,
    `# OSM の元データ：name=${draft.osm.name ?? "—"} / operator=${draft.osm.operator ?? "—"}` +
      ` / website=${draft.osm.website ?? "—"} / duration=${draft.osm.duration ?? "—"} / ${draft.osm.region}`,
  ];
  for (const warning of draft.warnings) lines.push(`# 注意：${warning}`);
  return lines;
}

export function renderDraftYaml(draft: RouteDraft): string {
  const lines = [
    ...comment(draft),
    `id: ${draft.id}`,
    `name: ${draft.name}`,
    `operator: ${draft.operator}`,
    `vesselType: ${draft.vesselType}  # OSM の車の可否からの推定。高速船かは公式サイトで確かめる`,
    `status: ${draft.status}  # 推定`,
    `officialUrl: ${draft.officialUrl}`,
    `portsOfCall: [${draft.ports.map((port) => port.id).join(", ")}]`,
    "legs:",
  ];
  for (const leg of draft.legs) {
    lines.push(`  - from: ${leg.from}`, `    to: ${leg.to}`);
    if (leg.osmWays.length > 0) lines.push(`    osmWays: [${leg.osmWays.join(", ")}]`);
  }
  lines.push("# verification は照合してから書く（これがないと公開されない）");
  return `${lines.join("\n")}\n`;
}

/** 港台帳に追記する下書き。data/ports.yaml の書き方に合わせる。 */
export function renderPortsYaml(ports: DraftPort[]): string {
  const lines = [
    "# 港台帳の下書き。名前と ID を確かめてから data/ports.yaml に追記する。",
    "# 座標は OSM の amenity=ferry_terminal か、航路の線の端点。",
    "",
  ];
  for (const port of ports) {
    lines.push(
      `- id: ${port.id}`,
      `  name: ${port.name}`,
      `  lon: ${port.lon.toFixed(5)}`,
      `  lat: ${port.lat.toFixed(5)}`,
      "",
    );
  }
  return `${lines.join("\n")}`;
}
