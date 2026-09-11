import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");

export const paths = {
  dataDir: join(root, "data"),
  osmSnapshot: join(root, "data", "osm", "ways.geojson"),
  publicDataDir: join(root, "public", "data"),
};
