import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadExclusions } from "./excluded.ts";
import { paths } from "./paths.ts";

async function dataDir(excluded?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ferry-excluded-"));
  if (excluded !== undefined) await writeFile(join(dir, "excluded.yaml"), excluded);
  return dir;
}

describe("loadExclusions", () => {
  it("way ID ごとに引けるようにして返す", async () => {
    const dir = await dataDir("- osmWays: [1, 2]\n  reason: sightseeing\n  note: 周遊の観光船。\n");
    const exclusions = await loadExclusions(dir);
    expect([...exclusions.keys()]).toEqual([1, 2]);
    expect(exclusions.get(1)?.reason).toBe("sightseeing");
  });

  it("ファイルがなければ空で返す（まだ1件も記録していない状態）", async () => {
    expect(await loadExclusions(await dataDir())).toEqual(new Map());
  });

  it("同じ way を二度書いていれば例外にする", async () => {
    const dir = await dataDir(
      "- osmWays: [1]\n  reason: cargo\n  note: 貨物。\n- osmWays: [1]\n  reason: other\n  note: 別の理由。\n",
    );
    await expect(loadExclusions(dir)).rejects.toThrow("way 1 が重複している");
  });

  it("知らない区分は例外にする", async () => {
    const dir = await dataDir("- osmWays: [1]\n  reason: unknown\n  note: なぜか。\n");
    await expect(loadExclusions(dir)).rejects.toThrow("excluded.yaml");
  });

  it("理由が書かれていなければ例外にする（あとで見直せなくなるため）", async () => {
    const dir = await dataDir("- osmWays: [1]\n  reason: sightseeing\n  note: ''\n");
    await expect(loadExclusions(dir)).rejects.toThrow("excluded.yaml");
  });

  it("リポジトリの data/excluded.yaml が読める", async () => {
    const exclusions = await loadExclusions(paths.dataDir);
    expect(exclusions.size).toBeGreaterThan(0);
  });
});
