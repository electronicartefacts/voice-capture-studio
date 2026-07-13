import { expect, test, type Page } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

async function enterStudio(page: Page): Promise<void> {
  await page.goto(APP_PATH);

  const ritualButton = page.getByRole("button", {
    name: /Activer le microphone|Revalider l’appareil/,
  });

  await expect(async () => {
    if (await ritualButton.isVisible()) {
      await ritualButton.click({ timeout: 1_000 }).catch(() => undefined);
    }

    await expect(page.locator("main.is-awake")).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 30_000 });
}

test("mobile home stays usable after microphone activation and a long scroll", async ({
  page,
}) => {
  await enterStudio(page);

  const launchButton = page.locator("button.launch-button");

  await expect(launchButton).toBeEnabled();
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight }),
  );
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);

  await expect(launchButton).toBeVisible();
  await expect(page.locator("main.screen-home")).toBeVisible();
  await expect(page.locator(".voice-wave-canvas")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});
