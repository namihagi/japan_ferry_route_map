import { expect, test } from "@playwright/test";

test("地図が表示され、国土地理院と OpenStreetMap の出典が出る", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("./");

  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  const attribution = page.locator(".maplibregl-ctrl-attrib");
  await expect(attribution).toContainText("国土地理院");
  await expect(attribution).toContainText("OpenStreetMap contributors");
  expect(errors).toEqual([]);
});
