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

  await context.setOffline(true);

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
