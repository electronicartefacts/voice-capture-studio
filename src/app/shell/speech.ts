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
  readonly resultIndex?: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike | undefined;
  };
};

export type SpeechRecognitionErrorLike = {
  readonly error?: string;
};

export type SpeechRecognitionPhraseLike = {
  readonly boost: number;
  readonly phrase: string;
};

export type FreeCaptureTranscript = {
  readonly schemaVersion: "voice.free_transcript.v1";
  /** Browser recognition is optional and may use a browser-managed service. */
  readonly engine: "browser_speech_recognition" | "unavailable";
  readonly status:
    "detected" | "candidate-sung" | "no-final-words" | "unavailable";
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
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  phrases?: SpeechRecognitionPhraseLike[];
  processLocally?: boolean;
  abort: () => void;
  start: () => void;
  stop: () => void;
};
export type SpeechRecognitionAvailability =
  "available" | "downloadable" | "downloading" | "unavailable";
export type SpeechRecognitionConstructor = {
  new (): SpeechRecognitionLike;
  available?: (options: {
    readonly langs: readonly string[];
    readonly processLocally: boolean;
  }) => Promise<SpeechRecognitionAvailability>;
};
export type SpeechRecognitionPhraseConstructor = new (
  phrase: string,
  boost?: number,
) => SpeechRecognitionPhraseLike;
export type WindowWithSpeechRecognition = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognitionPhrase?: SpeechRecognitionPhraseConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

export type SpeechRecognitionSession = {
  readonly committedFinalText: string;
  readonly currentDisplayText: string;
  readonly currentFinalText: string;
};

export type SpeechTranscriptSelection = {
  readonly promptWords?: readonly string[];
};
export function formatSpeechRecognitionLanguage(
  language: LanguageCode,
): string {
  return language === "fr" ? "fr-FR" : "en-US";
}

export async function isOnDeviceSpeechRecognitionReady(
  Constructor: SpeechRecognitionConstructor | undefined,
  locale: string,
): Promise<boolean> {
  if (Constructor?.available === undefined) {
    return false;
  }

  try {
    return (
      (await Constructor.available({
        langs: [locale],
        processLocally: true,
      })) === "available"
    );
  } catch {
    return false;
  }
}

export function extractSpeechRecognitionTranscript(
  event: SpeechRecognitionEventLike,
  selection: SpeechTranscriptSelection = {},
): string {
  return extractSpeechRecognitionTranscriptByFinality(event, false, selection);
}

/**
 * Keeps transient browser hypotheses on screen, but never serializes them as
 * capture evidence. Browsers resend prior final results with each event, so
 * rebuilding this string from the full result list also avoids duplicates.
 */
export function extractFinalSpeechRecognitionTranscript(
  event: SpeechRecognitionEventLike,
  selection: SpeechTranscriptSelection = {},
): string {
  return extractSpeechRecognitionTranscriptByFinality(event, true, selection);
}

/**
 * Maintains one serializable hypothesis per browser result/alternative. Final
 * results keep their first observed timestamp when browsers replay them.
 */
