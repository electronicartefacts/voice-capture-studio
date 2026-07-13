import { expect, test, type Page } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

const VIEWPORTS = [
  ["compact phone portrait", { width: 320, height: 568 }],
  ["phone portrait", { width: 393, height: 852 }],
  ["compact phone landscape", { width: 667, height: 375 }],
  ["phone landscape", { width: 852, height: 393 }],
  ["compact tablet portrait", { width: 768, height: 1024 }],
  ["tablet portrait", { width: 834, height: 1194 }],
  ["tablet landscape", { width: 1024, height: 768 }],
  ["desktop", { width: 1440, height: 900 }],
] as const;

async function enterStudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto(APP_PATH);

  const ritualButton = page.getByRole("button", {
    name: /Activer le microphone/,
  });

  if (await ritualButton.isVisible()) {
    await ritualButton.click();
  }

  await expect(page.locator("main.is-awake")).toBeVisible({ timeout: 30_000 });
}

async function expectSinglePageScroll(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    horizontalOverflow:
      document.documentElement.scrollWidth > window.innerWidth + 1,
    nestedScrollboxes: [...document.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight + 1
        );
      })
      .map((element) => element.className)
      .filter(
        (className): className is string => typeof className === "string",
      ),
  }));

  expect(layout.horizontalOverflow).toBe(false);
  expect(layout.nestedScrollboxes).toEqual([]);
}

for (const [name, viewport] of VIEWPORTS) {
  test(`uses the full ${name} surface without panel scrollboxes`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await enterStudio(page);

    for (const mode of [
      "Capture libre",
      "Dataset ML",
      "Doublage",
      "Interprétation",
    ]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      await expect(page.locator(".home-card")).toBeVisible();
      await expectSinglePageScroll(page);
    }

    await page.getByRole("button", { name: "Qualité et exports" }).click();
    await expect(page.locator(".technical-page")).toBeVisible();
    await expectSinglePageScroll(page);
  });
}

test("reflows capture and review when the phone rotates", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await enterStudio(page);
  await page
    .getByRole("button", { name: "Capture libre", exact: true })
    .click();
  await page.getByRole("button", { name: "Démarrer la capture" }).click();

  await expect(page.locator(".karaoke-screen")).toBeVisible();
  await page.setViewportSize({ width: 852, height: 393 });
  await expect(page.locator("main.surface-mobile-landscape-lab")).toBeVisible();
  await expectSinglePageScroll(page);

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.locator(".listening-review")).toBeVisible({
    timeout: 30_000,
  });
  await expectSinglePageScroll(page);

  await page.setViewportSize({ width: 834, height: 1194 });
  await expect(page.locator("main.surface-tablet-dashboard")).toBeVisible();
  await expectSinglePageScroll(page);
});

test("keeps guided preparation and calibration fluid on tablet landscape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterStudio(page);
  await page.getByRole("button", { name: "Dataset ML", exact: true }).click();
  await page.getByRole("button", { name: "Créer le dataset" }).click();

  await expect(page.locator(".director-panel")).toBeVisible();
  await expectSinglePageScroll(page);

  await page.getByRole("button", { name: "Démarrer la prise" }).click();
  await expect(page.locator(".room-tone-screen")).toBeVisible();
  await expectSinglePageScroll(page);
});
