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

  // Capture screens keep the same feedback cadence. During navigation, the
  // visual layer remains visible but yields CPU time to scrolling and DOM paint.
  return input.isScrolling && !input.isCapturing ? "constrained" : "full";
}