export function mergeSpeechRecognitionHypotheses(
  previous: readonly BrowserAsrHypothesis[],
  event: SpeechRecognitionEventLike,
  capturedAtMs: number,
  resultIndexOffset = 0,
): readonly BrowserAsrHypothesis[] {
  const previousByKey = new Map(
    previous.map((hypothesis) => [
      `${hypothesis.resultIndex}:${hypothesis.alternativeIndex}`,
      hypothesis,
    ]),
  );
  const next: BrowserAsrHypothesis[] = previous.filter(
    (hypothesis) => hypothesis.resultIndex < resultIndexOffset,
  );

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

      const absoluteResultIndex = resultIndexOffset + resultIndex;
      const key = `${absoluteResultIndex}:${alternativeIndex}`;
      const prior = previousByKey.get(key);
      next.push({
        resultIndex: absoluteResultIndex,
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
  selection: SpeechTranscriptSelection,
): string {
  const segments: string[] = [];

  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcript =
      result === undefined
        ? undefined
        : selectRecognitionAlternative(result, segments, selection);

    if (transcript !== undefined && (!finalOnly || result?.isFinal === true)) {
      segments.push(transcript);
    }
  }

  return segments.join(" ").trim();
}

function selectRecognitionAlternative(
  result: SpeechRecognitionResultLike,
  priorSegments: readonly string[],
  selection: SpeechTranscriptSelection,
): string | undefined {
  const alternatives = Array.from(
    { length: result.length },
    (_, index) => result[index],
  ).filter(
    (alternative): alternative is SpeechRecognitionAlternativeLike =>
      alternative !== undefined && alternative.transcript.trim().length > 0,
  );

  if (alternatives.length <= 1 || selection.promptWords === undefined) {
    return alternatives[0]?.transcript;
  }

  const priorText = priorSegments.join(" ");

  return alternatives
    .map((alternative, alternativeIndex) => {
      const detail = alignTranscriptToPromptDetailed(
        selection.promptWords ?? [],
        `${priorText} ${alternative.transcript}`,
      );
      const confidence = normalizeRecognitionConfidence(alternative.confidence);

      return {
        alternative,
        alternativeIndex,
        score: detail.score * 0.68 + detail.coverage * 0.27 + confidence * 0.05,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.alternativeIndex - right.alternativeIndex,
    )[0]?.alternative.transcript;
}

function normalizeRecognitionConfidence(value: number): number {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.5;
}

export function createSpeechRecognitionSession(): SpeechRecognitionSession {
  return {
    committedFinalText: "",
    currentDisplayText: "",
    currentFinalText: "",
  };
}

export function updateSpeechRecognitionSession(
  session: SpeechRecognitionSession,
  event: SpeechRecognitionEventLike,
  selection: SpeechTranscriptSelection = {},
): SpeechRecognitionSession {
  return {
    ...session,
    currentDisplayText: extractSpeechRecognitionTranscript(event, selection),
    currentFinalText: extractFinalSpeechRecognitionTranscript(event, selection),
  };
}

export function commitSpeechRecognitionSession(
  session: SpeechRecognitionSession,
): SpeechRecognitionSession {
  return {
    committedFinalText: mergeSpeechTranscriptSegments(
      session.committedFinalText,
      session.currentFinalText,
    ),
    currentDisplayText: "",
    currentFinalText: "",
  };
}

export function getSpeechRecognitionDisplayText(
  session: SpeechRecognitionSession,
): string {
  return mergeSpeechTranscriptSegments(
    session.committedFinalText,
    session.currentDisplayText,
  );
}

export function getSpeechRecognitionFinalText(
  session: SpeechRecognitionSession,
): string {
  return mergeSpeechTranscriptSegments(
    session.committedFinalText,
    session.currentFinalText,
  );
}

export function mergeSpeechTranscriptSegments(
  committedText: string,
  nextText: string,
): string {
  const committedWords = committedText.trim().split(/\s+/).filter(Boolean);
  const nextWords = nextText.trim().split(/\s+/).filter(Boolean);

  if (committedWords.length === 0) {
    return nextWords.join(" ");
  }

  if (nextWords.length === 0) {
    return committedWords.join(" ");
  }

  const maximumOverlap = Math.min(12, committedWords.length, nextWords.length);
  let overlap = 0;

  for (let length = maximumOverlap; length > 0; length -= 1) {
    const committedTail = committedWords
      .slice(-length)
      .map(normalizeSpeechToken);
    const nextHead = nextWords.slice(0, length).map(normalizeSpeechToken);

    if (
      committedTail.every(
        (word, index) => word.length > 0 && word === nextHead[index],
      )
    ) {
      overlap = length;
      break;
    }
  }

  return [...committedWords, ...nextWords.slice(overlap)].join(" ");
}

export function createSpeechRecognitionBiasPhrases(
  promptWords: readonly string[],
  PhraseConstructor: SpeechRecognitionPhraseConstructor | undefined,
): readonly SpeechRecognitionPhraseLike[] {
  if (PhraseConstructor === undefined || promptWords.length === 0) {
    return [];
  }

  const phrases = new Map<string, number>();
  const prompt = promptWords.join(" ").trim();

  if (prompt.length <= 180) {
    phrases.set(prompt, 4.5);
  }

  for (let index = 0; index < promptWords.length; index += 1) {
    const word = promptWords[index];

    if (normalizeSpeechToken(word).length >= 5) {
      phrases.set(word, 3.2);
    }

    const pair = promptWords.slice(index, index + 2).join(" ");

    if (pair.includes(" ")) {
      phrases.set(pair, 2.4);
    }
  }

  return Array.from(phrases)
    .slice(0, 48)
    .map(([phrase, boost]) => new PhraseConstructor(phrase, boost));
}

export function createFreeCaptureTranscript(input: {
  readonly finalTranscript: string;
  readonly performanceKind?:
    "spoken" | "sung" | "sung_candidate" | "undetermined";
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
      : (input.performanceKind === "sung" ||
            input.performanceKind === "sung_candidate") &&
          words.length > 0
        ? "candidate-sung"
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

export type SpeechPromptAlignment = {
  readonly coverage: number;
  readonly matchedWordCount: number;
  readonly position: SpeechGuidePosition;
  readonly score: number;
};

export function alignTranscriptToPromptPosition(
  promptWords: readonly string[],
  transcript: string,
): SpeechGuidePosition {
  return alignTranscriptToPromptDetailed(promptWords, transcript).position;
}

/**
 * Sequence alignment tolerates omissions, ASR insertions, repeated words and
 * revisions. Unlike the former greedy cursor it evaluates the complete path,
 * so one bad hypothesis cannot permanently shift every following word.
 */
export function alignTranscriptToPromptDetailed(
  promptWords: readonly string[],
  transcript: string,
): SpeechPromptAlignment {
  const promptTokens = promptWords.map(normalizeSpeechToken);
  const spokenTokens = tokenizeSpeech(transcript);

  if (spokenTokens.length === 0 || promptTokens.length === 0) {
    return {
      coverage: 0,
      matchedWordCount: 0,
      position: { wordIndex: 0, wordProgress: 0 },
      score: 0,
    };
  }

  const rowCount = promptTokens.length + 1;
  const columnCount = spokenTokens.length + 1;
  const scores = Array.from({ length: rowCount }, () =>
    new Array<number>(columnCount).fill(Number.NEGATIVE_INFINITY),
  );
  const operations = Array.from({ length: rowCount }, () =>
    new Array<"match" | "skip-prompt" | "skip-spoken" | null>(columnCount).fill(
      null,
    ),
  );

  scores[0][0] = 0;

  for (let promptIndex = 1; promptIndex < rowCount; promptIndex += 1) {
    scores[promptIndex][0] = scores[promptIndex - 1][0] - 0.34;
    operations[promptIndex][0] = "skip-prompt";
  }

  for (let spokenIndex = 1; spokenIndex < columnCount; spokenIndex += 1) {
    scores[0][spokenIndex] = scores[0][spokenIndex - 1] - 0.58;
    operations[0][spokenIndex] = "skip-spoken";
  }

  for (let promptIndex = 1; promptIndex < rowCount; promptIndex += 1) {
    for (let spokenIndex = 1; spokenIndex < columnCount; spokenIndex += 1) {
      const similarity = speechTokenSimilarity(
        promptTokens[promptIndex - 1],
        spokenTokens[spokenIndex - 1],
      );
      const matchScore =
        scores[promptIndex - 1][spokenIndex - 1] +
        (similarity >= 0.5 ? 0.35 + similarity : -0.82);
      const skipPromptScore = scores[promptIndex - 1][spokenIndex] - 0.34;
      const skipSpokenScore = scores[promptIndex][spokenIndex - 1] - 0.58;

      if (matchScore >= skipPromptScore && matchScore >= skipSpokenScore) {
        scores[promptIndex][spokenIndex] = matchScore;
        operations[promptIndex][spokenIndex] = "match";
      } else if (skipPromptScore >= skipSpokenScore) {
        scores[promptIndex][spokenIndex] = skipPromptScore;
        operations[promptIndex][spokenIndex] = "skip-prompt";
      } else {
        scores[promptIndex][spokenIndex] = skipSpokenScore;
        operations[promptIndex][spokenIndex] = "skip-spoken";
      }
    }
  }

  let endPromptIndex = 0;

  for (let promptIndex = 1; promptIndex < rowCount; promptIndex += 1) {
    if (
      scores[promptIndex][spokenTokens.length] >=
      scores[endPromptIndex][spokenTokens.length]
    ) {
      endPromptIndex = promptIndex;
    }
  }

  let promptIndex = endPromptIndex;
  let spokenIndex = spokenTokens.length;
  let matchedWordCount = 0;
  let similaritySum = 0;
  let lastMatch:
    { readonly promptIndex: number; readonly spokenToken: string } | undefined;

  while (promptIndex > 0 || spokenIndex > 0) {
    const operation = operations[promptIndex][spokenIndex];

    if (operation === "match") {
      const expected = promptTokens[promptIndex - 1];
      const actual = spokenTokens[spokenIndex - 1];
      const similarity = speechTokenSimilarity(expected, actual);

      if (similarity >= 0.5) {
        matchedWordCount += 1;
        similaritySum += similarity;
        lastMatch ??= { promptIndex: promptIndex - 1, spokenToken: actual };
      }

      promptIndex -= 1;
      spokenIndex -= 1;
    } else if (operation === "skip-prompt") {
      promptIndex -= 1;
    } else if (operation === "skip-spoken") {
      spokenIndex -= 1;
    } else {
      break;
    }
  }

  const resolvedMatch = lastMatch ?? { promptIndex: 0, spokenToken: "" };
  const expectedToken = promptTokens[resolvedMatch.promptIndex] ?? "";
  const precision = similaritySum / Math.max(1, spokenTokens.length);
  const coverage = matchedWordCount / Math.max(1, promptTokens.length);

  return {
    coverage,
    matchedWordCount,
    position: {
      wordIndex: Math.min(promptWords.length - 1, resolvedMatch.promptIndex),
      wordProgress: estimateRecognizedWordProgress(
        expectedToken,
        resolvedMatch.spokenToken,
      ),
    },
    score: precision,
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

function speechTokenSimilarity(expected: string, actual: string): number {
  if (expected === actual) {
    return 1;
  }

  if (expected.length === 0 || actual.length === 0) {
    return 0;
  }

  if (expected.startsWith(actual) || actual.startsWith(expected)) {
    return Math.max(
      0.5,
      Math.min(expected.length, actual.length) /
        Math.max(expected.length, actual.length),
    );
  }

  const maximumLength = Math.max(expected.length, actual.length);
  const maximumDistance = Math.max(2, Math.ceil(maximumLength * 0.45));
  const distance = levenshteinDistance(expected, actual, maximumDistance);

  return distance > maximumDistance
    ? 0
    : Math.max(0, 1 - distance / maximumLength);
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
