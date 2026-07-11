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

export function getViewportEdgePull(input: {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly viewportHeight: number;
  readonly touchStartY: number;
  readonly touchY: number;
}): { readonly top: number; readonly bottom: number } {
  const travel = input.touchY - input.touchStartY;
  const maxScrollTop = Math.max(0, input.scrollHeight - input.viewportHeight);
  const top = input.scrollTop <= 1 && travel > 0 ? travel : 0;
  const bottom =
    input.scrollTop >= maxScrollTop - 1 && travel < 0 ? -travel : 0;

  return {
    top: Math.min(1, Math.max(0, top / 96)),
    bottom: Math.min(1, Math.max(0, bottom / 96)),
  };
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
  const edgeEffects = ["top", "bottom"].map((edge) => {
    const effect = document.createElement("div");
    const direction = edge === "top" ? "bottom" : "top";
    effect.setAttribute("aria-hidden", "true");
    effect.style.cssText = `-webkit-backdrop-filter:blur(6px) brightness(1.16);backdrop-filter:blur(6px) brightness(1.16);${edge}:0;left:0;right:0;height:120px;opacity:0;pointer-events:none;position:fixed;z-index:20;-webkit-mask-image:linear-gradient(to ${direction},black,transparent);mask-image:linear-gradient(to ${direction},black,transparent)`;
    document.body.append(effect);
    return effect;
  });
  let animationFrame: number | null = null;
  let committedHeight = -1;
  let committedOffsetTop = -1;
  let touchStartY: number | null = null;
  let edgeFrame: number | null = null;
  let edgeTop = 0;
  let edgeBottom = 0;

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

  function commitEdgePull() {
    edgeFrame = null;
    edgeEffects[0]!.style.opacity = edgeTop.toFixed(3);
    edgeEffects[1]!.style.opacity = edgeBottom.toFixed(3);
  }

  function scheduleEdgePull(top: number, bottom: number) {
    edgeTop = top;
    edgeBottom = bottom;

    if (edgeFrame === null) {
      edgeFrame = window.requestAnimationFrame(commitEdgePull);
    }
  }

  function beginEdgePull(event: TouchEvent) {
    touchStartY = event.touches[0]?.clientY ?? null;
  }

  function updateEdgePull(event: TouchEvent) {
    const touchY = event.touches[0]?.clientY;

    if (touchStartY === null || touchY === undefined) return;

    const scrollingElement = document.scrollingElement ?? root;
    const pull = getViewportEdgePull({
      scrollTop: scrollingElement.scrollTop,
      scrollHeight: scrollingElement.scrollHeight,
      viewportHeight: viewport?.height ?? window.innerHeight,
      touchStartY,
      touchY,
    });
    scheduleEdgePull(pull.top, pull.bottom);
  }

  function endEdgePull() {
    touchStartY = null;
    scheduleEdgePull(0, 0);
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
  window.addEventListener("touchstart", beginEdgePull, { passive: true });
  window.addEventListener("touchmove", updateEdgePull, { passive: true });
  window.addEventListener("touchend", endEdgePull, { passive: true });
  window.addEventListener("touchcancel", endEdgePull, { passive: true });

  return () => {
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
    }
    if (edgeFrame !== null) {
      window.cancelAnimationFrame(edgeFrame);
    }

    window.removeEventListener("resize", scheduleViewportUpdate);
    window.removeEventListener("orientationchange", scheduleViewportUpdate);
    viewport?.removeEventListener("resize", scheduleViewportUpdate);
    viewport?.removeEventListener("scroll", scheduleViewportUpdate);
    standaloneQuery.removeEventListener("change", updateDisplayMode);
    window.removeEventListener("touchstart", beginEdgePull);
    window.removeEventListener("touchmove", updateEdgePull);
    window.removeEventListener("touchend", endEdgePull);
    window.removeEventListener("touchcancel", endEdgePull);
    removeCustomCursor();
    edgeEffects.forEach((effect) => effect.remove());
  };
}
