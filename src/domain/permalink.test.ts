import { describe, expect, it } from "vitest";
import { formatPermalink, parsePermalink } from "./permalink.ts";

describe("parsePermalink", () => {
  it("表示位置と航路を読む", () => {
    expect(parsePermalink("#map=11.50/34.35270/134.05430&route=jr-miyajima-ferry")).toEqual({
      view: { zoom: 11.5, lat: 34.3527, lon: 134.0543 },
      routeId: "jr-miyajima-ferry",
    });
  });

  it("先頭の # がなくても読む", () => {
    expect(parsePermalink("map=5.00/35.00000/135.00000").view).toEqual({
      zoom: 5,
      lat: 35,
      lon: 135,
    });
  });

  it("ハッシュがなければ何も返さない", () => {
    expect(parsePermalink("")).toEqual({});
    expect(parsePermalink("#")).toEqual({});
  });

  it("読めない表示位置は捨てて、読める分だけ返す", () => {
    expect(parsePermalink("#map=abc&route=oki-kisen-ferry")).toEqual({
      routeId: "oki-kisen-ferry",
    });
    expect(parsePermalink("#map=11/34.3")).toEqual({});
  });

  it("地球の外の座標は捨てる", () => {
    expect(parsePermalink("#map=11.00/95.00000/134.00000")).toEqual({});
    expect(parsePermalink("#map=11.00/34.00000/200.00000")).toEqual({});
  });

  it("航路 ID の形をしていない値は捨てる（URL から流し込まれるため）", () => {
    expect(parsePermalink("#route=<script>")).toEqual({});
    expect(parsePermalink("#route=Foo_Bar")).toEqual({});
  });

  it("知らないキーは無視する", () => {
    expect(parsePermalink("#zoom=3&route=sanwa-ferry")).toEqual({ routeId: "sanwa-ferry" });
  });
});

describe("formatPermalink", () => {
  it("表示位置と航路をハッシュにする", () => {
    expect(
      formatPermalink({
        view: { zoom: 11.5, lat: 34.3527, lon: 134.0543 },
        routeId: "jr-miyajima-ferry",
      }),
    ).toBe("#map=11.50/34.35270/134.05430&route=jr-miyajima-ferry");
  });

  it("航路を選んでいなければ表示位置だけ", () => {
    expect(formatPermalink({ view: { zoom: 6, lat: 35, lon: 135 } })).toBe(
      "#map=6.00/35.00000/135.00000",
    );
  });

  it("何もなければ空文字列", () => {
    expect(formatPermalink({})).toBe("");
  });

  it("書いたものをそのまま読み戻せる", () => {
    const state = { view: { zoom: 9.25, lat: 33.45821, lon: 132.4151 }, routeId: "sanwa-ferry" };
    expect(parsePermalink(formatPermalink(state))).toEqual(state);
  });
});
