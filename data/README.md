# data/

このディレクトリのデータは ODbL です（[`LICENSE`](LICENSE)）。OSM 由来のデータと、自分で作ったデータだけを置きます。用語の意味は [`CONTEXT.md`](../CONTEXT.md) に従います。

| パス | 中身 | 作り方 |
|---|---|---|
| `ports.yaml` | 港台帳 | 手で書く |
| `routes/<id>.yaml` | 航路台帳（1航路1ファイル） | 手で書く |
| `osm/ways.geojson` | 航路台帳が参照する OSM の way のスナップショット | `pnpm data:import-osm` で取り込む（ADR 0003） |
| `estimated/<港A>--<港B>.geojson` | 推定形状（港の組ごとに1つ。港 ID の辞書順で A < B） | `pnpm data:estimate` で計算する（ADR 0002） |
| `excluded.yaml` | OSM の線のうち、対象航路でないと判断したものの記録 | 手で書く（下の「対象外の記録」） |

画面が読み込む公開データ（`public/data/`）は、`pnpm data:build` がこれらから作ります。公開データはコミットしません。

下書きは `.cache/drafts/` に作ります（`pnpm data:draft`）。照合前の下書きはリポジトリに置きません。手順は [`add-route`](../.claude/skills/add-route/SKILL.md) にあります。

## 航路台帳の書き方

スキーマの正本は [`scripts/lib/registry.ts`](../scripts/lib/registry.ts) にあります。

- `id`：英小文字・数字・ハイフンで書き、ファイル名と一致させる。
- `name`：運航会社が使っている航路名。ブランド名で知られている航路は、ブランド名にする（例：オーシャン東九フェリー）。
- `operator`：運航会社の正式名称から「株式会社」などを除いたもの。
- `vesselType`：`ferry`（フェリー）、`highspeed`（高速船）、`passenger`（旅客船）のどれか。船種が違えば別の航路にする。
- `status`：`operating`（運航中）か `suspended`（休止中）。
- `portsOfCall`：寄港地。港台帳の ID を、代表的な順序で並べる。
- `legs`：寄港地の隣り合う組ごとに1つずつ書く。
  - `osmWays` には、実測形状として使う OSM の way ID を、つながる順に並べる。
  - 1本の way が複数の区間にまたがっていてもよい。寄港地で自動的に切り分ける。
  - OSM に線がない区間は `osmWays` を書かない。その区間は推定形状で描く（下の「推定形状」）。
- `verification`：照合の記録。照合した日と、確かめた公式サイトの URL を書く。**これがない航路は公開しない。**
  - 照合で確かめるのは、航路名、運航会社、寄港地、船種、運航状態の5項目。
  - `durationMinutes`（所要時間）は、公式サイトで確かめられた場合だけ書く。

## 対象外の記録

`excluded.yaml` には、OSM の `route=ferry` のうち [`CONTEXT.md`](../CONTEXT.md) の「対象航路」に当てはまらないと判断した線を書きます。候補一覧（[`docs/coverage.md`](../docs/coverage.md)）の分母から外れるので、同じ線を何度も調べ直さずに済みます。

```yaml
- osmWays: [958462200, 958462201]
  reason: sightseeing
  note: 呉艦船めぐり。呉港に戻る周遊。
```

- `reason`：`sightseeing`（遊覧・周遊。湖の遊覧船も含む）、`discontinued`（廃止済み）、`cargo`（貨物）、`other`。
- `note`：そう判断した根拠を書く。**必ず書く。**あとで判断を見直せなくなるため。
- 判断が変わったら、その項目を消して `pnpm data:survey-osm` を実行し直す。
- 迷ったら書かない。書かなければ候補一覧に残るだけだが、間違って書くと候補が見えなくなる。

## 推定形状

`osmWays` のない区間は、海の上だけを通る最短経路を計算して描きます（計算方法は [`docs/spec.md`](../docs/spec.md) の「推定形状」）。実際の航路とは異なることがあり、地図では点線で描きます。

1. **準備（初回だけ）**：uv と、OSM の陸地ポリゴンを用意する。陸地ポリゴンは約900MB あり、リポジトリには入れない。
   ```sh
   mkdir -p .cache/land && cd .cache/land
   curl -LO https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip
   unzip land-polygons-split-4326.zip && rm land-polygons-split-4326.zip
   ```
2. **計算する**：`pnpm data:estimate` を実行する。
   - まだ計算していない区間と、港の座標が変わった区間だけを計算する。
   - 試しに1組だけ計算するときは `pnpm data:estimate --pair <港A> <港B>` を使う。結果は `.cache/estimated-trial/` に出る。
3. **確かめる**：警告（港を海まで大きく寄せた、線が陸を横切っている、など）が出たら、地図で目視して確かめる。
4. **コミットする**：`data/estimated/` の差分をレビューしてからコミットする。

港の座標を変えると、その港を使う推定形状は古くなり、`pnpm data:build` が失敗します。そのときは `pnpm data:estimate` を実行し直してください。
