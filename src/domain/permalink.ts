/**
 * 表示位置と選んだ航路を URL に持たせる（docs/spec.md「パーマリンク」）。
 *
 * 形は OpenStreetMap に合わせて `#map=<zoom>/<lat>/<lon>` とし、航路を選んでいるときは
 * `&route=<航路 ID>` を足す。GitHub Pages は静的配信なので、サーバ設定のいらないハッシュに入れる。
 */

export interface MapView {
  zoom: number;
  lat: number;
  lon: number;
}

export interface PermalinkState {
  /** URL に表示位置がないときは undefined（日本全体を表示する）。 */
  view?: MapView;
  /** URL に航路がないときは undefined。 */
  routeId?: string;
}

/** 航路 ID は台帳と同じ英小文字・数字・ハイフン。ほかの文字が来たら URL の壊れとみなす。 */
const ROUTE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 座標の桁数。5桁で約1m。これ以上細かくしても地図では見分けが付かない。 */
const COORD_DIGITS = 5;

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseView(value: string): MapView | undefined {
  const [zoom, lat, lon] = value.split("/").map(finiteNumber);
  if (zoom === undefined || lat === undefined || lon === undefined) return undefined;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || zoom < 0 || zoom > 24) return undefined;
  return { zoom, lat, lon };
}

/** URL のハッシュを読む。壊れていたら、読めたところだけを返す（読み込み自体は止めない）。 */
export function parsePermalink(hash: string): PermalinkState {
  const state: PermalinkState = {};
  for (const part of hash.replace(/^#/, "").split("&")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator);
    const value = decodeURIComponent(part.slice(separator + 1));
    if (key === "map") {
      const view = parseView(value);
      if (view) state.view = view;
    } else if (key === "route" && ROUTE_ID.test(value)) {
      state.routeId = value;
    }
  }
  return state;
}

/** 状態を URL のハッシュにする（先頭の # を含む）。表示位置も航路もなければ空文字列。 */
export function formatPermalink(state: PermalinkState): string {
  const parts: string[] = [];
  if (state.view) {
    const { zoom, lat, lon } = state.view;
    parts.push(`map=${zoom.toFixed(2)}/${lat.toFixed(COORD_DIGITS)}/${lon.toFixed(COORD_DIGITS)}`);
  }
  if (state.routeId) parts.push(`route=${state.routeId}`);
  return parts.length > 0 ? `#${parts.join("&")}` : "";
}
