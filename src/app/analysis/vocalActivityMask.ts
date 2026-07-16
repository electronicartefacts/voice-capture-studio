import type { SpeechSegment } from "./types";

const DEFAULT_SAMPLE_RATE = 16_000;
const DEFAULT_PADDING_MS = 140;
const DEFAULT_MERGE_GAP_MS = 180;
const DEFAULT_FADE_MS = 36;

export type VocalActivityMaskResult = {
  readonly signal: Float32Array;
  readonly applied: boolean;
  readonly retainedRatio: number;
  readonly segmentCount: number;
};

export function mergeVocalActivitySegments(
  segmentGroups: readonly (readonly SpeechSegment[])[],
  totalDurationMs: number,
  paddingMs = DEFAULT_PADDING_MS,
  mergeGapMs = DEFAULT_MERGE_GAP_MS,
): readonly SpeechSegment[] {
  if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) return [];
  const bounded = segmentGroups
    .flat()
    .filter(
      ({ startMs, endMs }) =>
        Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs,
    )
    .map(({ startMs, endMs }) => ({
      startMs: Math.max(0, startMs - paddingMs),
      endMs: Math.min(totalDurationMs, endMs + paddingMs),
    }))
    .filter(({ startMs, endMs }) => endMs > startMs)
    .sort((left, right) => left.startMs - right.startMs);
  const merged: SpeechSegment[] = [];

  for (const segment of bounded) {
    const previous = merged.at(-1);
    if (
      previous !== undefined &&
      segment.startMs <= previous.endMs + mergeGapMs
    ) {
      merged[merged.length - 1] = {
        startMs: previous.startMs,
        endMs: Math.max(previous.endMs, segment.endMs),
      };
    } else {
      merged.push(segment);
    }
  }

  return merged;
}

/**
 * Silences instrumental-only regions while preserving the source duration, so
 * Whisper timestamps remain directly usable on the untouched export audio.
 */
export function applyVocalActivityMask(input: {
  readonly signal: Float32Array;
  readonly segments: readonly SpeechSegment[];
  readonly sampleRate?: number;
  readonly fadeMs?: number;
}): VocalActivityMaskResult {
  const sampleRate = input.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const durationMs = (input.signal.length / sampleRate) * 1_000;
  const segments = mergeVocalActivitySegments(
    [input.segments],
    durationMs,
    0,
    0,
  );
  const activeDurationMs = segments.reduce(
    (sum, segment) => sum + segment.endMs - segment.startMs,
    0,
  );
  const retainedRatio = roundRate(activeDurationMs / Math.max(durationMs, 1));

  // Very sparse detections are too risky for singing; near-continuous activity
  // has nothing useful to suppress. In both cases keep the original signal.
  if (segments.length === 0 || retainedRatio < 0.04 || retainedRatio > 0.94) {
    return {
      signal: input.signal,
      applied: false,
      retainedRatio,
      segmentCount: segments.length,
    };
  }

  const output = new Float32Array(input.signal.length);
  const fadeSamples = Math.max(
    1,
    Math.round(((input.fadeMs ?? DEFAULT_FADE_MS) / 1_000) * sampleRate),
  );

  for (const segment of segments) {
    const startSample = Math.max(
      0,
      Math.floor((segment.startMs / 1_000) * sampleRate),
    );
    const endSample = Math.min(
      input.signal.length,
      Math.ceil((segment.endMs / 1_000) * sampleRate),
    );
    const segmentLength = Math.max(0, endSample - startSample);
    const edgeSamples = Math.min(fadeSamples, Math.floor(segmentLength / 2));

    for (let index = startSample; index < endSample; index += 1) {
      const offset = index - startSample;
      const remaining = endSample - 1 - index;
      const fadeIn =
        edgeSamples === 0 ? 1 : Math.min(1, (offset + 1) / edgeSamples);
      const fadeOut =
        edgeSamples === 0 ? 1 : Math.min(1, (remaining + 1) / edgeSamples);
      const sample = Number.isFinite(input.signal[index])
        ? input.signal[index]
        : 0;
      output[index] = sample * Math.min(fadeIn, fadeOut);
    }
  }

  return {
    signal: output,
    applied: true,
    retainedRatio,
    segmentCount: segments.length,
  };
}

function roundRate(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1_000) / 1_000;
}
