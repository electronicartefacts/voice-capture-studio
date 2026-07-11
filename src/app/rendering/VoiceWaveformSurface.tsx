import { useEffect, useRef } from "react";
import {
  getLiveAudioLevel,
  getWaveformDisplayGain,
  liveAudioSignal,
} from "./liveAudioSignal";
import { getWaveformSamplePosition } from "./waveformGeometry";

export type VoiceWaveformScreen =
  "home" | "permission" | "calibration" | "karaoke" | "done" | "technical";

const DISPLAY_SAMPLES = 260;
const COMPACT_DISPLAY_SAMPLES = 128;
const MOBILE_RESIZE_THRESHOLD_PX = 160;
const CONSTRAINED_FRAME_INTERVAL_MS = 1000 / 30;
const FULL_FRAME_INTERVAL_MS = 1000 / 60;
const FRAME_INTERVAL_TOLERANCE_MS = 0.75;

export function VoiceWaveformSurface(input: {
  readonly active: boolean;
  readonly budget: "full" | "constrained" | "paused";
  readonly awake: boolean;
  readonly playbackProgress: number;
  readonly screen: VoiceWaveformScreen;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(input.active);
  const awakeRef = useRef(input.awake);
  const budgetRef = useRef(input.budget);
  const playbackProgressRef = useRef(input.playbackProgress);
  const screenRef = useRef(input.screen);

  useEffect(() => {
    activeRef.current = input.active;
  }, [input.active]);

  useEffect(() => {
    awakeRef.current = input.awake;
  }, [input.awake]);

  useEffect(() => {
    budgetRef.current = input.budget;
  }, [input.budget]);

  useEffect(() => {
    playbackProgressRef.current = input.playbackProgress;
  }, [input.playbackProgress]);

  useEffect(() => {
    screenRef.current = input.screen;
  }, [input.screen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (canvas === null || context === undefined || context === null) {
      return;
    }

    const surfaceCanvas = canvas;
    const ctx = context;
    const previousWaveform = new Float32Array(DISPLAY_SAMPLES).fill(0);
    const xCoordinates = new Float32Array(DISPLAY_SAMPLES);
    const yCoordinates = new Float32Array(DISPLAY_SAMPLES);
    let frameId = 0;
    let pausedTimerId: number | null = null;
    let lastFrameAt = -Infinity;
    let renderWidth = 0;
    let renderHeight = 0;
    let displaySamples = DISPLAY_SAMPLES;

    function resize() {
      const nextWidth = Math.round(
        window.visualViewport?.width ?? window.innerWidth,
      );
      const nextHeight = Math.round(
        window.visualViewport?.height ?? window.innerHeight,
      );

      // Safari iOS emits resize events while its URL bar expands or collapses.
      // Reallocating a full-screen canvas for every one of those events stalls
      // scrolling, while a small height difference is safely covered by CSS.
      if (
        renderWidth === nextWidth &&
        Math.abs(renderHeight - nextHeight) < MOBILE_RESIZE_THRESHOLD_PX
      ) {
        return;
      }

      const dpr = Math.min(
        window.devicePixelRatio || 1,
        nextWidth < 720 ? 1.5 : 2,
      );

      renderWidth = nextWidth;
      renderHeight = nextHeight;
      displaySamples =
        renderWidth < 720 ? COMPACT_DISPLAY_SAMPLES : DISPLAY_SAMPLES;
      surfaceCanvas.width = Math.floor(renderWidth * dpr);
      surfaceCanvas.height = Math.floor(renderHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;

      for (let index = 0; index < displaySamples; index += 1) {
        xCoordinates[index] =
          renderWidth * (index / Math.max(1, displaySamples - 1));
      }
    }

    let themeReadAt = -Infinity;
    let themeCache = {
      waveColor: "rgba(255,255,255,0.72)",
      guideColor: "rgba(255,255,255,0.14)",
      playheadColor: "rgba(122,220,255,0.9)",
      waveAlpha: 0.72,
    };

    function readTheme(now: number): typeof themeCache {
      if (now - themeReadAt < 500) {
        return themeCache;
      }

      const style = getComputedStyle(document.documentElement);
      const readColor = (name: string, fallback: string) =>
        style.getPropertyValue(name).trim() || fallback;
      const parsedAlpha = Number.parseFloat(
        style.getPropertyValue("--wave-surface-alpha"),
      );

      themeReadAt = now;
      themeCache = {
        waveColor: readColor("--wave-surface-color", "rgba(255,255,255,0.72)"),
        guideColor: readColor("--wave-surface-guide", "rgba(255,255,255,0.14)"),
        playheadColor: readColor(
          "--wave-surface-playhead",
          "rgba(122,220,255,0.9)",
        ),
        waveAlpha: Number.isFinite(parsedAlpha) ? parsedAlpha : 0.72,
      };

      return themeCache;
    }

    function getWaveCenterRatio(
      state: VoiceWaveformScreen,
      width: number,
    ): number {
      if (state === "home") return width < 720 ? 0.28 : 0.18;
      if (state === "permission") return width < 720 ? 0.18 : 0.14;
      if (state === "technical") return width < 720 ? 0.16 : 0.18;
      // On the review surface the persistent filament must pass through the
      // decoded take monitor, not through the action stack below it. This
      // makes the page-wide signal and the precise local waveform read as one
      // instrument across phone and desktop layouts.
      if (state === "done") return width < 720 ? 0.47 : 0.5;
      return 0.5;
    }

    function createIdleWaveSample(
      index: number,
      sampleCount: number,
      timeSeconds: number,
      level: number,
      state: VoiceWaveformScreen,
    ): number {
      const position = getWaveformSamplePosition(index, sampleCount);
      const phase = position * Math.PI * 2;
      const recordingGain =
        state === "karaoke"
          ? 1
          : state === "calibration"
            ? 0.42
            : state === "technical"
              ? 0.68
              : 0.22;
      const reviewGain = state === "done" ? 0.52 : 0;
      const quietMotion = 0.018 + (state === "home" ? 0.012 : 0);
      const gain = quietMotion + level * (recordingGain + reviewGain);
      const carrier =
        Math.sin(phase * 2.8 + timeSeconds * 1.7) * 0.42 +
        Math.sin(phase * 5.7 - timeSeconds * 1.15) * 0.27 +
        Math.sin(phase * 11.2 + timeSeconds * 0.72) * 0.13;
      const breath =
        Math.sin(timeSeconds * 0.85 + index * 0.037) * (0.03 + level * 0.08);

      return softLimitWaveSample(carrier * gain + breath, 0.88, 4.8);
    }

    function drawSpline(
      offsetScale: number,
      lineWidth: number,
      alpha: number,
      color: string,
    ) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(xCoordinates[0], yCoordinates[0]);

      for (let index = 0; index < displaySamples - 1; index += 1) {
        const p0Index = index > 0 ? index - 1 : 0;
        const p3Index = Math.min(index + 2, displaySamples - 1);
        const p0x = xCoordinates[p0Index];
        const p0y = yCoordinates[p0Index];
        const p1x = xCoordinates[index];
        const p1y = yCoordinates[index];
        const p2x = xCoordinates[index + 1];
        const p2y = yCoordinates[index + 1];
        const p3x = xCoordinates[p3Index];
        const p3y = yCoordinates[p3Index];
        const dx = p2x - p1x;
        const dy = p2y - p1y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const normalX = (-dy / length) * offsetScale;
        const normalY = (dx / length) * offsetScale;

        ctx.bezierCurveTo(
          p1x + (p2x - p0x) / 6 + normalX,
          p1y + (p2y - p0y) / 6 + normalY,
          p2x - (p3x - p1x) / 6 + normalX,
          p2y - (p3y - p1y) / 6 + normalY,
          p2x + normalX,
          p2y + normalY,
        );
      }

      ctx.stroke();
      ctx.restore();
    }

    function scheduleDraw() {
      if (!activeRef.current || !awakeRef.current) {
        return;
      }

      if (budgetRef.current === "paused") {
        // Hidden pages keep their last composited frame without spending at
        // display cadence. The timer wakes the surface promptly on foreground.
        pausedTimerId = window.setTimeout(() => {
          pausedTimerId = null;
          frameId = window.requestAnimationFrame(draw);
        }, 120);
        return;
      }

      frameId = window.requestAnimationFrame(draw);
    }

    function draw() {
      if (!activeRef.current || !awakeRef.current) return;

      if (budgetRef.current === "paused") {
        scheduleDraw();
        return;
      }

      const frameNow = performance.now();
      const state = screenRef.current;
      const targetFrameInterval =
        budgetRef.current === "constrained"
          ? CONSTRAINED_FRAME_INTERVAL_MS
          : FULL_FRAME_INTERVAL_MS;

      if (
        frameNow - lastFrameAt + FRAME_INTERVAL_TOLERANCE_MS <
        targetFrameInterval
      ) {
        scheduleDraw();
        return;
      }

      lastFrameAt = frameNow;
      const timeSeconds = frameNow * 0.001;
      const theme = readTheme(frameNow);
      const { waveColor, guideColor, playheadColor } = theme;
      const waveAlpha = clampUnit(theme.waveAlpha);
      const level = getLiveAudioLevel();
      const width = renderWidth;
      const height = renderHeight;
      const isCompactSurface = width < 720;

      ctx.clearRect(0, 0, width, height);

      const centerY = height * getWaveCenterRatio(state, width);
      const isCaptureSurface = state === "calibration" || state === "karaoke";
      const isQuietSurface =
        state === "home" || state === "permission" || state === "technical";
      const signalIsFresh = frameNow - liveAudioSignal.updatedAt < 260;
      const liveGain = getWaveformDisplayGain(
        signalIsFresh ? getLiveWaveGain(state) : 0,
        level,
        isCompactSurface,
      );
      const isLiveSurface = liveGain > 0;
      const visualHeight = Math.min(
        isQuietSurface
          ? isCompactSurface
            ? 280
            : 180
          : isCompactSurface
            ? 360
            : 260,
        height *
          (isQuietSurface
            ? isCompactSurface
              ? 0.28
              : 0.16
            : isCompactSurface
              ? 0.38
              : 0.25),
      );

      for (let index = 0; index < displaySamples; index += 1) {
        const position = getWaveformSamplePosition(index, displaySamples);
        const edge = Math.abs(position - 0.5) * 2;
        const envelope = Math.pow(
          0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, 1 - edge)),
          1.8,
        );
        const breath =
          Math.sin(timeSeconds * 0.85 + index * 0.037) * (0.02 + level * 0.05);
        const targetSample = isLiveSurface
          ? softLimitWaveSample(
              liveAudioSignal.samples[
                Math.round(position * (liveAudioSignal.samples.length - 1))
              ] *
                liveGain +
                breath,
              0.88,
              4.8,
            )
          : createIdleWaveSample(
              index,
              displaySamples,
              timeSeconds,
              level,
              state,
            );
        const smoothing = isLiveSurface
          ? 0.6
          : state === "karaoke"
            ? 0.48
            : 0.22;
        const sample =
          previousWaveform[index] +
          (targetSample - previousWaveform[index]) * smoothing;

        previousWaveform[index] = sample;
        yCoordinates[index] =
          centerY + sample * (0.08 + envelope * 0.92) * visualHeight;
      }

      if (state === "calibration" || state === "karaoke" || state === "done") {
        ctx.save();
        ctx.strokeStyle = guideColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = isCaptureSurface ? 0.48 : 0.34;
        ctx.beginPath();
        ctx.moveTo(width / 2, centerY - visualHeight * 1.22);
        ctx.lineTo(width / 2, centerY + visualHeight * 1.22);
        ctx.stroke();
        ctx.restore();
      }

      const quietAlpha =
        state === "technical"
          ? Math.min(0.85, 0.46 + level * 0.4)
          : isQuietSurface
            ? isCompactSurface
              ? 0.58
              : 0.24
            : 1;
      const alpha =
        theme.waveAlpha *
        quietAlpha *
        (isCaptureSurface ? (isCompactSurface ? 0.82 : 0.56) : 1);
      const primaryWidth = isCompactSurface
        ? state === "karaoke"
          ? 3.8
          : 3.4
        : state === "karaoke"
          ? 3.1
          : 2.8;
      const energizedPrimaryWidth =
        primaryWidth * (1 + level * (isCompactSurface ? 0.22 : 0.12));

      if (isCompactSurface && !isCaptureSurface) {
        // Spend the mobile budget on freshness: three tightly layered splines
        // preserve the luminous filament while leaving enough headroom to draw
        // it at display cadence through touch scrolling.
        drawSpline(-1.35, 0.76, alpha * 0.18, waveColor);
        drawSpline(0, energizedPrimaryWidth, alpha * 0.8, waveColor);
        drawSpline(1.35, 0.76, alpha * 0.18, waveColor);
      } else {
        drawSpline(-4, 0.26, alpha * 0.04, waveColor);
        drawSpline(-2.4, 0.42, alpha * 0.09, waveColor);
        drawSpline(-1.1, 0.74, alpha * 0.18, waveColor);
        drawSpline(-0.4, 1.18, alpha * 0.28, waveColor);
        drawSpline(0, energizedPrimaryWidth, alpha * 0.68, waveColor);
        drawSpline(0.4, 1.18, alpha * 0.28, waveColor);
        drawSpline(1.1, 0.74, alpha * 0.18, waveColor);
        drawSpline(2.4, 0.42, alpha * 0.09, waveColor);
        drawSpline(4, 0.26, alpha * 0.04, waveColor);
      }

      if (isLiveSurface) {
        drawSpline(
          0,
          energizedPrimaryWidth * 0.55,
          alpha * Math.min(0.6, 0.12 + level * 0.55),
          playheadColor,
        );
      }

      if (state === "done") {
        const progress = Math.max(0, Math.min(1, playbackProgressRef.current));

        if (progress > 0.01 && progress < 0.995) {
          const x = width * progress;

          ctx.save();
          ctx.strokeStyle = playheadColor;
          ctx.lineWidth = 1.4;
          ctx.globalAlpha = waveAlpha * 0.5;
          ctx.beginPath();
          ctx.moveTo(x, centerY - visualHeight * 1.08);
          ctx.lineTo(x, centerY + visualHeight * 1.08);
          ctx.stroke();
          ctx.restore();
        }
      }

      scheduleDraw();
    }

    resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    if (activeRef.current && awakeRef.current) {
      frameId = window.requestAnimationFrame(draw);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      if (pausedTimerId !== null) {
        window.clearTimeout(pausedTimerId);
      }
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [input.active, input.awake]);

  return (
    <canvas aria-hidden="true" className="voice-wave-canvas" ref={canvasRef} />
  );
}

function getLiveWaveGain(state: VoiceWaveformScreen): number {
  if (state === "karaoke") return 1;
  if (state === "technical") return 0.85;
  if (state === "calibration") return 0.8;
  if (state === "home") return 0.55;
  if (state === "permission") return 0.4;
  return 0;
}

function softLimitWaveSample(
  value: number,
  threshold: number,
  ratio: number,
): number {
  const absoluteValue = Math.abs(value);

  if (absoluteValue <= threshold) return value;

  return Math.sign(value) * (threshold + (absoluteValue - threshold) / ratio);
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
