import type { PromptDefinition } from "@domains/corpus";
import type { LanguageCode } from "@shared/index";

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
  const segments: string[] = [];

  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcript = result?.[0]?.transcript;

    if (transcript !== undefined) {
      segments.push(transcript);
    }
  }

  return segments.join(" ").trim();
}

export function alignTranscriptToPrompt(
  promptWords: readonly string[],
  transcript: string,
): number {
  const promptTokens = promptWords.map(normalizeSpeechToken);
  const spokenTokens = tokenizeSpeech(transcript);
  let cursor = 0;
  let bestMatchIndex = 0;

  if (spokenTokens.length === 0 || promptTokens.length === 0) {
    return 0;
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
    cursor = matchIndex + 1;
  }

  return Math.min(promptWords.length - 1, bestMatchIndex);
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
  let accumulatedWeight = 0;

  for (let index = 0; index < words.length; index += 1) {
    accumulatedWeight += estimateSpeechWordWeight(words[index]);

    if (progressWeight <= accumulatedWeight) {
      return index;
    }
  }

  return Math.max(0, words.length - 1);
}

export function estimateSpeechWordWeight(word: string): number {
  const normalizedLength = Math.max(1, normalizeSpeechToken(word).length);

  return Math.min(2.35, Math.max(0.72, normalizedLength / 5));
}

export function createTranscriptPreview(transcript: string): string {
  const tokens = transcript.trim().split(/\s+/).filter(Boolean).slice(-10);

  return tokens.length === 0 ? "" : tokens.join(" ");
}
