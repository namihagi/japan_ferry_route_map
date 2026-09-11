import { expect, type Page, test } from "@playwright/test";

/** 地図を指定の位置に動かし、描画が落ち着くまで待つ。 */
async function jumpTo(page: Page, center: [number, number], zoom: number) {
  await page.evaluate(
    ([lng, lat, z]) =>
      new Promise<void>((resolve) => {
        const map = window.ferryMap;
        if (!map) throw new Error("地図がない");
        map.once("idle", () => resolve());
        map.jumpTo({ center: [lng, lat], zoom: z });
      }),
    [center[0], center[1], zoom] as const,
  );
}

/** 経度緯度を画面上の座標にしてクリックする。 */
async function clickAt(page: Page, lngLat: [number, number]) {
  const point = await page.evaluate((ll) => window.ferryMap?.project(ll), lngLat);
  if (!point) throw new Error("地図がない");
  const box = await page.locator("#map").boundingBox();
  await page.mouse.click((box?.x ?? 0) + point.x, (box?.y ?? 0) + point.y);
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".panel__count")).toContainText("航路を表示しています");
});

test("港をクリックすると、その港に発着する航路を選べ、選ぶと詳細が出る", async ({ page }) => {
  const miyajima: [number, number] = [132.32225, 34.3021];
  await jumpTo(page, miyajima, 13);
  await clickAt(page, miyajima);

  const popup = page.locator(".ferry-popup");
  await expect(popup.getByRole("heading", { name: "宮島に発着する航路" })).toBeVisible();
  await expect(popup.locator(".choice")).toHaveCount(2);

  await popup.locator(".choice", { hasText: "宮島松大汽船" }).click();
  const ticket = popup.locator(".ticket");
  await expect(ticket.getByRole("heading", { name: "宮島航路" })).toBeVisible();
  await expect(ticket.locator(".stops__port")).toHaveText(["宮島口", "宮島"]);
  await expect(ticket.getByRole("link")).toHaveAttribute(
    "href",
    "https://miyajima-matsudai.co.jp/",
  );
});

test("推定形状の航路をクリックすると、推定の線であることが詳細に書かれている", async ({ page }) => {
  // 姫路～福田航路の推定形状の途中（家島諸島の南）
  const onLine: [number, number] = [134.45, 34.6];
  const routes = await (await page.request.get("./data/routes.geojson")).json();
  const leg = routes.features.find(
    (f: { properties: { routeId: string } }) =>
      f.properties.routeId === "shodoshima-ferry-himeji-fukuda",
  );
  const [a, b] = [leg.geometry.coordinates[1], leg.geometry.coordinates[2]];
  onLine[0] = (a[0] + b[0]) / 2;
  onLine[1] = (a[1] + b[1]) / 2;

  await jumpTo(page, onLine, 11);
  await clickAt(page, onLine);
  const ticket = page.locator(".ferry-popup .ticket");
  await expect(ticket.getByRole("heading", { name: "姫路～福田航路" })).toBeVisible();
  await expect(ticket).toContainText("点線の区間は推定の線");
  await expect(ticket).toContainText("所要 約1時間40分");
});

test("船種で絞り込むと、その船種の航路が地図から消える", async ({ page }) => {
  const renderedVesselTypes = () =>
    page.evaluate(() => [
      ...new Set(
        window.ferryMap
          ?.queryRenderedFeatures({ layers: ["routes-osm", "routes-estimated"] })
          .map((f) => String(f.properties.vesselType)),
      ),
    ]);
  await jumpTo(page, [136.5, 34.5], 5);
  expect(await renderedVesselTypes()).toContain("ferry");

  await page.getByRole("checkbox", { name: "フェリー" }).uncheck();
  await expect(page.locator(".panel__count")).toContainText("航路のうち");
  await expect.poll(renderedVesselTypes).not.toContain("ferry");
});
