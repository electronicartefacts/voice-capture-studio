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
  readonly isDeviceConstrained: boolean;
}): AmbientRenderingBudget {
  if (!input.isPageVisible) {
    return "paused";
  }

  // Capture feedback is the one invariant this policy never trades away: once
  // a take is being recorded, scrolling and measured device strain are both
  // ignored and the budget stays "full".
  if (input.isCapturing) {
    return "full";
  }

  // On mobile Safari, even a low-frequency full-screen canvas competes with
  // compositing while the browser chrome moves during a scroll. Decorative
  // rendering can stop completely; only idle/ambient screens pay this cost.
  if (input.isScrolling) {
    return "paused";
  }

  // Sustained real frame-pacing strain lowers decorative fidelity (waveform
  // idle frame rate, acoustic field read cadence) instead of degrading further
  // into a visible stall.
  return input.isDeviceConstrained ? "constrained" : "full";
}
