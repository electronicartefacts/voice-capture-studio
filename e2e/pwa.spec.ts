import { expect, test, type Page } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

async function revalidateStudio(page: Page): Promise<void> {
  const revalidationButton = page.getByRole("button", {
    name: /Activer le microphone|Revalider l’appareil/,
  });

  if (await revalidationButton.isVisible()) {
    await revalidationButton.click();
  }

  await expect(page.locator("main.is-awake")).toBeVisible({
    timeout: 30_000,
  });
}

test("offline service worker restarts the app without masking missing modules", async ({
  page,
  context,
}) => {
  await page.goto(APP_PATH);
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });

  // Reload once under service-worker control so the app shell and its module
  // graph have both passed through the runtime cache before the offline boot.
  await page.reload();
  await revalidateStudio(page);

  await page.getByRole("button", { name: "Doublage" }).click();
  await expect
    .poll(() =>
      page
        .locator(".youtube-source-form")
        .evaluate((element) => getComputedStyle(element).display),
    )
    .toBe("grid");

  await context.setOffline(true);

  await page.reload();
  await revalidateStudio(page);
  await page.getByRole("button", { name: "Doublage" }).click();
  await expect
    .poll(() =>
      page
        .locator(".youtube-source-form")
        .evaluate((element) => getComputedStyle(element).display),
    )
    .toBe("grid");

  const assetResult = await page.evaluate(async () => {
    try {
      const response = await fetch("assets/offline-module.js");

      return {
        contentType: response.headers.get("content-type"),
        status: response.status,
      };
    } catch {
      return null;
    }
  });

  expect(assetResult).toBeNull();
});
