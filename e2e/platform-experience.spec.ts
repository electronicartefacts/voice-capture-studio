import { expect, test } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 393, height: 852 },
});

test("platform shell exposes a keyboard-safe viewport and touch-safe controls", async ({
  page,
}) => {
  await page.goto(APP_PATH);

  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue(
          "--app-viewport-height",
        ),
      ),
    )
    .not.toBe("");

  // Permission can already be granted in CI, in which case onboarding is
  // skipped before the assertion. Both entry controls must expose the same
  // coarse-pointer behavior.
  await expect(
    page.locator(".ritual-button, button.launch-button").first(),
  ).toHaveCSS("touch-action", "manipulation");
  await expect(page.locator("main.simple-app")).toHaveCSS("min-height", /px$/);
});
