import { expect, test } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

test("offline service worker never serves the app shell as a missing module", async ({
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
  await expect(page.locator("main.screen-home")).toBeVisible();

  await context.setOffline(true);

  await page.reload();
  await expect(page.locator("main.screen-home")).toBeVisible();

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
