import { useEffect, useRef, useState } from "react";
import {
  getAmbientRenderingBudget,
  type AmbientRenderingBudget,
} from "../system/renderingBudget";
import { createFramePaceMonitor } from "../system/framePaceMonitor";

/**
 * Keeps the decorative audio surface from competing with page navigation.
 * The mutable ref is intentionally shared with audio animation callbacks so
 * they can react to scroll/visibility/device-strain changes without React
 * updates per frame.
 */
export function useAmbientRenderingBudget(input: {
  readonly isCapturing: boolean;
}): {
  readonly budget: AmbientRenderingBudget;
  readonly budgetRef: { current: AmbientRenderingBudget };
} {
  const [isPageVisible, setIsPageVisible] = useState(
    () => document.visibilityState === "visible",
  );
  const [isScrolling, setIsScrolling] = useState(false);
  const [isDeviceConstrained, setIsDeviceConstrained] = useState(false);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const budget = getAmbientRenderingBudget({
    isCapturing: input.isCapturing,
    isPageVisible,
    isScrolling,
    isDeviceConstrained,
  });
  const budgetRef = useRef<AmbientRenderingBudget>(budget);

  useEffect(() => {
    budgetRef.current = budget;
  }, [budget]);

  useEffect(() => {
    function markScrollActivity() {
      setIsScrolling(true);

      if (scrollIdleTimerRef.current !== null) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }

      scrollIdleTimerRef.current = window.setTimeout(() => {
        scrollIdleTimerRef.current = null;
        setIsScrolling(false);
      }, 180);
    }

    function updatePageVisibility() {
      setIsPageVisible(document.visibilityState === "visible");
    }

    window.addEventListener("scroll", markScrollActivity, { passive: true });
    document.addEventListener("visibilitychange", updatePageVisibility);

    return () => {
      window.removeEventListener("scroll", markScrollActivity);
      document.removeEventListener("visibilitychange", updatePageVisibility);

      if (scrollIdleTimerRef.current !== null) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const monitor = createFramePaceMonitor();
    let frameId = 0;

    function sample(now: number) {
      const constrained = monitor.recordFrame(now);

      setIsDeviceConstrained((previous) =>
        previous === constrained ? previous : constrained,
      );
      frameId = window.requestAnimationFrame(sample);
    }

    function start() {
      monitor.reset();
      frameId = window.requestAnimationFrame(sample);
    }

    function stop() {
      window.cancelAnimationFrame(frameId);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") {
      start();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stop();
    };
  }, []);

  return { budget, budgetRef };
}
