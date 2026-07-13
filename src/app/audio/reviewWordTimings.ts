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
  if (whisperWords.length > 0) {
    return calibrateWhisperToSpeechBounds(
      whisperWords,
      take.timing.localAcousticAnalysis?.speechSegments ?? [],
      take.durationMs,
    );
  }

  if (take.timing.words.length > 0) return take.timing.words;

  const words = take.transcript.spokenText.split(/\s+/).filter(Boolean);
  const durationMs = Math.max(1, take.durationMs);

  return words.map((word, index) => ({
    word,
    startMs: Math.round((durationMs / Math.max(1, words.length)) * index),
    endMs: Math.round((durationMs / Math.max(1, words.length)) * (index + 1)),
  }));
}

export function calibrateWhisperToSpeechBounds(
  words: readonly ReviewWordTiming[],
  speechSegments: readonly {
    readonly startMs: number;
    readonly endMs: number;
  }[],
  durationMs: number,
): readonly ReviewWordTiming[] {
  const firstWord = words[0];
  const lastWord = words.at(-1);
  const firstSpeech = speechSegments[0];
  const lastSpeech = speechSegments.at(-1);
  if (
    firstWord === undefined ||
    lastWord === undefined ||
    firstSpeech === undefined ||
    lastSpeech === undefined
  ) {
    return words;
  }

  // Silero marks stable speech slightly after the consonant attack. Keeping a
  // short lead-in avoids making the transcript feel late while removing the
  // larger early bias of Whisper attention timestamps.
  const targetStartMs = Math.max(0, firstSpeech.startMs - 55);
  const targetEndMs = Math.min(durationMs, lastSpeech.endMs + 45);
  const sourceSpanMs = lastWord.endMs - firstWord.startMs;
  const targetSpanMs = targetEndMs - targetStartMs;
  if (sourceSpanMs <= 0 || targetSpanMs <= 0) return words;

  const scale = clamp(targetSpanMs / sourceSpanMs, 0.82, 1.22);
  return words.map((word) => {
    const startMs = clamp(
      Math.round(targetStartMs + (word.startMs - firstWord.startMs) * scale),
      0,
      durationMs,
    );
    const endMs = clamp(
      Math.round(targetStartMs + (word.endMs - firstWord.startMs) * scale),
      startMs,
      durationMs,
    );
    return { word: word.word, startMs, endMs };
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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
