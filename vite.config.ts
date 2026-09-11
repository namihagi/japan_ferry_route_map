import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages のプロジェクトサイトとして https://namihagi.github.io/japan_ferry_route_map/ に置く
  base: "/japan_ferry_route_map/",
  build: {
    // MapLibre GL JS だけで約1MBあるため、既定の500kBでは毎回警告が出る
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
