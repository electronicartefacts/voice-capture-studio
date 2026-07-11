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

function installCustomCursor(root: HTMLElement): () => void {
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let cursor: HTMLDivElement | null = null;
  let animationFrame: number | null = null;
  let pointerX = 0;
  let pointerY = 0;

  const cursorClasses = [
    "has-custom-cursor",
    "custom-cursor-visible",
    "custom-cursor-pointer",
    "custom-cursor-text",
    "custom-cursor-down",
    "custom-cursor-selecting",
    "custom-cursor-selection",
  ];

  function ensureCursor() {
    if (cursor !== null || !finePointer.matches) return;

    cursor = document.createElement("div");
    cursor.className = "custom-cursor";
    cursor.setAttribute("aria-hidden", "true");
    cursor.innerHTML =
      '<span class="custom-cursor__ring"></span><span class="custom-cursor__dot"></span>';
    document.body.append(cursor);
    root.classList.add("has-custom-cursor");
  }

  function removeCursor() {
    cursor?.remove();
    cursor = null;
    root.classList.remove(...cursorClasses);
  }

  function commitPosition() {
    animationFrame = null;
    cursor?.style.setProperty("--cursor-x", `${pointerX}px`);
    cursor?.style.setProperty("--cursor-y", `${pointerY}px`);
  }

  function schedulePosition() {
    if (animationFrame === null) {
      animationFrame = window.requestAnimationFrame(commitPosition);
    }
  }

  function isInteractive(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      target.closest(
        'button, a, input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])',
      ) !== null
    );
  }

  function isText(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      target.closest(
        "p, h1, h2, h3, h4, h5, h6, li, dt, dd, label, small, blockquote, pre, code, figcaption",
      ) !== null
    );
  }

  function hasSelection(): boolean {
    const active = document.activeElement;
    const hasInputSelection =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
        ? active.selectionStart !== active.selectionEnd
        : false;
    return hasInputSelection || Boolean(window.getSelection?.()?.toString());
  }

  function syncSelection() {
    if (finePointer.matches) {
      root.classList.toggle("custom-cursor-selection", hasSelection());
    }
  }

  function onMove(event: PointerEvent) {
    if (!finePointer.matches || event.pointerType === "touch") return;
    ensureCursor();
    pointerX = event.clientX;
    pointerY = event.clientY;
    schedulePosition();
    root.classList.add("custom-cursor-visible");
    root.classList.toggle("custom-cursor-pointer", isInteractive(event.target));
    root.classList.toggle(
      "custom-cursor-text",
      !isInteractive(event.target) && isText(event.target),
    );
  }

  function onDown(event: PointerEvent) {
    if (!finePointer.matches || event.pointerType === "touch") return;
    root.classList.add("custom-cursor-down");
    root.classList.toggle("custom-cursor-selecting", isText(event.target));
  }

  function onUp() {
    root.classList.remove("custom-cursor-down", "custom-cursor-selecting");
    syncSelection();
  }

  function hideCursor() {
    root.classList.remove(
      "custom-cursor-visible",
      "custom-cursor-down",
      "custom-cursor-selecting",
    );
  }

  function updateCapability() {
    if (finePointer.matches) ensureCursor();
    else removeCursor();
  }

  updateCapability();
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("pointerleave", hideCursor, { passive: true });
  window.addEventListener("blur", hideCursor);
  document.addEventListener("selectionchange", syncSelection);
  finePointer.addEventListener("change", updateCapability);

  return () => {
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointerleave", hideCursor);
    window.removeEventListener("blur", hideCursor);
    document.removeEventListener("selectionchange", syncSelection);
    finePointer.removeEventListener("change", updateCapability);
    removeCursor();
  };
}

/** Installs additive platform integration without changing the app workflow. */
export function installPlatformExperience(): () => void {
  const root = document.documentElement;
  const browserWindow = window as WindowWithVisualViewport;
  const viewport = browserWindow.visualViewport;
  const standaloneQuery = window.matchMedia("(display-mode: standalone)");
  const removeCustomCursor = installCustomCursor(root);
  let animationFrame: number | null = null;
  let committedHeight = -1;
  let committedOffsetTop = -1;

  function updateViewport() {
    animationFrame = null;
    const height = getVisibleViewportHeight({
      layoutViewportHeight: window.innerHeight,
      visualViewportHeight: viewport?.height,
    });

    const offsetTop = Math.max(0, Math.round(viewport?.offsetTop ?? 0));

    // VisualViewport may emit dozens of scroll events while Safari moves its
    // chrome. Avoid invalidating layout when the effective geometry did not
    // change; dynamic viewport units remain the no-JavaScript fallback.
    if (height !== committedHeight) {
      root.style.setProperty("--app-viewport-height", `${height}px`);
      committedHeight = height;
    }

    if (offsetTop !== committedOffsetTop) {
      root.style.setProperty("--app-viewport-offset-top", `${offsetTop}px`);
      committedOffsetTop = offsetTop;
    }
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
    removeCustomCursor();
  };
}
