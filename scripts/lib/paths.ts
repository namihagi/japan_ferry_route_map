import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");

export const paths = {
  dataDir: join(root, "data"),
  osmSnapshot: join(root, "data", "osm", "ways.geojson"),
  estimatedDir: join(root, "data", "estimated"),
  publicDataDir: join(root, "public", "data"),
};
