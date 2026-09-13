import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { LngLat, Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { formatPermalink, parsePermalink } from "./domain/permalink.ts";
import { PUBLIC_DATA_FILES, type RouteDetail } from "./domain/publicData.ts";
import {
  matchesFilter,
  operatorsOf,
  type RouteFilter,
  routesByPort,
  SHOW_ALL,
  toFilterExpression,
} from "./domain/routeFilter.ts";
import { createBaseStyle, JAPAN_BOUNDS } from "./map/baseStyle.ts";
import { addPortLayers, portIdsNear } from "./map/portLayers.ts";
import {
  addRouteLayers,
  highlightRoutes,
  routeIdsNear,
  setRouteFilter,
} from "./map/routeLayers.ts";
import { createFilterPanel } from "./ui/filterPanel.ts";
import { routeChoices, routeTicket } from "./ui/routeCards.ts";

/** 読み込みに失敗したときは、地図だけが出て操作できない状態になるので、画面に伝える。 */
function showError(error: unknown): void {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  const existing = document.querySelector(".error-banner");
  const banner = existing ?? document.createElement("p");
  banner.className = "error-banner";
  banner.setAttribute("role", "alert");
  banner.textContent = `データを読み込めませんでした：${message} 時間をおいて再読み込みしてください。`;
  if (!existing) document.body.append(banner);
}

declare global {
  interface Window {
    /** E2E テストから地図の状態を調べるために公開している。 */
    ferryMap?: MapLibreMap;
  }
}

setWorkerUrl(workerUrl);

const dataBaseUrl = `${import.meta.env.BASE_URL}data/`;
const routeDetails = fetch(`${dataBaseUrl}${PUBLIC_DATA_FILES.routeDetails}`).then(
  async (response) => {
    if (!response.ok)
      throw new Error(`航路の情報を読み込めませんでした（HTTP ${response.status}）`);
    return (await response.json()) as RouteDetail[];
  },
);

/** URL に入っている表示位置と航路（docs/spec.md「パーマリンク」）。 */
const initial = parsePermalink(window.location.hash);

const map = new MapLibreMap({
  container: "map",
  style: createBaseStyle(),
  ...(initial.view
    ? { center: [initial.view.lon, initial.view.lat] as [number, number], zoom: initial.view.zoom }
    : { bounds: JAPAN_BOUNDS }),
  maxZoom: 17,
  // 既定では画面幅 640px 未満で出典が折りたたまれる。仕様では常に表示する
  attributionControl: { compact: false },
  locale: {
    "NavigationControl.ZoomIn": "拡大",
    "NavigationControl.ZoomOut": "縮小",
    "Popup.Close": "閉じる",
    "Map.Title": "地図",
    "AttributionControl.ToggleAttribution": "出典を表示",
  },
});
map.addControl(new NavigationControl({ showCompass: false }));
window.ferryMap = map;

async function initialize(): Promise<void> {
  addRouteLayers(map, dataBaseUrl);
  addPortLayers(map, dataBaseUrl);

  /** 選んでいる航路。URL に書き戻すために持つ（航路の一覧を出しているときは undefined）。 */
  let selectedRouteId = initial.routeId;
  /** 履歴を汚さないように replaceState で書き換える（戻るボタンで1手ずつ戻れても嬉しくない）。 */
  const writePermalink = () => {
    const center = map.getCenter();
    const hash = formatPermalink({
      view: { zoom: map.getZoom(), lat: center.lat, lon: center.lng },
      routeId: selectedRouteId,
    });
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}${hash}`);
  };

  const details = await routeDetails;
  const byId = new Map(details.map((route) => [route.id, route]));
  const byPort = routesByPort(details);
  const portNames = new Map(
    details.flatMap((route) => route.portsOfCall.map((p) => [p.id, p.name])),
  );
  let filter: RouteFilter = SHOW_ALL;

  // 地図のクリックで閉じる処理は自前で行う（closeOnClick だと、別の航路を選んだ直後に閉じてしまう）
  const popup = new Popup({
    className: "ferry-popup",
    maxWidth: "min(340px, 90vw)",
    closeOnClick: false,
  });
  popup.on("close", () => {
    highlightRoutes(map, null);
    selectedRouteId = undefined;
    writePermalink();
  });

  const open = (content: HTMLElement, at: LngLat, highlighted: string[], routeId?: string) => {
    selectedRouteId = routeId;
    popup.setLngLat(at).setDOMContent(content).addTo(map);
    highlightRoutes(map, highlighted);
    // 一覧から航路を選ぶと押したボタンが消えるので、開いた内容へフォーカスを移す
    content.tabIndex = -1;
    content.focus();
    writePermalink();
  };
  const showRoute = (route: RouteDetail, at: LngLat) =>
    open(routeTicket(route), at, [route.id], route.id);
  const showChoices = (heading: string, routes: RouteDetail[], at: LngLat) =>
    open(
      routeChoices(heading, routes, (route) => showRoute(route, at)),
      at,
      routes.map((route) => route.id),
    );

  const panel = createFilterPanel(operatorsOf(details), filter, (next) => {
    filter = next;
    setRouteFilter(map, toFilterExpression(filter));
    panel.setVisibleCount(
      details.filter((route) => matchesFilter(route, filter)).length,
      details.length,
    );
    popup.remove();
  });
  panel.setVisibleCount(details.length, details.length);
  document.body.append(panel.element);

  map.on("click", (event) => {
    const portId = portIdsNear(map, event.point)[0];
    if (portId) {
      const routes = (byPort.get(portId) ?? []).filter((route) => matchesFilter(route, filter));
      showChoices(`${portNames.get(portId) ?? ""}に発着する航路`, routes, event.lngLat);
      return;
    }
    const routes = routeIdsNear(map, event.point).flatMap((id) => byId.get(id) ?? []);
    const [only] = routes;
    if (only === undefined) popup.remove();
    else if (routes.length === 1) showRoute(only, event.lngLat);
    else showChoices(`この場所を通る航路（${routes.length}）`, routes, event.lngLat);
  });

  map.on("moveend", writePermalink);

  // URL で航路を指定されていたら、その航路に地図を寄せて詳細を開く
  const linked = selectedRouteId === undefined ? undefined : byId.get(selectedRouteId);
  if (linked) {
    const [west, south, east, north] = linked.bounds;
    if (!initial.view) {
      map.fitBounds([west, south, east, north], { padding: 60, maxZoom: 12, animate: false });
    }
    showRoute(linked, new LngLat((west + east) / 2, (south + north) / 2));
  } else {
    selectedRouteId = undefined;
  }
  writePermalink();

  map.on("mousemove", (event) => {
    const clickable =
      portIdsNear(map, event.point).length > 0 || routeIdsNear(map, event.point).length > 0;
    map.getCanvas().style.cursor = clickable ? "pointer" : "";
  });
}

// 取得できなくても未処理の reject にならないようにしておく（本体の待ち受けは initialize 側）
routeDetails.catch(() => {});
map.on("load", () => {
  initialize().catch(showError);
});
map.on("error", (event) => showError(event.error ?? new Error("地図の読み込みに失敗しました")));
