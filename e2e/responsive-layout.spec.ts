import { expect, test, type Page } from "@playwright/test";

const APP_PATH = "/voice-capture-studio/";

const VIEWPORTS = [
  ["compact phone portrait", { width: 320, height: 568 }],
  ["phone portrait", { width: 393, height: 852 }],
  ["compact phone landscape", { width: 667, height: 375 }],
  ["phone landscape", { width: 852, height: 393 }],
  ["compact tablet portrait", { width: 768, height: 1024 }],
  ["tablet portrait", { width: 834, height: 1194 }],
  ["tablet landscape", { width: 1024, height: 768 }],
  ["desktop", { width: 1440, height: 900 }],
] as const;

async function enterStudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto(APP_PATH);

  const ritualButton = page.getByRole("button", {
    name: /Activer le microphone|Revalider l’appareil/,
  });

  if (await ritualButton.isVisible()) {
    await ritualButton.click();
  }

  await expect(page.locator("main.is-awake")).toBeVisible({ timeout: 30_000 });
}

async function expectSinglePageScroll(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    horizontalOverflow:
      document.documentElement.scrollWidth > window.innerWidth + 1,
    nestedScrollboxes: [...document.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight + 1
        );
      })
      .map((element) => element.className)
      .filter(
        (className): className is string => typeof className === "string",
      ),
  }));

  expect(layout.horizontalOverflow).toBe(false);
  expect(layout.nestedScrollboxes).toEqual([]);
}

for (const [name, viewport] of VIEWPORTS) {
  test(`uses the full ${name} surface without panel scrollboxes`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await enterStudio(page);

    for (const mode of [
      "Capture libre",
      "Découpe lexicale",
      "Dataset ML",
      "Doublage",
      "Interprétation",
    ]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      await expect(page.locator(".home-card")).toBeVisible();
      await expectSinglePageScroll(page);
    }

    await page.getByRole("button", { name: "Qualité et exports" }).click();
    await expect(page.locator(".technical-page")).toBeVisible();
    await expectSinglePageScroll(page);
  });
}

test("stacks a full-width glass laboratory below the desktop header", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterStudio(page);

  const layout = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".simple-header");
    const modes = document.querySelector<HTMLElement>(
      ".simple-header .mode-dial",
    );
    const launcher = document.querySelector<HTMLElement>(".lab-launcher");
    const overview = document.querySelector<HTMLElement>(".lab-overview-card");

    if (
      header === null ||
      modes === null ||
      launcher === null ||
      overview === null
    ) {
      return null;
    }

    const headerBox = header.getBoundingClientRect();
    const modeBox = modes.getBoundingClientRect();
    const launcherBox = launcher.getBoundingClientRect();
    const overviewBox = overview.getBoundingClientRect();
    const overviewStyle = window.getComputedStyle(overview);

    return {
      alignedEdges:
        Math.abs(launcherBox.left - overviewBox.left) <= 1 &&
        Math.abs(launcherBox.right - overviewBox.right) <= 1,
      glassActive:
        overviewStyle.backdropFilter !== "none" ||
        overviewStyle.webkitBackdropFilter !== "none",
      modesInsideHeader:
        modeBox.left >= headerBox.left && modeBox.right <= headerBox.right,
    };
  });

  expect(layout).toEqual({
    alignedEdges: true,
    glassActive: true,
    modesInsideHeader: true,
  });
});

