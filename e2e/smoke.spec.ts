import { expect, test } from "@playwright/test";

test("地図が表示され、国土地理院の出典が出る", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("./");

  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText("国土地理院");
  expect(errors).toEqual([]);
});
