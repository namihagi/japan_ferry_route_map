import { readFile, writeFile } from "node:fs/promises";
import type { Feature, FeatureCollection, LineString, Position } from "geojson";

export interface OsmWayProperties {
  osmId: number;
  name?: string;
}

export type OsmWayFeature = Feature<LineString, OsmWayProperties>;

/** data/osm/ways.geojson を読み込み、way ID → 座標列の対応を返す。ファイルがなければ空。 */
export async function readOsmSnapshot(file: string): Promise<Map<number, OsmWayFeature>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return new Map();
  }
  const collection = JSON.parse(text) as FeatureCollection<LineString, OsmWayProperties>;
  return new Map(collection.features.map((feature) => [feature.properties.osmId, feature]));
}

const round = (value: number) => Math.round(value * 1e7) / 1e7;

/** way ID の昇順・座標は小数7桁に丸めて書き出す（取り込み直したときの差分を小さくするため）。 */
export async function writeOsmSnapshot(
  file: string,
  ways: Map<number, OsmWayFeature>,
): Promise<void> {
  const features = [...ways.values()]
    .sort((a, b) => a.properties.osmId - b.properties.osmId)
    .map(
      (feature): OsmWayFeature => ({
        type: "Feature",
        properties: feature.properties,
        geometry: {
          type: "LineString",
          coordinates: feature.geometry.coordinates.map(
            ([lon = 0, lat = 0]): Position => [round(lon), round(lat)],
          ),
        },
      }),
    );
  const collection: FeatureCollection<LineString, OsmWayProperties> = {
    type: "FeatureCollection",
    features,
  };
  await writeFile(file, `${JSON.stringify(collection, null, 2)}\n`);
}
