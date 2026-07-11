import type { PromptDefinition } from "@domains/corpus";
import type { LanguageCode } from "@shared/index";
import type { BrowserAsrHypothesis } from "@domains/observations";

export type SpeechRecognitionAlternativeLike = {
  readonly transcript: string;
  readonly confidence: number;
};
export type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike | undefined;
};
export type SpeechRecognitionEventLike = {
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike | undefined;
  };
};

export type FreeCaptureTranscript = {
  readonly schemaVersion: "voice.free_transcript.v1";
  /** Browser recognition is optional and may use a browser-managed service. */
  readonly engine: "browser_speech_recognition" | "unavailable";
  readonly status: "detected" | "no-final-words" | "unavailable";
  /** Only final hypotheses are retained in a capture manifest. */
  readonly text: string;
  readonly wordCount: number;
  readonly words: readonly DetectedSpeechWord[];
};

export type DetectedSpeechWord = {
  readonly word: string;
  readonly normalized: string;
  readonly occurrence: number;
};
export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  abort: () => void;
  start: () => void;
  stop: () => void;
};
export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
export type WindowWithSpeechRecognition = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
export function formatSpeechRecognitionLanguage(
  language: LanguageCode,
): string {
  return language === "fr" ? "fr-FR" : "en-US";
}

export function extractSpeechRecognitionTranscript(
  event: SpeechRecognitionEventLike,
): string {
  return extractSpeechRecognitionTranscriptByFinality(event, false);
}

/**
 * Keeps transient browser hypotheses on screen, but never serializes them as
 * capture evidence. Browsers resend prior final results with each event, so
 * rebuilding this string from the full result list also avoids duplicates.
 */
export function extractFinalSpeechRecognitionTranscript(
  event: SpeechRecognitionEventLike,
): string {
  return extractSpeechRecognitionTranscriptByFinality(event, true);
}

/**
 * Maintains one serializable hypothesis per browser result/alternative. Final
 * results keep their first observed timestamp when browsers replay them.
 */
export function mergeSpeechRecognitionHypotheses(
  previous: readonly BrowserAsrHypothesis[],
  event: SpeechRecognitionEventLike,
  capturedAtMs: number,
): readonly BrowserAsrHypothesis[] {
  const previousByKey = new Map(
    previous.map((hypothesis) => [
      `${hypothesis.resultIndex}:${hypothesis.alternativeIndex}`,
      hypothesis,
    ]),
  );
  const next: BrowserAsrHypothesis[] = [];

  for (
    let resultIndex = 0;
    resultIndex < event.results.length;
    resultIndex += 1
  ) {
    const result = event.results[resultIndex];

    if (result === undefined) {
      continue;
    }

    for (
      let alternativeIndex = 0;
      alternativeIndex < result.length;
      alternativeIndex += 1
    ) {
      const alternative = result[alternativeIndex];

      if (
        alternative === undefined ||
        alternative.transcript.trim().length === 0
      ) {
        continue;
      }

      const key = `${resultIndex}:${alternativeIndex}`;
      const prior = previousByKey.get(key);
      next.push({
        resultIndex,
        alternativeIndex,
        text: alternative.transcript.trim(),
        confidence:
          Number.isFinite(alternative.confidence) && alternative.confidence >= 0
            ? alternative.confidence
            : null,
        final: result.isFinal,
        capturedAtMs:
          prior?.final === true && result.isFinal
            ? prior.capturedAtMs
            : capturedAtMs,
      });
    }
  }

  return next;
}

function extractSpeechRecognitionTranscriptByFinality(
  event: SpeechRecognitionEventLike,
  finalOnly: boolean,
): string {
  const segments: string[] = [];

  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcript = result?.[0]?.transcript;

    if (transcript !== undefined && (!finalOnly || result?.isFinal === true)) {
      segments.push(transcript);
    }
  }

  return segments.join(" ").trim();
}

export function createFreeCaptureTranscript(input: {
  readonly finalTranscript: string;
  readonly recognitionAvailable: boolean;
}): FreeCaptureTranscript {
  const text = input.finalTranscript.trim();
  const words = extractDetectedSpeechWords(text);

  return {
    schemaVersion: "voice.free_transcript.v1",
    engine: input.recognitionAvailable
      ? "browser_speech_recognition"
      : "unavailable",
    status: !input.recognitionAvailable
      ? "unavailable"
      : words.length > 0
        ? "detected"
        : "no-final-words",
    text,
    wordCount: words.length,
    words,
  };
}

