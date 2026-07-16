import { expect, test, type Page } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

async function enterStudio(page: Page) {
  const ritualButton = page.getByRole("button", {
    name: /Activer le microphone|Revalider l’appareil/,
  });

  if (await ritualButton.isVisible()) {
    await ritualButton.click();
  }

  await expect(page.locator("main.is-awake")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("surface profiles", () => {
  test("uses Focus in mobile portrait", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(APP_PATH);

    await expect(page.locator("main.surface-mobile-focus")).toBeVisible();
  });

  test("uses Dashboard in tablet portrait", async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1194 });
    await page.goto(APP_PATH);

    await expect(page.locator("main.surface-tablet-dashboard")).toBeVisible();
  });

  test("keeps a compact Dashboard on a small tablet", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(APP_PATH);

    await expect(page.locator("main.surface-tablet-dashboard")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  });

  test("uses Lab on a tablet in landscape", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(APP_PATH);

    await expect(page.locator("main.surface-tablet-lab")).toBeVisible();
  });

  test("uses Lab compact in mobile landscape", async ({ page }) => {
    await page.setViewportSize({ width: 852, height: 393 });
    await page.goto(APP_PATH);
    await enterStudio(page);

    await expect(
      page.locator("main.surface-mobile-landscape-lab"),
    ).toBeVisible();
    await expect(page.locator(".header-mode-navigation")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  });

  test("uses Lab complet on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(APP_PATH);

    await expect(page.locator("main.surface-desktop-lab")).toBeVisible();
  });

  test("reprojects the same session when the phone rotates", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(APP_PATH);
    await enterStudio(page);

    await expect(page.locator("main.surface-mobile-focus")).toBeVisible();
    await expect(page.locator(".header-mode-navigation")).toBeVisible();

    await page.setViewportSize({ width: 852, height: 393 });
    await expect(
      page.locator("main.surface-mobile-landscape-lab"),
    ).toBeVisible();
    await expect(page.locator(".header-mode-navigation")).toBeVisible();

    await page.setViewportSize({ width: 393, height: 852 });
    await expect(page.locator("main.surface-mobile-focus")).toBeVisible();
    await expect(page.locator(".header-mode-navigation")).toBeVisible();
  });
});
