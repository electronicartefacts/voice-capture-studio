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
    await expect(page.locator("main.is-awake")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}

test("automatic sensitivity is the safe default and manual mode persists", async ({
  page,
}) => {
  await enterStudio(page);
  await page.getByRole("button", { name: "Qualité et exports" }).click();

  const auto = page.getByRole("button", { name: "Auto", exact: true });
  const manual = page.getByRole("button", { name: "Manuel", exact: true });
  const sensitivity = page.getByRole("slider", {
    name: "Sensibilité logicielle du micro",
  });

  await expect(auto).toHaveAttribute("aria-pressed", "true");
  await expect(sensitivity).toBeDisabled();
  await manual.click();
  await expect(manual).toHaveAttribute("aria-pressed", "true");
  await expect(sensitivity).toBeEnabled();
  await sensitivity.fill("2.25");

  await page.reload();
  await expect(page.locator("main.is-awake")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Qualité et exports" }).click();
  await expect(manual).toHaveAttribute("aria-pressed", "true");
  await expect(sensitivity).toHaveValue("2.25");
});
