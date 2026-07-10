type ViewportSource = {
  readonly height: number;
  readonly offsetTop: number;
  addEventListener: (
    type: "resize" | "scroll",
    listener: EventListener,
  ) => void;
  removeEventListener: (
    type: "resize" | "scroll",
    listener: EventListener,
  ) => void;
};

type WindowWithVisualViewport = Window &
  typeof globalThis & {
    readonly visualViewport?: ViewportSource;
  };

type NavigatorWithStandalone = Navigator & {
  readonly standalone?: boolean;
};

/**
 * Returns the visible browser viewport in CSS pixels. Keeping this value in a
 * CSS variable lets iOS Safari move its URL bar or open its keyboard without
 * leaving a stale `100vh` surface behind the recording controls.
 */
export function getVisibleViewportHeight(input: {
  readonly layoutViewportHeight: number;
  readonly visualViewportHeight?: number;
}): number {
  const candidate = input.visualViewportHeight ?? input.layoutViewportHeight;

  return Number.isFinite(candidate) && candidate > 0
    ? Math.round(candidate)
    : Math.max(1, Math.round(input.layoutViewportHeight));
}

export function isStandaloneDisplayMode(input: {
  readonly displayModeMatches: boolean;
  readonly navigatorStandalone?: boolean;
}): boolean {
  return input.displayModeMatches || input.navigatorStandalone === true;
}

/** Installs additive platform integration without changing the app workflow. */
export function installPlatformExperience(): () => void {
  const root = document.documentElement;
  const browserWindow = window as WindowWithVisualViewport;
  const viewport = browserWindow.visualViewport;
  const standaloneQuery = window.matchMedia("(display-mode: standalone)");
  let animationFrame: number | null = null;

  function updateViewport() {
    animationFrame = null;
    const height = getVisibleViewportHeight({
      layoutViewportHeight: window.innerHeight,
      visualViewportHeight: viewport?.height,
    });

    root.style.setProperty("--app-viewport-height", `${height}px`);
    root.style.setProperty(
      "--app-viewport-offset-top",
      `${Math.max(0, Math.round(viewport?.offsetTop ?? 0))}px`,
    );
  }

  function scheduleViewportUpdate() {
    if (animationFrame === null) {
      animationFrame = window.requestAnimationFrame(updateViewport);
    }
  }

  function updateDisplayMode() {
    root.dataset.displayMode = isStandaloneDisplayMode({
      displayModeMatches: standaloneQuery.matches,
      navigatorStandalone: (navigator as NavigatorWithStandalone).standalone,
    })
      ? "standalone"
      : "browser";
  }

  updateViewport();
  updateDisplayMode();
  window.addEventListener("resize", scheduleViewportUpdate, { passive: true });
  window.addEventListener("orientationchange", scheduleViewportUpdate, {
    passive: true,
  });
  viewport?.addEventListener("resize", scheduleViewportUpdate);
  viewport?.addEventListener("scroll", scheduleViewportUpdate);
  standaloneQuery.addEventListener("change", updateDisplayMode);

  return () => {
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
    }

    window.removeEventListener("resize", scheduleViewportUpdate);
    window.removeEventListener("orientationchange", scheduleViewportUpdate);
    viewport?.removeEventListener("resize", scheduleViewportUpdate);
    viewport?.removeEventListener("scroll", scheduleViewportUpdate);
    standaloneQuery.removeEventListener("change", updateDisplayMode);
  };
}
