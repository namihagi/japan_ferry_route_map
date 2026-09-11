# data/

このディレクトリのデータは ODbL です（[`LICENSE`](LICENSE)）。OSM 由来のデータと、自分で作ったデータだけを置きます。用語の意味は [`CONTEXT.md`](../CONTEXT.md) に従います。

| パス | 中身 | 作り方 |
|---|---|---|
| `ports.yaml` | 港台帳 | 手で書く |
| `routes/<id>.yaml` | 航路台帳（1航路1ファイル） | 手で書く |
| `osm/ways.geojson` | 航路台帳が参照する OSM の way のスナップショット | `pnpm data:import-osm` で取り込む（ADR 0003） |

画面が読み込む公開データ（`public/data/`）は、`pnpm data:build` がこれらから作ります。公開データはコミットしません。

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
- `verification`：照合の記録。照合した日と、確かめた公式サイトの URL を書く。**これがない航路は公開しない。**
  - 照合で確かめるのは、航路名、運航会社、寄港地、船種、運航状態の5項目。
  - `durationMinutes`（所要時間）は、公式サイトで確かめられた場合だけ書く。
