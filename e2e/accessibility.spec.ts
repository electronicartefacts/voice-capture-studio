import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

async function enterStudio(page: Page) {
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

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );

  expect(
    violations,
    violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`,
      )
      .join("\n"),
  ).toEqual([]);
}

test("opening ritual meets the automated WCAG A and AA baseline", async ({
  page,
}) => {
  await page.goto(APP_PATH);

  await expect(page.locator(".opening-ritual")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("active studio meets the automated WCAG A and AA baseline", async ({
  page,
}) => {
  await enterStudio(page);

  await expect(page.locator("main.screen-home")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("quality and archive controls meet the automated WCAG A and AA baseline", async ({
  page,
}) => {
  await enterStudio(page);
  await page.getByRole("button", { name: "Qualité et exports" }).click();

  await expect(page.getByTestId("workspace-archive")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});
