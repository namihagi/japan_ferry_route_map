/**
 * 航路台帳・港台帳・OSM スナップショットから、画面で読み込む公開データを public/data/ に書き出す。
 * pnpm dev / pnpm build の前に自動で実行される。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PUBLIC_DATA_FILES } from "../src/domain/publicData.ts";
import { buildPublicData } from "./lib/buildPublicData.ts";
import { readEstimatedLegs } from "./lib/estimatedGeometry.ts";
import { readOsmSnapshot } from "./lib/osmSnapshot.ts";
import { paths } from "./lib/paths.ts";
import { loadRegistry } from "./lib/registry.ts";

try {
  const registry = await loadRegistry(paths.dataDir);
  const data = buildPublicData(
    registry,
    await readOsmSnapshot(paths.osmSnapshot),
    await readEstimatedLegs(paths.estimatedDir),
  );

  await mkdir(paths.publicDataDir, { recursive: true });
  await writeFile(join(paths.publicDataDir, PUBLIC_DATA_FILES.routes), JSON.stringify(data.routes));
  await writeFile(join(paths.publicDataDir, PUBLIC_DATA_FILES.ports), JSON.stringify(data.ports));

  const published = new Set(data.routes.features.map((f) => f.properties.routeId)).size;
  console.log(
    `公開データを書き出しました: 航路 ${published} 本（${data.routes.features.length} 区間）、港 ${data.ports.features.length} か所`,
  );
  if (data.skippedRouteIds.length > 0) {
    console.log(`照合前のため公開しなかった航路: ${data.skippedRouteIds.join(", ")}`);
  }
} catch (error) {
  console.error(`公開データを作れませんでした:\n${(error as Error).message}`);
  process.exitCode = 1;
}
