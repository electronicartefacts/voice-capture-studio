import { expect, test, type Page } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

async function enterStudio(page: Page): Promise<void> {
  await page.goto(APP_PATH);
  const ritualButton = page.getByRole("button", {
    name: /Activer le microphone/,
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

async function openQualityPage(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Qualité et exports" }).click();
  await expect(page.locator("main.screen-technical")).toBeVisible();
}

test("a complete workspace archive restores its WAV after browser storage is cleared", async ({
  page,
}) => {
  await enterStudio(page);
  await page.locator("button.launch-button").click();
  await page.getByRole("button", { name: "Démarrer la prise" }).click();
  await expect(page.locator("main.screen-karaoke")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  const stopButton = page.locator("button.stop-button");
  if (await stopButton.isVisible()) {
    await stopButton.click();
  }
  await expect(page.locator("main.screen-done")).toBeVisible({
    timeout: 30_000,
  });

  await openQualityPage(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter l'archive" }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();

  expect(archivePath).not.toBeNull();
  await expect(page.getByTestId("workspace-archive")).toContainText(
    "Archive prête : 1 WAV vérifié.",
  );

  await page.evaluate(async () => {
    window.localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("voice-capture-studio");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB deletion blocked"));
    });
  });

  await enterStudio(page);
  await openQualityPage(page);
  await page.getByTestId("workspace-archive-input").setInputFiles(archivePath!);
  await expect(page.getByTestId("workspace-archive")).toContainText(
    "Workspace restauré avec 1 WAV vérifié.",
  );

  await enterStudio(page);
  await openQualityPage(page);
  await expect(page.locator(".recordings-list-header")).toContainText("1 WAV");
});

test("workspace archive controls stay usable on a narrow mobile surface", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await enterStudio(page);
  await openQualityPage(page);

  await expect(page.getByTestId("workspace-archive")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Restaurer une archive" }),
  ).toBeVisible();
});
