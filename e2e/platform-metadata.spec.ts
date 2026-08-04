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

  const structuredApplication = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ??
      "null",
  ) as Record<string, unknown>;
  expect(structuredApplication).toMatchObject({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    isAccessibleForFree: true,
    name: "Voice Capture Studio",
    url: "https://electronicartefacts.github.io/voice-capture-studio/",
  });

  const robots = await request.get(`${APP_PATH}robots.txt`);
  const sitemap = await request.get(`${APP_PATH}sitemap.xml`);
  const manifestResponse = await request.get(`${APP_PATH}manifest.webmanifest`);

  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toContain("/voice-capture-studio/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain(
    "https://electronicartefacts.github.io/voice-capture-studio/",
  );
  expect(manifestResponse.ok()).toBe(true);

  const manifest = (await manifestResponse.json()) as {
    readonly screenshots?: readonly {
      readonly form_factor?: string;
      readonly sizes?: string;
      readonly src?: string;
      readonly type?: string;
    }[];
  };
  expect(manifest.screenshots).toEqual([
    {
      form_factor: "wide",
      label: "Atelier local de découpe lexicale",
      sizes: "1280x720",
      src: "screenshots/studio-wide.png",
      type: "image/png",
    },
    {
      form_factor: "narrow",
      label: "Atelier local de découpe lexicale sur mobile",
      sizes: "390x844",
      src: "screenshots/studio-narrow.png",
      type: "image/png",
    },
  ]);

  for (const screenshot of manifest.screenshots ?? []) {
    const response = await request.get(`${APP_PATH}${screenshot.src}`);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
});
