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

  await expect(page.locator(".ritual-button")).toHaveCSS(
    "touch-action",
    "manipulation",
  );
  await expect(page.locator(".opening-ritual")).toHaveCSS("min-height", /px$/);
  await expect(page.locator(".system-health-header strong")).toContainText(
    /\d+\/100/,
  );
});
