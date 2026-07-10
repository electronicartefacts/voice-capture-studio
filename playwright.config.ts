import { defineConfig, devices } from "@playwright/test";

const PREVIEW_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  "http://127.0.0.1:4173/voice-capture-studio/";
const localPreviewServer =
  process.env.PLAYWRIGHT_BASE_URL === undefined
    ? {
        command: "npm run serve",
        url: PREVIEW_URL,
        reuseExistingServer: process.env.CI === undefined,
        timeout: 180_000,
      }
    : undefined;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : "github",
  use: {
    baseURL: PREVIEW_URL,
    permissions: ["microphone"],
    // The PWA service worker must not serve a stale build between runs.
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: ["e2e/mobile-scroll.spec.ts", "e2e/pwa.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
    {
      name: "chromium-mobile",
      testMatch: "e2e/mobile-scroll.spec.ts",
      use: {
        ...devices["Pixel 5"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
    {
      name: "chromium-pwa",
      testMatch: "e2e/pwa.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        serviceWorkers: "allow",
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
  ],
  webServer: localPreviewServer,
});