export function extractDetectedSpeechWords(
  transcript: string,
): readonly DetectedSpeechWord[] {
  const occurrences = new Map<string, number>();

  return (
    transcript.match(/[\p{Letter}\p{Number}][\p{Letter}\p{Number}'’-]*/gu) ?? []
  )
    .map((word) => ({ word, normalized: normalizeSpeechToken(word) }))
    .filter((word) => word.normalized.length > 0)
    .map((word) => {
      const occurrence = (occurrences.get(word.normalized) ?? 0) + 1;

      occurrences.set(word.normalized, occurrence);

      return { ...word, occurrence };
    });
}

export function alignTranscriptToPrompt(
  promptWords: readonly string[],
  transcript: string,
): number {
  return alignTranscriptToPromptPosition(promptWords, transcript).wordIndex;
}

export type SpeechGuidePosition = {
  readonly wordIndex: number;
  readonly wordProgress: number;
};

export function alignTranscriptToPromptPosition(
  promptWords: readonly string[],
  transcript: string,
): SpeechGuidePosition {
  const promptTokens = promptWords.map(normalizeSpeechToken);
  const spokenTokens = tokenizeSpeech(transcript);
  let cursor = 0;
  let bestMatchIndex = 0;
  let bestMatchProgress = 0;

  if (spokenTokens.length === 0 || promptTokens.length === 0) {
    return { wordIndex: 0, wordProgress: 0 };
  }

  for (const spokenToken of spokenTokens) {
    let matchIndex = -1;
    const searchLimit = Math.min(promptTokens.length, cursor + 8);

    for (let index = cursor; index < searchLimit; index += 1) {
      if (speechTokensMatch(promptTokens[index], spokenToken)) {
        matchIndex = index;
        break;
      }
    }

    if (matchIndex === -1) {
      continue;
    }

    bestMatchIndex = matchIndex;
    bestMatchProgress = estimateRecognizedWordProgress(
      promptTokens[matchIndex],
      spokenToken,
    );
    cursor = matchIndex + 1;
  }

  return {
    wordIndex: Math.min(promptWords.length - 1, bestMatchIndex),
    wordProgress: bestMatchProgress,
  };
}

export function tokenizeSpeech(text: string): readonly string[] {
  return text
    .split(/\s+/)
    .map(normalizeSpeechToken)
    .filter((token) => token.length > 0);
}

export function normalizeSpeechToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

export function speechTokensMatch(expected: string, actual: string): boolean {
  if (expected === actual) {
    return true;
  }

  if (expected.length < 3 || actual.length < 3) {
    return false;
  }

  if (
    (expected.length >= 5 && expected.endsWith(actual)) ||
    (actual.length >= 5 && actual.endsWith(expected))
  ) {
    return true;
  }

  if (
    Math.min(expected.length, actual.length) >= 5 &&
    (expected.startsWith(actual) || actual.startsWith(expected))
  ) {
    return true;
  }

  const allowedDistance = Math.min(expected.length, actual.length) >= 7 ? 2 : 1;

  return (
    levenshteinDistance(expected, actual, allowedDistance) <= allowedDistance
  );
}

export function levenshteinDistance(
  left: string,
  right: string,
  maxDistance: number,
): number {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return maxDistance + 1;
  }

  const previousRow = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  const currentRow = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    currentRow[0] = leftIndex;
    let rowMinimum = currentRow[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const distance = Math.min(
        previousRow[rightIndex] + 1,
        currentRow[rightIndex - 1] + 1,
        previousRow[rightIndex - 1] + substitutionCost,
      );

      currentRow[rightIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    for (let index = 0; index < previousRow.length; index += 1) {
      previousRow[index] = currentRow[index];
    }
  }

  return previousRow[right.length];
}

export function estimateSpeechGuideDurationMs(
  promptWords: readonly string[],
  prompt: PromptDefinition | undefined,
): number {
  const corpusEstimate =
    prompt === undefined
      ? promptWords.length * 560
      : (prompt.qa.minDurationMs + prompt.qa.maxDurationMs) / 2;
  const minimum = Math.max(1400, promptWords.length * 260);
  const maximum = Math.max(minimum + 900, promptWords.length * 980);

  return Math.min(maximum, Math.max(minimum, corpusEstimate));
}

export function sumWordWeights(words: readonly string[]): number {
  return words.reduce(
    (total, word) => total + estimateSpeechWordWeight(word),
    0,
  );
}

export function wordIndexFromSpeechProgress(
  words: readonly string[],
  progressWeight: number,
): number {
  return wordPositionFromSpeechProgress(words, progressWeight).wordIndex;
}

export function wordPositionFromSpeechProgress(
  words: readonly string[],
  progressWeight: number,
): SpeechGuidePosition {
  let accumulatedWeight = 0;

  for (let index = 0; index < words.length; index += 1) {
    const wordWeight = estimateSpeechWordWeight(words[index]);
    const nextWeight = accumulatedWeight + wordWeight;

    if (progressWeight <= nextWeight) {
      return {
        wordIndex: index,
        wordProgress: Math.max(
          0,
          Math.min(1, (progressWeight - accumulatedWeight) / wordWeight),
        ),
      };
    }

    accumulatedWeight = nextWeight;
  }

  return {
    wordIndex: Math.max(0, words.length - 1),
    wordProgress: words.length === 0 ? 0 : 1,
  };
}

export function estimateSpeechWordWeight(word: string): number {
  const normalizedLength = Math.max(1, normalizeSpeechToken(word).length);

  return Math.min(2.35, Math.max(0.72, normalizedLength / 5));
}

export function wordPositionFromTimings(
  words: readonly {
    readonly startMs: number;
    readonly endMs: number;
  }[],
  speechTimeMs: number,
): SpeechGuidePosition {
  if (words.length === 0) {
    return { wordIndex: 0, wordProgress: 0 };
  }

  const boundedTime = Math.max(0, speechTimeMs);
  const wordIndex = words.findIndex((word) => boundedTime <= word.endMs);
  const resolvedIndex = wordIndex === -1 ? words.length - 1 : wordIndex;
  const word = words[resolvedIndex];
  const durationMs = Math.max(1, word.endMs - word.startMs);

  return {
    wordIndex: resolvedIndex,
    wordProgress: Math.max(
      0,
      Math.min(1, (boundedTime - word.startMs) / durationMs),
    ),
  };
}

function estimateRecognizedWordProgress(
  expected: string,
  actual: string,
): number {
  if (expected.length === 0 || actual.length === 0) {
    return 0;
  }

  if (expected === actual || actual.startsWith(expected)) {
    return 1;
  }

  if (expected.startsWith(actual)) {
    return Math.max(0.12, Math.min(0.96, actual.length / expected.length));
  }

  return 0.82;
}

export function createTranscriptPreview(transcript: string): string {
  const tokens = transcript.trim().split(/\s+/).filter(Boolean).slice(-10);

  return tokens.length === 0 ? "" : tokens.join(" ");
}
