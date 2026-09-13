/**
 * 候補一覧から航路台帳・港台帳の下書きを作り、.cache/drafts/ に書き出す。
 *
 *   pnpm data:draft --operator 東京湾フェリー
 *   pnpm data:draft --name 伊勢湾            # operator タグがない候補は名称で選ぶ
 *   pnpm data:draft --way 30263603 207113623 # way を直に指定する
 *
 * 下書きは推測を含むので、そのままでは台帳に入れない。公式サイトで5項目を確かめ、TODO を埋め、
 * data/routes/ と data/ports.yaml に移してから照合の記録を書く（add-route スキル）。
 * 下書きをリポジトリに置かないのは、照合前のものを公開データと混ぜないため（CLAUDE.md のガードレール2）。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Survey } from "./lib/osmSurvey.ts";
import { paths } from "./lib/paths.ts";
import { loadRegistry } from "./lib/registry.ts";
import {
  buildDrafts,
  DraftPortBook,
  renderDraftYaml,
  renderPortsYaml,
  TODO,
} from "./lib/routeDraft.ts";

function argValues(flag: string): string[] {
  const start = process.argv.indexOf(flag);
  if (start < 0) return [];
  const values: string[] = [];
  for (let i = start + 1; i < process.argv.length; i++) {
    const value = process.argv[i];
    if (!value || value.startsWith("--")) break;
    values.push(value);
  }
  return values;
}

const operators = argValues("--operator");
const names = argValues("--name");
const wayIds = new Set(argValues("--way").map(Number));
if (operators.length + names.length + wayIds.size === 0) {
  console.error("--operator / --name / --way のどれかで対象を選ぶ");
  process.exit(1);
}

const cacheDir = join(paths.cacheDir, "osm-survey");
const surveyFile = join(cacheDir, "survey.json");
let survey: Survey;
try {
  survey = JSON.parse(await readFile(surveyFile, "utf8")) as Survey;
} catch {
  console.error(`${surveyFile} がない。先に pnpm data:survey-osm を実行する`);
  process.exit(1);
}
const terminals = JSON.parse(await readFile(join(cacheDir, "terminals.json"), "utf8")).elements;
const registry = await loadRegistry(paths.dataDir);

const matched = survey.routes.filter((route) => {
  if (route.ways.some((way) => wayIds.has(way.wayId))) return true;
  if (operators.some((q) => route.operator?.includes(q))) return true;
  return names.some((q) => route.name?.includes(q));
});
if (matched.length === 0) {
  console.error("当てはまる候補がない。docs/coverage.md で名称や way を確かめる");
  process.exit(1);
}

const draftsDir = join(paths.cacheDir, "drafts");
await mkdir(draftsDir, { recursive: true });

const book = new DraftPortBook(terminals, registry);
let written = 0;
const todos: string[] = [];
for (const candidate of matched) {
  for (const draft of buildDrafts(candidate, book)) {
    await writeFile(join(draftsDir, `${draft.fileStem}.yaml`), renderDraftYaml(draft));
    written++;
    const missing = [
      draft.name === TODO ? "航路名" : "",
      draft.operator === TODO ? "運航会社" : "",
      draft.vesselType === TODO ? "船種" : "",
      draft.officialUrl === TODO ? "公式サイト" : "",
      draft.ports.some((port) => port.id.startsWith("todo-") || port.name === TODO) ? "港" : "",
    ].filter(Boolean);
    todos.push(
      `  ${draft.fileStem}.yaml  ${draft.osm.name ?? "（名称なし）"}` +
        `  [${draft.ports.map((p) => p.name).join(" 〜 ")}]` +
        (missing.length > 0 ? `  要確認：${missing.join("・")}` : ""),
    );
  }
}

if (book.newPorts.length > 0) {
  await writeFile(join(draftsDir, "ports.yaml"), renderPortsYaml(book.newPorts));
}

console.log(`候補 ${matched.length} 件から下書き ${written} 本を ${draftsDir} に書きました`);
console.log(todos.join("\n"));
console.log(
  `新しい港の候補：${book.newPorts.length} か所（drafts/ports.yaml）。` +
    `うち ID か名前を自分で付けるもの：${book.newPorts.filter((p) => p.id.startsWith("todo-") || p.name === TODO).length} か所`,
);
