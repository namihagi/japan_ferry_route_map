import { describe, expect, it } from "vitest";
import { createBaseStyle } from "./baseStyle.ts";

describe("createBaseStyle", () => {
  it("背景に地理院タイルの淡色地図を使い、国土地理院の出典を表示する", () => {
    const source = createBaseStyle().sources["gsi-pale"];

    expect(source?.type).toBe("raster");
    if (source?.type !== "raster") return;
    expect(source.tiles).toEqual(["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"]);
    expect(source.attribution).toContain("国土地理院");
  });
});
