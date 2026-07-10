import { defineConfig, devices } from "@playwright/test";

const PREVIEW_URL = "http://127.0.0.1:4173/voice-capture-studio/";

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
  ],
  webServer: {
    command: "npm run serve",
    url: PREVIEW_URL,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 180_000,
  },
});
