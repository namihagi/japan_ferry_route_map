import { expect, type Page, test } from "@playwright/test";

interface RouteDetail {
  id: string;
  name: string;
  portsOfCall: { id: string; name: string }[];
  hasEstimatedLegs: boolean;
}

interface LegFeature {
  properties: { routeId: string; geometrySource: string };
  geometry: { coordinates: [number, number][] };
}

/** 公開データから期待値を組み立てる（収録航路が増えても壊れないようにするため）。 */
async function publicData(page: Page) {
  const details: RouteDetail[] = await (await page.request.get("./data/route-details.json")).json();
  const routes: { features: LegFeature[] } = await (
    await page.request.get("./data/routes.geojson")
  ).json();
  const ports: {
    features: { properties: { portId: string }; geometry: { coordinates: [number, number] } }[];
  } = await (await page.request.get("./data/ports.geojson")).json();
  return { details, routes, ports };
}

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
  await expect(page.locator(".error-banner")).toHaveCount(0);
});

test("港をクリックすると、その港に発着する航路を選べ、選ぶと詳細が出る", async ({ page }) => {
  const { details, ports } = await publicData(page);

  // 最も多くの航路が発着する港を選ぶ（重なった線ではなく港の判定を確かめたいので、航路数が多い港が向く）
  const counts = new Map<string, RouteDetail[]>();
  for (const route of details) {
    for (const port of new Set(route.portsOfCall.map((p) => p.id))) {
      counts.set(port, [...(counts.get(port) ?? []), route]);
    }
  }
  const [portId, routesAtPort] = [...counts].sort((a, b) => b[1].length - a[1].length)[0] as [
    string,
    RouteDetail[],
  ];
  const portName = details.flatMap((route) => route.portsOfCall).find((port) => port.id === portId)
    ?.name as string;
  const coordinates = ports.features.find((f) => f.properties.portId === portId)?.geometry
    .coordinates as [number, number];

  await jumpTo(page, coordinates, 13);
  await clickAt(page, coordinates);

  const popup = page.locator(".ferry-popup");
  await expect(popup.getByRole("heading", { name: `${portName}に発着する航路` })).toBeVisible();
  await expect(popup.locator(".choice")).toHaveCount(routesAtPort.length);

  const first = routesAtPort[0] as RouteDetail;
  await popup.locator(".choice").filter({ hasText: first.name }).first().click();
  const ticket = popup.locator(".ticket");
  await expect(ticket.getByRole("heading")).toBeVisible();
  await expect(ticket.locator(".stops__port").first()).toBeVisible();
});

test("推定形状の航路をクリックすると、推定の線であることが詳細に書かれている", async ({ page }) => {
  const { details, routes } = await publicData(page);
  const estimated = routes.features.find((f) => f.properties.geometrySource === "estimated");
  if (!estimated) test.skip(true, "推定形状の区間が収録されていない");
  const leg = estimated as LegFeature;
  const route = details.find((d) => d.id === leg.properties.routeId) as RouteDetail;

  // 線の途中（港から離れた頂点）をクリックする
  const coordinates = leg.geometry.coordinates;
  const middle = coordinates[Math.floor(coordinates.length / 2)] as [number, number];

  await jumpTo(page, middle, 11);
  await clickAt(page, middle);
  const ticket = page.locator(".ferry-popup .ticket");
  await expect(ticket.getByRole("heading", { name: route.name })).toBeVisible();
  await expect(ticket).toContainText("点線の区間は推定の線");
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
