import type { LanguageCode } from "@shared/index";
import type {
  PhonemeInterval,
  PromptPhonemeAlignment,
  TranscriptMatchEstimate,
  TranscriptToken,
  WordPhonemeAlignment,
} from "./types";

const TOKEN_PATTERN = /[\p{L}\p{N}]+(?:['.-][\p{L}\p{N}]+)*/gu;
const ASCII_APOSTROPHE_PATTERN = /[`´‘’]/g;
const COMBINING_MARK_PATTERN = /[\u0300-\u036f]/g;
const FR_VOWEL_PATTERN = /(?:eau|au|ou|oi|ui|eu|oeu|ai|ei|[aeiouy])/g;
const EN_VOWEL_PATTERN =
  /(?:ough|igh|air|ear|ee|ea|oo|ou|ow|oy|oi|ay|ai|a_e|e_e|i_e|o_e|u_e|[aeiouy])/g;

export function alignPromptToPhonemes(input: {
  readonly activitySegments?: readonly {
    readonly startMs: number;
    readonly endMs: number;
  }[];
  readonly durationMs: number;
  readonly language: LanguageCode;
  readonly text: string;
}): PromptPhonemeAlignment {
  const tokens = tokenizeTranscript(input.text);
  const wordsWithPhones = tokens.map((token) => {
    const phonemes =
      input.language === "fr"
        ? estimateFrenchPhonemes(token.normalized)
        : estimateEnglishPhonemes(token.normalized);

    return {
      token,
      phonemes,
      confidence: estimateTokenConfidence(token.normalized, phonemes),
      syllableCount: estimateSyllableCount(token.normalized, input.language),
      pauseWeight: getTrailingPauseWeight(input.text, token.endChar),
    };
  });
  const totalWeight = wordsWithPhones.reduce(
    (total, item) =>
      total +
      Math.max(1, item.phonemes.length) +
      item.syllableCount * 0.45 +
      item.pauseWeight,
    0,
  );
  const activityTimeline = createActivityTimeline(
    input.activitySegments,
    input.durationMs,
  );
  const alignmentDurationMs =
    activityTimeline.length === 0
      ? input.durationMs
      : activityTimeline.reduce(
          (total, segment) => total + segment.endMs - segment.startMs,
          0,
        );
  let cursorMs = 0;
  const words: WordPhonemeAlignment[] = [];
  const allPhonemes: PhonemeInterval[] = [];

  for (const item of wordsWithPhones) {
    const wordWeight =
      Math.max(1, item.phonemes.length) +
      item.syllableCount * 0.45 +
      item.pauseWeight;
    const virtualStartMs = cursorMs;
    const virtualEndMs =
      cursorMs + (alignmentDurationMs * wordWeight) / Math.max(totalWeight, 1);
    const startMs = mapActivityTimeToCaptureTime(
      virtualStartMs,
      activityTimeline,
      input.durationMs,
    );
    const endMs = mapActivityTimeToCaptureTime(
      virtualEndMs,
      activityTimeline,
      input.durationMs,
    );
    const phonemeIntervals = createPhonemeIntervals({
      confidence: item.confidence,
      endMs,
      phonemes: item.phonemes,
      source: "local_grapheme_phoneme_estimate",
      startMs,
      wordIndex: item.token.index,
    });

    allPhonemes.push(...phonemeIntervals);
    words.push({
      tokenIndex: item.token.index,
      word: item.token.text,
      normalized: item.token.normalized,
      startChar: item.token.startChar,
      endChar: item.token.endChar,
      startMs,
      endMs,
      confidence: item.confidence,
      syllableCount: item.syllableCount,
      phonemes: phonemeIntervals,
    });
    cursorMs = virtualEndMs;
  }

  const finalBoundaryMs = activityTimeline.at(-1)?.endMs ?? input.durationMs;
  const boundedWords = closeFinalBoundary(words, finalBoundaryMs);
  const boundedPhonemes = boundedWords.flatMap((word) => word.phonemes);

  return {
    schemaVersion: "voice.phoneme_alignment.v1",
    language: input.language,
    source: "local_grapheme_phoneme_estimate",
    dictionary: "rule_based_fr_en_v1",
    durationMs: input.durationMs,
    confidence: roundScore(
      average(boundedWords.map((word) => word.confidence)),
    ),
    forcedAlignmentRequired: true,
    tokens,
    words: boundedWords,
    phonemes: boundedPhonemes,
    inventory: Array.from(
      new Set(boundedPhonemes.map((phoneme) => phoneme.phoneme)),
    ).sort(),
    warnings: [
      ...createAlignmentWarnings(input.text, tokens, boundedWords),
      ...(activityTimeline.length > 0
        ? ["timing_constrained_to_recorded_speech_activity"]
        : []),
    ],
  };
}

function createActivityTimeline(
  segments:
    readonly { readonly startMs: number; readonly endMs: number }[] | undefined,
  durationMs: number,
): readonly { readonly startMs: number; readonly endMs: number }[] {
  const normalized = (segments ?? [])
    .map((segment) => ({
      startMs: Math.max(0, Math.min(durationMs, Math.round(segment.startMs))),
      endMs: Math.max(0, Math.min(durationMs, Math.round(segment.endMs))),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((left, right) => left.startMs - right.startMs);
  const merged: { startMs: number; endMs: number }[] = [];

  for (const segment of normalized) {
    const previous = merged.at(-1);

    // Energy VAD commonly opens tiny gaps inside a syllable. Joining those
    // gaps avoids forcing word boundaries into plosives while preserving real
    // pauses between phrases.
    if (previous !== undefined && segment.startMs - previous.endMs <= 120) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}

function mapActivityTimeToCaptureTime(
  activityTimeMs: number,
  timeline: readonly { readonly startMs: number; readonly endMs: number }[],
  durationMs: number,
): number {
  if (timeline.length === 0) {
    return Math.round(Math.max(0, Math.min(durationMs, activityTimeMs)));
  }

  let remainingMs = Math.max(0, activityTimeMs);

  for (const segment of timeline) {
    const segmentDurationMs = segment.endMs - segment.startMs;

    if (remainingMs <= segmentDurationMs) {
      return Math.round(segment.startMs + remainingMs);
    }

    remainingMs -= segmentDurationMs;
  }

  return timeline.at(-1)?.endMs ?? durationMs;
}

export function tokenizeTranscript(text: string): readonly TranscriptToken[] {
  const tokens: TranscriptToken[] = [];

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const rawText = match[0];
    const startChar = match.index ?? 0;
    const normalized = normalizeToken(rawText);

    if (normalized.length === 0) {
      continue;
    }

    tokens.push({
      index: tokens.length,
      text: rawText,
      normalized,
      startChar,
      endChar: startChar + rawText.length,
    });
  }

  return tokens;
}

export function estimateTranscriptMatch(input: {
  readonly expectedText: string;
  readonly observedText?: string;
}): TranscriptMatchEstimate {
  const expectedTokens = tokenizeTranscript(input.expectedText).map(
    (token) => token.normalized,
  );
  const observedTokens = tokenizeTranscript(input.observedText ?? "").map(
    (token) => token.normalized,
  );

  if (observedTokens.length === 0) {
    return {
      score: 0,
      source: "prompt_only",
      expectedTokens,
      observedTokens,
      missingTokens: [],
      extraTokens: [],
    };
  }

  const distance = levenshteinDistance(expectedTokens, observedTokens);
  const score = roundScore(
    1 - distance / Math.max(expectedTokens.length, observedTokens.length, 1),
  );
  const observedCounts = countTokens(observedTokens);
  const expectedCounts = countTokens(expectedTokens);
  const missingTokens = subtractTokenCounts(expectedCounts, observedCounts);
  const extraTokens = subtractTokenCounts(observedCounts, expectedCounts);

  return {
    score,
    source: "web_speech",
    expectedTokens,
    observedTokens,
    missingTokens,
    extraTokens,
  };
}

function estimateFrenchPhonemes(value: string): readonly string[] {
  const parts = value.split("'").filter(Boolean);

  if (parts.length > 1) {
    return parts.flatMap(estimateFrenchPhonemes);
  }

  const phonemes: string[] = [];
  let index = 0;

  while (index < value.length) {
    const remaining = value.slice(index);
    const rule = FR_RULES.find(([pattern]) => remaining.startsWith(pattern));

    if (rule !== undefined) {
      const [pattern, phone] = rule;

      if (phone !== null) {
        phonemes.push(phone);
      }

      index += pattern.length;
      continue;
    }

    const character = value[index];
    const fallback = FR_SINGLE_PHONES[character];

    if (fallback !== undefined) {
      phonemes.push(fallback);
    }

    index += 1;
  }

  return phonemes.length > 0 ? phonemes : ["spn"];
}

function estimateEnglishPhonemes(value: string): readonly string[] {
  const normalized = value.replace(/([aeiou])e$/u, "$1");
  const phonemes: string[] = [];
  let index = 0;

  while (index < normalized.length) {
    const remaining = normalized.slice(index);
    const rule = EN_RULES.find(([pattern]) => remaining.startsWith(pattern));

    if (rule !== undefined) {
      const [pattern, phones] = rule;
      phonemes.push(...phones);
      index += pattern.length;
      continue;
    }

    const character = normalized[index];
    const fallback = EN_SINGLE_PHONES[character];

    if (fallback !== undefined) {
      phonemes.push(fallback);
    }

    index += 1;
  }

  return phonemes.length > 0 ? phonemes : ["SPN"];
}

function createPhonemeIntervals(input: {
  readonly confidence: number;
  readonly endMs: number;
  readonly phonemes: readonly string[];
  readonly source: PhonemeInterval["source"];
  readonly startMs: number;
  readonly wordIndex: number;
}): readonly PhonemeInterval[] {
  const weights = input.phonemes.map(getPhonemeDurationWeight);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const durationMs = Math.max(1, input.endMs - input.startMs);
  let cursorMs = input.startMs;

  return input.phonemes.map((phoneme, index) => {
    const startMs = Math.round(cursorMs);
    const endMs =
      index === input.phonemes.length - 1
        ? input.endMs
        : Math.round(cursorMs + (durationMs * weights[index]) / totalWeight);

    cursorMs = endMs;

    return {
      phoneme,
      startMs,
      endMs,
      confidence: input.confidence,
      wordIndex: input.wordIndex,
      source: input.source,
    };
  });
}

function closeFinalBoundary(
  words: readonly WordPhonemeAlignment[],
  durationMs: number,
): readonly WordPhonemeAlignment[] {
  const lastWord = words.at(-1);

  if (lastWord === undefined || lastWord.endMs === durationMs) {
    return words;
  }

  return words.map((word, index) => {
    if (index !== words.length - 1) {
      return word;
    }

    const phonemes = word.phonemes.map((phoneme, phonemeIndex) =>
      phonemeIndex === word.phonemes.length - 1
        ? { ...phoneme, endMs: durationMs }
        : phoneme,
    );

    return { ...word, endMs: durationMs, phonemes };
  });
}

function normalizeToken(value: string): string {
  return value
    .replace(ASCII_APOSTROPHE_PATTERN, "'")
    .normalize("NFD")
    .replace(COMBINING_MARK_PATTERN, "")
    .toLowerCase()
    .replace(/[^a-z0-9'.-]+/g, "")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

function estimateSyllableCount(value: string, language: LanguageCode): number {
  const normalized = value.replace(/[^a-z]/g, "");
  const pattern = language === "fr" ? FR_VOWEL_PATTERN : EN_VOWEL_PATTERN;
  const matches = normalized.match(pattern) ?? [];

  if (language === "fr" && normalized.endsWith("e") && matches.length > 1) {
    return Math.max(1, matches.length - 1);
  }

  return Math.max(1, matches.length);
}

function estimateTokenConfidence(
  normalized: string,
  phonemes: readonly string[],
): number {
  const hasDigits = /\d/.test(normalized);
  const hasUnsupported = phonemes.some((phoneme) => phoneme === "spn");
  const hasComplexPunctuation = /[.-]/.test(normalized);
  let confidence = 0.82;

  if (hasDigits) {
    confidence -= 0.14;
  }

  if (hasUnsupported) {
    confidence -= 0.18;
  }

  if (hasComplexPunctuation) {
    confidence -= 0.05;
  }

  if (normalized.length <= 2) {
    confidence -= 0.03;
  }

  return roundScore(Math.max(0.45, confidence));
}

function getTrailingPauseWeight(text: string, endChar: number): number {
  const trailing = text.slice(endChar, endChar + 4);

  if (/[.!?]/.test(trailing)) {
    return 0.9;
  }

  if (/[,;:]/.test(trailing)) {
    return 0.42;
  }

  return 0;
}

function getPhonemeDurationWeight(phoneme: string): number {
  if (
    /^(a|aa|ae|ah|ao|aw|ay|eh|er|ey|ih|iy|oh|ow|oy|uh|uw|an|in|on|eu|oe|ou)$/i.test(
      phoneme,
    )
  ) {
    return 1.25;
  }

  if (/^(p|t|k|b|d|g|P|T|K|B|D|G)$/.test(phoneme)) {
    return 0.72;
  }

  if (/^(s|z|sh|zh|f|v|S|Z)$/.test(phoneme)) {
    return 1.05;
  }

  return 1;
}

function createAlignmentWarnings(
  text: string,
  tokens: readonly TranscriptToken[],
  words: readonly WordPhonemeAlignment[],
): readonly string[] {
  const warnings: string[] = [];

  if (tokens.length === 0 && text.trim().length > 0) {
    warnings.push("no_tokenizable_words");
  }

  if (words.some((word) => /\d/.test(word.normalized))) {
    warnings.push("number_normalization_requires_review");
  }

  if (words.some((word) => word.confidence < 0.7)) {
    warnings.push("low_confidence_grapheme_to_phoneme_estimate");
  }

  warnings.push("browser_alignment_is_text_derived_not_acoustic");

  return warnings;
}

function levenshteinDistance(
  left: readonly string[],
  right: readonly string[],
): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;

      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length] ?? 0;
}

function countTokens(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return counts;
}

function subtractTokenCounts(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): readonly string[] {
  const output: string[] = [];

  for (const [token, count] of left.entries()) {
    const remainder = count - (right.get(token) ?? 0);

    for (let index = 0; index < remainder; index += 1) {
      output.push(token);
    }
  }

  return output;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

const FR_RULES: readonly (readonly [string, string | null])[] = [
  ["eaux", "o"],
  ["eau", "o"],
  ["aux", "o"],
  ["au", "o"],
  ["ain", "in"],
  ["ein", "in"],
  ["aim", "in"],
  ["eim", "in"],
  ["ien", "in"],
  ["oin", "oin"],
  ["an", "an"],
  ["am", "an"],
  ["en", "an"],
  ["em", "an"],
  ["on", "on"],
  ["om", "on"],
  ["ou", "ou"],
  ["oi", "wa"],
  ["ui", "ui"],
  ["eu", "eu"],
  ["oeu", "eu"],
  ["ill", "j"],
  ["gn", "gn"],
  ["ch", "sh"],
  ["ph", "f"],
  ["th", "t"],
  ["qu", "k"],
  ["gu", "g"],
  ["ss", "s"],
  ["er", "e"],
  ["ez", "e"],
  ["es", "e"],
  ["ent", null],
];

const FR_SINGLE_PHONES: Record<string, string | undefined> = {
  a: "a",
  b: "b",
  c: "k",
  d: "d",
  e: "e",
  f: "f",
  g: "g",
  h: undefined,
  i: "i",
  j: "zh",
  k: "k",
  l: "l",
  m: "m",
  n: "n",
  o: "o",
  p: "p",
  q: "k",
  r: "r",
  s: "s",
  t: "t",
  u: "u",
  v: "v",
  w: "w",
  x: "ks",
  y: "i",
  z: "z",
};

const EN_RULES: readonly (readonly [string, readonly string[]])[] = [
  ["tion", ["SH", "AH", "N"]],
  ["sion", ["ZH", "AH", "N"]],
  ["ough", ["OW"]],
  ["igh", ["AY"]],
  ["air", ["EH", "R"]],
  ["ear", ["IH", "R"]],
  ["th", ["TH"]],
  ["sh", ["SH"]],
  ["ch", ["CH"]],
  ["ng", ["NG"]],
  ["ph", ["F"]],
  ["wh", ["W"]],
  ["ck", ["K"]],
  ["qu", ["K", "W"]],
  ["ee", ["IY"]],
  ["ea", ["IY"]],
  ["oo", ["UW"]],
  ["ou", ["AW"]],
  ["ow", ["AW"]],
  ["oy", ["OY"]],
  ["oi", ["OY"]],
  ["ay", ["EY"]],
  ["ai", ["EY"]],
  ["er", ["ER"]],
  ["ar", ["AA", "R"]],
  ["or", ["AO", "R"]],
];

const EN_SINGLE_PHONES: Record<string, string | undefined> = {
  a: "AE",
  b: "B",
  c: "K",
  d: "D",
  e: "EH",
  f: "F",
  g: "G",
  h: "HH",
  i: "IH",
  j: "JH",
  k: "K",
  l: "L",
  m: "M",
  n: "N",
  o: "AA",
  p: "P",
  q: "K",
  r: "R",
  s: "S",
  t: "T",
  u: "AH",
  v: "V",
  w: "W",
  x: "K S",
  y: "Y",
  z: "Z",
};
