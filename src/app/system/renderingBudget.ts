/**
 * The capture pipeline must never compete with navigation. This policy keeps
 * presentation work explicitly separate from audio capture and analysis.
 * The studio's visual identity remains present at every budget; only the
 * freshness of decorative signal data is allowed to adapt.
 */
export type AmbientRenderingBudget = "full" | "constrained" | "paused";

export function getAmbientRenderingBudget(input: {
  readonly isCapturing: boolean;
  readonly isPageVisible: boolean;
  readonly isScrolling: boolean;
}): AmbientRenderingBudget {
  if (!input.isPageVisible) {
    return "paused";
  }

  // On mobile Safari, even a low-frequency full-screen canvas competes with
  // compositing while the browser chrome moves during a scroll. Decorative
  // rendering can stop completely; capture feedback must remain uninterrupted.
  return input.isScrolling && !input.isCapturing ? "paused" : "full";
}
