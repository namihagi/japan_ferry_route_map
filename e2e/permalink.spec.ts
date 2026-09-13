import { expect, type Page, test } from "@playwright/test";

interface RouteDetail {
  id: string;
  name: string;
  bounds: [number, number, number, number];
}

async function firstRoute(page: Page): Promise<RouteDetail> {
  const details: RouteDetail[] = await (await page.request.get("./data/route-details.json")).json();
  const route = details[0];
  if (!route) throw new Error("公開されている航路がない");
  return route;
}

/** `#map=<zoom>/<lat>/<lon>&route=<id>` を読む。 */
function parseHash(url: string): { zoom?: number; lat?: number; lon?: number; route?: string } {
  const hash = new URL(url).hash.replace(/^#/, "");
  const parts = new Map(hash.split("&").map((p) => p.split("=") as [string, string]));
  const [zoom, lat, lon] = (parts.get("map") ?? "").split("/").map(Number);
  return { zoom, lat, lon, route: parts.get("route") };
}

test("地図を動かすと URL に表示位置が入る", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".panel__count")).toContainText("航路を表示しています");

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = window.ferryMap;
        if (!map) throw new Error("地図がない");
        map.once("moveend", () => resolve());
        map.jumpTo({ center: [132.31, 34.3], zoom: 12 });
      }),
  );

  await expect.poll(async () => parseHash(page.url()).zoom).toBeCloseTo(12, 1);
  const { lat, lon } = parseHash(page.url());
  expect(lon).toBeCloseTo(132.31, 2);
  expect(lat).toBeCloseTo(34.3, 2);
});

test("航路を選ぶと URL に航路が入り、その URL を開き直すと同じ航路の詳細が出る", async ({
  page,
}) => {
  const route = await firstRoute(page);

  await page.goto(`./#route=${route.id}`);
  const ticket = page.locator(".ferry-popup .ticket");
  await expect(ticket.getByRole("heading", { name: route.name })).toBeVisible();

  // 航路に地図が寄っている（航路の範囲の中心が画面に入っている）
  const [west, south, east, north] = route.bounds;
  const center = await page.evaluate(() => window.ferryMap?.getCenter());
  expect(center?.lng).toBeGreaterThanOrEqual(west - 1);
  expect(center?.lng).toBeLessThanOrEqual(east + 1);
  expect(center?.lat).toBeGreaterThanOrEqual(south - 1);
  expect(center?.lat).toBeLessThanOrEqual(north + 1);

  // URL には表示位置も書き足されている
  await expect.poll(() => parseHash(page.url()).route).toBe(route.id);
  expect(parseHash(page.url()).zoom).toBeGreaterThan(0);

  // 詳細を閉じると URL から航路が消える
  await page.locator(".ferry-popup .maplibregl-popup-close-button").click();
  await expect.poll(() => parseHash(page.url()).route).toBeUndefined();
});

test("壊れた URL でも地図は出る", async ({ page }) => {
  await page.goto("./#map=abc&route=%3Cscript%3E");
  await expect(page.locator(".panel__count")).toContainText("航路を表示しています");
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await expect(page.locator(".ferry-popup")).toHaveCount(0);
});