test("scales and contains the laboratory continuously across viewport widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await enterStudio(page);

  const samples = [];

  for (const width of [320, 390, 600, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 900 });

    samples.push(
      await page.evaluate(() => {
        const launcher = document.querySelector<HTMLElement>(".lab-launcher");
        const overview =
          document.querySelector<HTMLElement>(".lab-overview-card");
        const status = document.querySelector<HTMLElement>(".status-strip");
        const title = document.querySelector<HTMLElement>(".lab-launcher h1");
        const workbench =
          document.querySelector<HTMLElement>(".home-workbench");

        if (
          launcher === null ||
          overview === null ||
          status === null ||
          title === null ||
          workbench === null
        ) {
          return null;
        }

        const launcherBox = launcher.getBoundingClientRect();
        const overviewBox = overview.getBoundingClientRect();
        const workbenchBox = workbench.getBoundingClientRect();
        const launcherStyle = window.getComputedStyle(launcher);
        const overviewStyle = window.getComputedStyle(overview);
        const statusStyle = window.getComputedStyle(status);
        const titleStyle = window.getComputedStyle(title);
        const directCards = [...workbench.children].filter(
          (element): element is HTMLElement => element instanceof HTMLElement,
        );

        return {
          contained:
            directCards.every((card) => {
              const box = card.getBoundingClientRect();
              return (
                box.left >= workbenchBox.left - 1 &&
                box.right <= workbenchBox.right + 1
              );
            }) && document.documentElement.scrollWidth <= window.innerWidth + 1,
          containerType: overviewStyle.containerType,
          aligned:
            Math.abs(launcherBox.left - overviewBox.left) <= 1 &&
            Math.abs(launcherBox.right - overviewBox.right) <= 1,
          radius: Number.parseFloat(launcherStyle.borderRadius),
          padding: Number.parseFloat(launcherStyle.paddingLeft),
          titleSize: Number.parseFloat(titleStyle.fontSize),
          heroColumns: launcherStyle.gridTemplateColumns.split(" ").length,
          statusColumns: statusStyle.gridTemplateColumns.split(" ").length,
          statusVisible: statusStyle.display === "grid",
        };
      }),
    );
  }

  expect(samples.every((sample) => sample !== null)).toBe(true);
  const layouts = samples.filter((sample) => sample !== null);

  expect(layouts.every((sample) => sample.contained)).toBe(true);
  expect(layouts.every((sample) => sample.aligned)).toBe(true);
  expect(layouts.every((sample) => sample.statusVisible)).toBe(true);
  expect(
    layouts.every((sample) => sample.containerType === "inline-size"),
  ).toBe(true);

  for (const key of ["radius", "padding", "titleSize"] as const) {
    expect(layouts.map((sample) => sample[key])).toEqual(
      [...layouts.map((sample) => sample[key])].sort(
        (left, right) => left - right,
      ),
    );
  }

  expect(layouts[2]).toMatchObject({ heroColumns: 1, statusColumns: 2 });
  expect(layouts[3]).toMatchObject({ heroColumns: 2, statusColumns: 3 });
  expect(layouts.at(-1)!.radius - layouts[0]!.radius).toBeGreaterThanOrEqual(
    10,
  );
  expect(layouts.at(-1)!.titleSize - layouts[0]!.titleSize).toBeGreaterThan(30);
});

test("reflows capture and review when the phone rotates", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await enterStudio(page);
  await page
    .getByRole("button", { name: "Capture libre", exact: true })
    .click();
  await page.getByRole("button", { name: "Démarrer la capture" }).click();

  await expect(page.locator(".karaoke-screen")).toBeVisible();
  await page.setViewportSize({ width: 852, height: 393 });
  await expect(page.locator("main.surface-mobile-landscape-lab")).toBeVisible();
  await expectSinglePageScroll(page);

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.locator(".listening-review")).toBeVisible({
    timeout: 30_000,
  });
  await expectSinglePageScroll(page);

  await page.setViewportSize({ width: 834, height: 1194 });
  await expect(page.locator("main.surface-tablet-dashboard")).toBeVisible();
  await expectSinglePageScroll(page);
});

test("keeps guided preparation and calibration fluid on tablet landscape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterStudio(page);
  await page.getByRole("button", { name: "Dataset ML", exact: true }).click();
  await page.getByRole("button", { name: "Créer le dataset" }).click();

  await expect(page.locator(".director-panel")).toBeVisible();
  await expectSinglePageScroll(page);

  await page.getByRole("button", { name: "Démarrer la prise" }).click();
  await expect(page.locator(".room-tone-screen")).toBeVisible();
  await expectSinglePageScroll(page);
});
