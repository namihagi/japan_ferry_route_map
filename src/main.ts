import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { createBaseStyle, JAPAN_BOUNDS } from "./map/baseStyle.ts";

setWorkerUrl(workerUrl);

const map = new MapLibreMap({
  container: "map",
  style: createBaseStyle(),
  bounds: JAPAN_BOUNDS,
  maxZoom: 17,
});
map.addControl(new NavigationControl({ showCompass: false }));
