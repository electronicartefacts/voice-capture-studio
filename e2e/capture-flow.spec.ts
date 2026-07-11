import { expect, test, type Page } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

async function enterStudio(page: Page): Promise<void> {
  await page.goto(APP_PATH);

  // The opening ritual auto-skips when microphone permission is already
  // granted, so the studio may already be awake by the time we look.
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

  await expect(page.locator("main.screen-home")).toBeVisible();
}

test("studio boots to the home screen with recording available", async ({
  page,
}) => {
  await enterStudio(page);

  const launchButton = page.locator("button.launch-button");

  await expect(launchButton).toBeEnabled();
  await expect(launchButton).toContainText(/Lancer/);
});

test("a guided take flows from launch to the review screen", async ({
  page,
}) => {
  await page.setViewportSize({ height: 998, width: 350 });
  await page.emulateMedia({ colorScheme: "dark" });
  await enterStudio(page);

  await page.locator("button.launch-button").click();
  await expect(page.locator("main.screen-permission")).toBeVisible();
  await expect(page.locator("main.screen-permission h1")).toBeFocused();

  await page.getByRole("button", { name: "Démarrer la prise" }).click();

  // Room tone calibration runs for three seconds before the karaoke screen.
  await expect(page.locator("main.screen-karaoke")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByLabel("Phonèmes du mot actif")).toHaveCount(0);
  await expect(page.locator(".karaoke-char")).not.toHaveCount(0);
  await expect(page.locator(".karaoke-word.is-current")).toHaveCount(1);
  await expect(page.locator(".karaoke-word.is-next")).toHaveCount(1);
  await expect(
    page.locator("main.screen-karaoke .speech-follow-line"),
  ).toHaveCount(0);
  await expect(page.locator("main.screen-karaoke .read-progress")).toHaveCount(
    0,
  );

  const firstCharacter = page.locator(".karaoke-char").first();
  await expect
    .poll(() => firstCharacter.evaluate((node) => node.style.length))
    .toBeGreaterThan(0);

  // Let the fake microphone feed a couple of seconds of signal.
  await page.waitForTimeout(2_500);

  const stopButton = page.locator("button.stop-button");

  if (await stopButton.isVisible()) {
    await stopButton.click();
  }

  await expect(page.locator("main.screen-done")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Phrase 1 sur \d+/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Écoute de la prise" }),
  ).toBeVisible();
  await expect(page.getByText("Moniteur de prise")).toBeVisible();
  await expect(page.getByLabel("Temps de lecture")).toBeVisible();
  await expect(page.getByRole("button", { name: "Écouter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Début" })).toBeVisible();
  await expect(page.locator("label.loop-toggle")).toBeVisible();
  const loopToggle = page.getByRole("checkbox", { name: "Boucle" });

  await expect(loopToggle).not.toBeChecked();
  await page.locator("label.loop-toggle").click();
  await expect(loopToggle).toBeChecked();
  await expect(page.getByLabel("Section de boucle")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.locator(".listening-review").evaluate((element) => {
        const bounds = element.getBoundingClientRect();

        return bounds.left >= 0 && bounds.right <= window.innerWidth;
      }),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.locator(".file-receipt").evaluate((receipt) => {
        const footer = document.querySelector(".site-footer");

        return (
          footer !== null &&
          footer.getBoundingClientRect().top >=
            receipt.getBoundingClientRect().bottom - 1
        );
      }),
    )
    .toBe(true);
});

test("free capture removes unavailable controls and false reading progress", async ({
  page,
}) => {
  await enterStudio(page);

  await page.getByRole("button", { name: /Capture libre/ }).click();
  await page.locator("button.launch-button").click();
  await expect(page.locator("main.screen-permission")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Écouter la référence" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Démarrer la prise" }).click();
  await expect(page.locator("main.screen-karaoke")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".read-progress")).toHaveCount(0);
});

test("workspace progress survives a reload through IndexedDB", async ({
  page,
}) => {
  await enterStudio(page);

  const readWorkspaceFromIndexedDb = () =>
    page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const request = indexedDB.open("voice-capture-studio");

          request.onerror = () => resolve(false);
          request.onsuccess = () => {
            const database = request.result;

            if (!database.objectStoreNames.contains("workspace")) {
              database.close();
              resolve(false);
              return;
            }

            const read = database
              .transaction("workspace", "readonly")
              .objectStore("workspace")
              .get("voice-capture-studio.workspace.v1");

            read.onerror = () => {
              database.close();
              resolve(false);
            };
            read.onsuccess = () => {
              database.close();
              resolve(
                read.result !== undefined &&
                  typeof read.result.workspaceId === "string",
              );
            };
          };
        }),
    );

  await expect.poll(readWorkspaceFromIndexedDb, { timeout: 15_000 }).toBe(true);

  await page.reload();
  await expect(page.locator("main.is-awake")).toBeVisible({
    timeout: 30_000,
  });
  await expect(await readWorkspaceFromIndexedDb()).toBe(true);
});
