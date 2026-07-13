import type { RecordedTake } from "@domains/sessions";

export type ReviewWordTiming = {
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
};

export function createReviewWordTimings(
  take: RecordedTake | null,
): readonly ReviewWordTiming[] {
  if (take === null) return [];

  const forcedWords = take.timing.forcedAlignment?.words ?? [];
  if (forcedWords.length > 0) return forcedWords;

  const whisperWords = take.timing.localAcousticAnalysis?.words ?? [];
  if (whisperWords.length > 0) return whisperWords;

  if (take.timing.words.length > 0) return take.timing.words;

  const words = take.transcript.spokenText.split(/\s+/).filter(Boolean);
  const durationMs = Math.max(1, take.durationMs);

  return words.map((word, index) => ({
    word,
    startMs: Math.round((durationMs / Math.max(1, words.length)) * index),
    endMs: Math.round((durationMs / Math.max(1, words.length)) * (index + 1)),
  }));
}

export function findActiveReviewWordIndex(
  wordTimings: readonly ReviewWordTiming[],
  currentTimeMs: number,
): number {
  if (wordTimings.length === 0 || currentTimeMs < wordTimings[0].startMs) {
    return -1;
  }

  const exactIndex = wordTimings.findIndex(
    (timing) =>
      currentTimeMs >= timing.startMs && currentTimeMs <= timing.endMs,
  );
  if (exactIndex >= 0) return exactIndex;

  const nextIndex = wordTimings.findIndex(
    (timing) => currentTimeMs < timing.startMs,
  );
  return nextIndex === -1 ? wordTimings.length - 1 : nextIndex - 1;
}
