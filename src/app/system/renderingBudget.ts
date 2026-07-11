/**
 * The capture pipeline must never compete with presentation work. This policy
 * keeps the live instrument continuous while the page is visible; only a
 * hidden page may suspend it, and measured strain may lower its fidelity.
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

  // The waveform and acoustic light field are part of the instrument, not a
  // disposable decoration. A visible scroll must therefore keep display-rate
  // feedback even when the browser temporarily reports poor frame pacing.
  if (input.isScrolling) {
    return "full";
  }

  // Sustained real frame-pacing strain lowers decorative fidelity (waveform
  // idle frame rate, acoustic field read cadence) instead of degrading further
  // into a visible stall.
  return input.isDeviceConstrained ? "constrained" : "full";
}
