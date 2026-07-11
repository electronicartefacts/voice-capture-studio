import { expect, test } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

for (const [name, viewport, surface] of [
  ["mobile portrait", { width: 393, height: 852 }, "mobile-focus"],
  ["compact mobile portrait", { width: 320, height: 568 }, "mobile-focus"],
  ["mobile landscape", { width: 852, height: 393 }, "mobile-landscape-lab"],
  [
    "compact mobile landscape",
    { width: 667, height: 375 },
    "mobile-landscape-lab",
  ],
  ["tablet portrait", { width: 834, height: 1194 }, "tablet-dashboard"],
  ["tablet landscape", { width: 1024, height: 768 }, "tablet-lab"],
  ["desktop", { width: 1440, height: 900 }, "desktop-lab"],
] as const) {
  test(`keeps the ${name} surface within the viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(APP_PATH);

    await expect(page.locator(`main.surface-${surface}`)).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  });
}
