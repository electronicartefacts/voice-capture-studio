/**
 * Measures how quickly `requestAnimationFrame` actually fires and turns that
 * into a device/browser strain signal. Static capability hints
 * (`hardwareConcurrency`, `deviceMemory`, battery) are deliberately not used:
 * `deviceMemory` and the Battery API are Chromium-only, core count does not
 * predict single-core Safari/WebKit performance, and none of them reflect
 * transient strain (thermal throttling, background tabs, other apps). The
 * frame interval the browser actually delivers is the one signal every engine
 * exposes and the one that is true in the moment it is read.
 */
const ENTER_CONSTRAINED_INTERVAL_MS = 1000 / 36;
const EXIT_CONSTRAINED_INTERVAL_MS = 1000 / 50;
const SMOOTHING = 0.12;
// A gap this large is a tab switch or a system sleep, not device strain; an
// unsmoothed multi-second delta would otherwise flip the signal on return.
const FRAME_GAP_RESET_MS = 250;

export function createFramePaceMonitor(): {
  readonly recordFrame: (now: number) => boolean;
  readonly reset: () => void;
} {
  let averageIntervalMs = 1000 / 60;
  let lastFrameAt = -Infinity;
  let isConstrained = false;

  return {
    recordFrame(now: number): boolean {
      const delta = now - lastFrameAt;

      lastFrameAt = now;

      if (!(delta > 0) || delta > FRAME_GAP_RESET_MS) {
        return isConstrained;
      }

      averageIntervalMs += (delta - averageIntervalMs) * SMOOTHING;

      if (!isConstrained && averageIntervalMs > ENTER_CONSTRAINED_INTERVAL_MS) {
        isConstrained = true;
      } else if (
        isConstrained &&
        averageIntervalMs < EXIT_CONSTRAINED_INTERVAL_MS
      ) {
        isConstrained = false;
      }

      return isConstrained;
    },
    reset(): void {
      lastFrameAt = -Infinity;
    },
  };
}
