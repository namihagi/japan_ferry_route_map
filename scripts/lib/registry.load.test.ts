import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRegistry } from "./registry.ts";

/** 台帳を一時ディレクトリに書き出す。 */
async function dataDir(ports: string, routes: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ferry-registry-"));
  await writeFile(join(dir, "ports.yaml"), ports);
  await mkdir(join(dir, "routes"));
  for (const [name, body] of Object.entries(routes)) {
    await writeFile(join(dir, "routes", name), body);
  }
  return dir;
}

const PORTS = `- id: a
  name: A港
  lon: 133.0
  lat: 34.0
- id: b
  name: B港
  lon: 133.1
  lat: 34.0
`;

const route = (id: string) => `id: ${id}
name: サンプル航路
operator: サンプル汽船
vesselType: ferry
status: operating
officialUrl: https://example.com/
portsOfCall: [a, b]
legs:
  - from: a
    to: b
    osmWays: [1]
`;

describe("loadRegistry", () => {
  it("港台帳と航路台帳を読み込む", async () => {
    const registry = await loadRegistry(await dataDir(PORTS, { "sample.yaml": route("sample") }));
    expect([...registry.ports.keys()]).toEqual(["a", "b"]);
    expect(registry.routes.map((r) => r.id)).toEqual(["sample"]);
  });

  it("id とファイル名が違えば例外にする", async () => {
    const dir = await dataDir(PORTS, { "sample.yaml": route("other") });
    await expect(loadRegistry(dir)).rejects.toThrow("ファイル名と一致させる");
  });

  it("港 ID が重複していれば例外にする", async () => {
    const dir = await dataDir(`${PORTS}- id: a\n  name: A港（重複）\n  lon: 133.2\n  lat: 34.0\n`, {
      "sample.yaml": route("sample"),
    });
    await expect(loadRegistry(dir)).rejects.toThrow("重複している");
  });

  it("スキーマに合わない航路台帳は、どのファイルの何が悪いかを示す", async () => {
    const dir = await dataDir(PORTS, {
      "sample.yaml": route("sample").replace("vesselType: ferry", "vesselType: hovercraft"),
    });
    await expect(loadRegistry(dir)).rejects.toThrow("routes/sample.yaml: vesselType");
  });

  it("照合日が実在しない日付なら例外にする", async () => {
    const dir = await dataDir(PORTS, {
      "sample.yaml": `${route("sample")}verification:\n  checkedOn: "2026-02-30"\n  sources:\n    - https://example.com/\n`,
    });
    await expect(loadRegistry(dir)).rejects.toThrow("実在する日付");
  });
});
