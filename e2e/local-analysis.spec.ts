import { expect, test, type Page } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

// Whisper-tiny runs in single-threaded WASM here, so give the whole flow
// (capture, model load from the local preview server, inference) plenty of
// room. Too heavy for every push: the scheduled workflow opts in explicitly,
// while local runs can still execute this spec directly.
test.skip(
  process.env.CI !== undefined && process.env.RUN_LOCAL_ANALYSIS_E2E !== "1",
  "Inférence WASM réservée au job périodique ou à un lancement local explicite.",
);
test.setTimeout(300_000);

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

  await expect(page.locator("main.screen-home")).toBeVisible();
}

test("a recorded take is analyzed automatically on-device with whisper and VAD", async ({
  page,
}) => {
  await enterStudio(page);

  await page.locator("button.launch-button").click();
  await expect(page.locator("main.screen-permission")).toBeVisible();
  await page.getByRole("button", { name: "Démarrer la prise" }).click();
  await expect(page.locator("main.screen-karaoke")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(2_500);

  const stopButton = page.locator("button.stop-button");

  if (await stopButton.isVisible()) {
    await stopButton.click();
  }

  await expect(page.locator("main.screen-done")).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByTestId("local-analysis")).toBeVisible();

  // Automatic model load plus inference: the fake microphone tone typically yields an
  // empty transcript and little or no detected speech, which the result panel
  // must present without failing.
  const result = page.getByTestId("local-analysis-result");
  const analysisError = page.getByTestId("local-analysis").getByRole("alert");

  await Promise.race([
    result.waitFor({ state: "visible", timeout: 240_000 }),
    analysisError
      .waitFor({ state: "visible", timeout: 240_000 })
      .then(async () => {
        throw new Error(
          `Local analysis failed: ${(await analysisError.textContent()) ?? "unknown error"}`,
        );
      }),
  ]);
  await expect(page.getByTestId("local-analysis-result")).toContainText(
    "Transcript Whisper",
  );
  await expect(page.getByTestId("local-analysis-result")).toContainText(
    "Parole détectée",
  );
  await expect(page.getByTestId("local-analysis-result")).toContainText(
    "Repères acoustiques Whisper",
  );
});
