import { expect, test } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

test("security and discovery metadata survive the production build", async ({
  page,
  request,
}) => {
  await page.goto(APP_PATH);

  await expect(
    page.locator('meta[http-equiv="Content-Security-Policy"]'),
  ).toHaveAttribute("content", /object-src 'none'/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
    "content",
    "strict-origin-when-cross-origin",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://electronicartefacts.github.io/voice-capture-studio/",
  );

  const robots = await request.get(`${APP_PATH}robots.txt`);
  const sitemap = await request.get(`${APP_PATH}sitemap.xml`);

  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toContain("/voice-capture-studio/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain(
    "https://electronicartefacts.github.io/voice-capture-studio/",
  );
});
