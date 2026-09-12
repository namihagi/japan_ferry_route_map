import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "英小文字・数字・ハイフンの ID にする");
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式にする")
  .refine(
    (value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value),
    "実在する日付にする",
  );

export const portSchema = z.strictObject({
  id: slug,
  name: z.string().min(1),
  lon: z.number().min(122).max(154),
  lat: z.number().min(20).max(46),
});

export const legSchema = z.strictObject({
  from: slug,
  to: slug,
  /** 区間の実測形状として使う OSM の way ID。つながる順に並べる。 */
  osmWays: z.array(z.number().int().positive()).min(1).optional(),
});

export const routeSchema = z.strictObject({
  id: slug,
  name: z.string().min(1),
  operator: z.string().min(1),
  vesselType: z.enum(["ferry", "highspeed", "passenger"]),
  status: z.enum(["operating", "suspended"]),
  seasonal: z.boolean().default(false),
  officialUrl: z.url(),
  durationMinutes: z.number().int().positive().optional(),
  portsOfCall: z.array(slug).min(2),
  legs: z.array(legSchema).min(1),
  /** 照合の記録。これがある航路だけを公開する。 */
  verification: z
    .strictObject({
      checkedOn: isoDate,
      sources: z.array(z.url()).min(1),
    })
    .optional(),
  note: z.string().optional(),
});

export type Port = z.infer<typeof portSchema>;
export type Leg = z.infer<typeof legSchema>;
export type Route = z.infer<typeof routeSchema>;

export interface Registry {
  ports: Map<string, Port>;
  routes: Route[];
}

/** 台帳の中身が食い違っていないかを調べ、問題の一覧を返す（空なら問題なし）。 */
export function findRegistryProblems(registry: Registry): string[] {
  const problems: string[] = [];
  const seenRouteIds = new Set<string>();

  for (const route of registry.routes) {
    const where = `routes/${route.id}.yaml`;
    if (seenRouteIds.has(route.id)) problems.push(`${where}: 航路 ID が重複している`);
    seenRouteIds.add(route.id);

    for (const portId of route.portsOfCall) {
      if (!registry.ports.has(portId)) problems.push(`${where}: 港台帳にない港 ${portId}`);
    }
    route.portsOfCall.forEach((portId, i) => {
      if (portId === route.portsOfCall[i - 1]) {
        problems.push(`${where}: 寄港地 ${portId} が連続している`);
      }
    });

    const expectedLegs = route.portsOfCall.length - 1;
    if (route.legs.length !== expectedLegs) {
      problems.push(
        `${where}: 区間は寄港地の数 - 1 = ${expectedLegs} 個必要（${route.legs.length} 個ある）`,
      );
    }
    route.legs.forEach((leg, i) => {
      const from = route.portsOfCall[i];
      const to = route.portsOfCall[i + 1];
      if (from === undefined || to === undefined) return; // 区間の数が合っていない（上で指摘済み）
      if (leg.from !== from || leg.to !== to) {
        problems.push(
          `${where}: 区間 ${i + 1} は ${from} → ${to} のはずが ${leg.from} → ${leg.to} になっている`,
        );
      }
    });
  }
  return problems;
}

function formatZodError(file: string, error: z.ZodError): string {
  return error.issues
    .map((issue) => `${file}: ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
}

/** data/ から港台帳と航路台帳を読み込む。形式の誤りがあれば例外を投げる。 */
export async function loadRegistry(dataDir: string): Promise<Registry> {
  const errors: string[] = [];

  const portsFile = join(dataDir, "ports.yaml");
  const portsResult = z.array(portSchema).safeParse(parse(await readFile(portsFile, "utf8")));
  const ports = new Map<string, Port>();
  if (portsResult.success) {
    for (const port of portsResult.data) {
      if (ports.has(port.id)) errors.push(`ports.yaml: 港 ID ${port.id} が重複している`);
      ports.set(port.id, port);
    }
  } else {
    errors.push(formatZodError("ports.yaml", portsResult.error));
  }

  const routesDir = join(dataDir, "routes");
  const routeFiles = (await readdir(routesDir)).filter((f) => f.endsWith(".yaml")).sort();
  const routes: Route[] = [];
  for (const file of routeFiles) {
    const result = routeSchema.safeParse(parse(await readFile(join(routesDir, file), "utf8")));
    if (!result.success) {
      errors.push(formatZodError(`routes/${file}`, result.error));
      continue;
    }
    if (result.data.id !== basename(file, ".yaml")) {
      errors.push(`routes/${file}: id（${result.data.id}）をファイル名と一致させる`);
    }
    routes.push(result.data);
  }

  if (errors.length > 0) throw new Error(errors.join("\n"));
  return { ports, routes };
}

/** 全航路が参照している OSM の way ID（重複なし、昇順）。 */
export function referencedOsmWayIds(routes: Route[]): number[] {
  const ids = new Set(routes.flatMap((route) => route.legs.flatMap((leg) => leg.osmWays ?? [])));
  return [...ids].sort((a, b) => a - b);
}
