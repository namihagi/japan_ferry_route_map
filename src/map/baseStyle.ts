import type { LngLatBoundsLike, StyleSpecification } from "maplibre-gl";

/** 初期表示で日本全体が収まる範囲（南西端・北東端の経度緯度）。 */
export const JAPAN_BOUNDS: LngLatBoundsLike = [
  [122.5, 24.0],
  [146.0, 45.8],
];

const GSI_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';

/** 港名などの文字に使うフォント（地理院が配信している Noto Sans CJK JP のグリフ）。 */
export const LABEL_FONT = ["NotoSansCJKjp-Regular"];

/** 背景地図（地理院タイル 淡色地図）だけを持つスタイル。 */
export function createBaseStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://maps.gsi.go.jp/xyz/noto-jp/{fontstack}/{range}.pbf",
    sources: {
      "gsi-pale": {
        type: "raster",
        tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
        tileSize: 256,
        minzoom: 2,
        maxzoom: 18,
        attribution: GSI_ATTRIBUTION,
      },
    },
    layers: [{ id: "gsi-pale", type: "raster", source: "gsi-pale" }],
  };
}
