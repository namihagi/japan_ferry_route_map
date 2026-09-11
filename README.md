# 日本フェリー航路マップ

日本国内のフェリー・高速船・旅客船の定期航路を、日本地図の上に描いて自由に眺められる Web サイトです。

- 公開 URL（予定）：https://namihagi.github.io/japan_ferry_route_map/
- 状態：開発中

## 収録範囲

一般の旅客が乗れる、国内の定期航路を収録します。運航中の航路と休止中の航路が対象です。

国際航路、廃止済みの航路、遊覧船、貨物フェリーは含みません。定義の詳細は [`CONTEXT.md`](CONTEXT.md) を参照してください。

## ご注意

- 掲載している情報は、正確さを保証しません。運航状況、時刻、運賃は、必ず各運航会社の公式サイトで確認してください。
- 点線で描いた区間は、海の上だけを通る最短経路として計算した**推定の線**です。実際の航路とは異なります。

## 出典

| 対象 | 出典 |
|---|---|
| 航路の形状 | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors（ODbL） |
| 推定形状の計算に使った陸地データ | OpenStreetMap land polygons（ODbL） |
| 航路・港の情報 | 各運航会社の公式サイトを参照して作成 |
| 背景地図 | [国土地理院](https://maps.gsi.go.jp/development/ichiran.html) 地理院タイル（淡色地図） |

## ライセンス

- ソースコード：MIT（[`LICENSE`](LICENSE)）
- `data/` 以下のデータ：ODbL 1.0（[`data/LICENSE`](data/LICENSE)）

## 開発

雛形を作成したあとに追記します。設計資料は次のとおりです。

- [`docs/spec.md`](docs/spec.md)：初版の仕様
- [`CONTEXT.md`](CONTEXT.md)：用語集
- [`docs/adr/`](docs/adr/)：設計判断の記録
