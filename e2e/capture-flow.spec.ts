import { expect, test, type Page } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

async function enterStudio(page: Page): Promise<void> {
  await page.goto(APP_PATH);

  // The opening ritual auto-skips when microphone permission is already
  // granted, so the studio may already be awake by the time we look.
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

  await expect(page.locator("main.screen-home")).toBeVisible();
  await expect(page.getByTestId("active-mode-label")).toContainText(
    "Dataset ML · Corpus intégré",
  );
}

test("studio boots to the home screen with recording available", async ({
  page,
}) => {
  await enterStudio(page);

  const launchButton = page.locator("button.launch-button");

  await expect(launchButton).toBeEnabled();
  await expect(launchButton).toContainText("Créer le dataset");
});

test("leaving the page cuts the microphone and requires device revalidation", async ({
  page,
}) => {
  await enterStudio(page);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(page.locator("main.is-ritual")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Revalider l’appareil" }),
  ).toBeVisible();
  await expect(
    page.getByText("Le microphone a été coupé lorsque tu as quitté la page."),
  ).toBeVisible();

  await page.reload();

  await expect(page.locator("main.is-ritual")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Revalider l’appareil" }),
  ).toBeVisible();
});

test("ML session tracking and export storage have distinct home regions", async ({
  page,
}) => {
  await page.setViewportSize({ height: 939, width: 428 });
  await enterStudio(page);

  const workbench = page.getByRole("region", {
    name: "Réglages de la session",
  });
  const dashboard = page.getByLabel("Suivi de session ML");
  const storage = page.getByRole("region", { name: "Export et stockage" });

  await expect(dashboard).toBeVisible();
  await expect(storage).toBeVisible();
  await expect(page.getByText("Calibration requise")).toBeVisible();
  await expect(storage.getByText(/Sans dossier local/)).toBeVisible();
  await expect
    .poll(() =>
      workbench.evaluate((element) => {
        const dashboardElement = element.querySelector(".ml-session-dashboard");
        const statusElement = element.querySelector(".status-strip");

        return (
          dashboardElement !== null &&
          statusElement !== null &&
          Boolean(
            dashboardElement.compareDocumentPosition(statusElement) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          )
        );
      }),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Sauvegarde locale" }).click();
  await expect(storage).toBeFocused();

  await page.getByRole("button", { name: /Capture libre/ }).click();
  await expect(page.getByTestId("active-mode-label")).toContainText(
    "Capture libre · Sans corpus",
  );
  await expect(page.getByLabel("Suivi de session ML")).toHaveCount(0);
  await expect(storage).toBeVisible();
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
  const playbackButton = page.getByRole("button", { name: "Écouter" });
  const restartButton = page.getByRole("button", {
    name: "Recommencer la lecture",
  });
  const loopButton = page.getByRole("button", { name: "Lire en boucle" });

  await expect(playbackButton).toBeVisible();
  await expect(restartButton).toBeVisible();
  await expect(page.getByRole("button", { name: "Début" })).toHaveCount(0);
  await expect(loopButton).toHaveAttribute("aria-pressed", "false");
  await loopButton.click();
  await expect(loopButton).toHaveAttribute("aria-pressed", "true");
  await playbackButton.click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(playbackButton).toBeVisible();
  await expect(page.locator(".review-waveform-svg")).toBeVisible();
  await expect(page.locator(".review-transcript")).toHaveCount(1);

  const reviewWaveform = page.locator(".playback-waveform");
  await expect(reviewWaveform).toHaveCSS("touch-action", "none");
  const waveformBounds = await reviewWaveform.boundingBox();
  expect(waveformBounds).not.toBeNull();
  if (waveformBounds !== null) {
    const centerY = waveformBounds.y + waveformBounds.height / 2;
    await page.mouse.move(
      waveformBounds.x + waveformBounds.width * 0.2,
      centerY,
    );
    await page.mouse.down();
    await expect(reviewWaveform).toHaveClass(/is-scrubbing/);
    await page.mouse.move(
      waveformBounds.x + waveformBounds.width * 0.75,
      centerY,
      {
        steps: 4,
      },
    );
    await expect(reviewWaveform).toHaveAttribute(
      "aria-valuenow",
      /^(7[0-9]|8[0-2])$/,
    );
    await page.mouse.up();
    await expect(reviewWaveform).not.toHaveClass(/is-scrubbing/);
  }

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 393, height: 852 },
    { width: 852, height: 393 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.locator(".playback-waveform").evaluate((element) => {
          const bounds = element.getBoundingClientRect();

          return bounds.left >= 0 && bounds.right <= window.innerWidth;
        }),
      )
      .toBe(true);
  }
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

test("free capture removes unavailable controls and can replay the finished recording", async ({
  page,
}) => {
  await enterStudio(page);

  await page.getByRole("button", { name: /Capture libre/ }).click();
  await page.locator("button.launch-button").click();
  await expect(page.locator("main.screen-permission")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Écouter la référence" }),
  ).toHaveCount(0);

  await expect(page.locator("main.screen-karaoke")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".read-progress")).toHaveCount(0);
  await expect(page.locator(".free-capture-line")).toBeAttached();
  await expect(page.locator(".free-capture-line")).toHaveAttribute(
    "aria-label",
    "En attente de mots reconnus",
  );
  await expect(page.locator(".free-capture-line")).toBeEmpty();
  await expect(page.getByText("Le studio enregistre.")).toHaveCount(0);
  await expect(page.locator(".free-capture-guidance p")).toBeVisible();
  await expect(page.locator(".free-capture-guidance small")).toBeVisible();
  await expect(page.locator(".speech-follow-line")).toHaveCount(0);
  await expect(page.locator(".recording-assist")).toHaveCount(0);

  await page.waitForTimeout(1_000);
  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.locator("main.screen-done")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("region", { name: "Écoute de la prise" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Capture LIBRE", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Écouter" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Recommencer la lecture" }),
  ).toBeEnabled();
  await expect(
    page.getByLabel("Transcription de la capture libre"),
  ).toBeVisible();
});

test("dubbing connects a YouTube scene to the scripted recording surface", async ({
  page,
}) => {
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.abort(),
  );
  await enterStudio(page);

  await page.getByRole("button", { name: "Doublage" }).click();
  await page
    .getByLabel("Texte du corpus local")
    .fill(
      [
        "00:00:42,000 --> 00:00:46,000",
        "On y va maintenant.",
        "",
        "00:00:48,000 --> 00:00:51,000",
        "Je te suis.",
      ].join("\n"),
    );
  await page
    .getByPlaceholder("Coller un lien YouTube")
    .fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Relier" }).click();

  const homeFrame = page.locator(
    '.dubbing-media-stage[data-media-kind="youtube"] iframe',
  );

  await expect(homeFrame).toHaveAttribute("src", /youtube-nocookie\.com/);
  await expect(homeFrame).toHaveAttribute("src", /autoplay=0/);
  await page.locator("button.launch-button").click();
  await expect(page.locator("main.screen-permission")).toBeVisible();
  await expect(
    page.getByText("On y va maintenant.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0:42 → 0:46")).toBeVisible();

  await page.getByRole("button", { name: "Démarrer la prise" }).click();
  await expect(page.locator("main.screen-karaoke")).toBeVisible({
    timeout: 30_000,
  });
  const captureFrame = page.locator(
    "main.screen-karaoke .dubbing-media-stage iframe",
  );

  await expect(captureFrame).toHaveAttribute("src", /autoplay=1/);
  await expect(captureFrame).toHaveAttribute("src", /start=42/);
  await expect(page.getByText("REC · Doublage image")).toBeVisible();
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

  await enterStudio(page);
  await expect(await readWorkspaceFromIndexedDb()).toBe(true);
});
