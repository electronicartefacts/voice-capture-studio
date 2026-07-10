import type { SpeechSegment, SpeechSegmentSummary } from "./types";

export type SegmentationOptions = {
  /** Probability above which a frame opens a speech segment. */
  readonly startThreshold: number;
  /** Probability below which frames count toward closing a segment. */
  readonly endThreshold: number;
  /** Silence long enough to close an open segment. */
  readonly minSilenceMs: number;
  /** Segments shorter than this are treated as noise and dropped. */
  readonly minSpeechMs: number;
  /** Padding added around detected speech to avoid clipped syllables. */
  readonly paddingMs: number;
};

export const DEFAULT_SEGMENTATION_OPTIONS: SegmentationOptions = {
  startThreshold: 0.5,
  endThreshold: 0.35,
  minSilenceMs: 300,
  minSpeechMs: 200,
  paddingMs: 30,
};

/**
 * Turns per-frame speech probabilities (Silero VAD output) into padded speech
 * segments using hysteresis thresholds, mirroring the reference silero-vad
 * post-processing.
 */
export function segmentSpeechProbabilities(
  probabilities: readonly number[],
  frameMs: number,
  options: SegmentationOptions = DEFAULT_SEGMENTATION_OPTIONS,
): readonly SpeechSegment[] {
  const totalMs = probabilities.length * frameMs;
  const segments: { startMs: number; endMs: number }[] = [];
  let speechStartMs: number | null = null;
  let silenceStartMs: number | null = null;

  for (let frame = 0; frame < probabilities.length; frame += 1) {
    const probability = probabilities[frame];
    const frameStartMs = frame * frameMs;

    if (speechStartMs === null) {
      if (probability >= options.startThreshold) {
        speechStartMs = frameStartMs;
        silenceStartMs = null;
      }

      continue;
    }

    if (probability >= options.endThreshold) {
      silenceStartMs = null;
      continue;
    }

    if (silenceStartMs === null) {
      silenceStartMs = frameStartMs;
    }

    if (frameStartMs + frameMs - silenceStartMs >= options.minSilenceMs) {
      segments.push({ startMs: speechStartMs, endMs: silenceStartMs });
      speechStartMs = null;
      silenceStartMs = null;
    }
  }

  if (speechStartMs !== null) {
    segments.push({ startMs: speechStartMs, endMs: silenceStartMs ?? totalMs });
  }

  return segments
    .filter((segment) => segment.endMs - segment.startMs >= options.minSpeechMs)
    .map((segment) => ({
      startMs: Math.max(0, segment.startMs - options.paddingMs),
      endMs: Math.min(totalMs, segment.endMs + options.paddingMs),
    }));
}

export function summarizeSpeechSegments(
  segments: readonly SpeechSegment[],
  totalDurationMs: number,
): SpeechSegmentSummary {
  if (segments.length === 0) {
    return {
      leadingSilenceMs: totalDurationMs,
      trailingSilenceMs: totalDurationMs,
      speechDurationMs: 0,
      totalDurationMs,
    };
  }

  const speechDurationMs = segments.reduce(
    (sum, segment) => sum + (segment.endMs - segment.startMs),
    0,
  );

  return {
    leadingSilenceMs: Math.max(0, segments[0].startMs),
    trailingSilenceMs: Math.max(
      0,
      totalDurationMs - segments[segments.length - 1].endMs,
    ),
    speechDurationMs,
    totalDurationMs,
  };
}
