import type {
  TimedTextDocument,
  TimedTextLine,
  TimedTextSource,
  TimedTextWord,
  TimedTextWordInput,
} from "./types";

const MAX_WORDS_PER_LINE = 10;
const MAX_LINE_DURATION_MS = 6_000;
const LINE_BREAK_GAP_MS = 700;

export function createTimedTextDocument(input: {
  readonly language: string;
  readonly source: TimedTextSource;
  readonly title?: string | null;
  readonly words: readonly TimedTextWordInput[];
}): TimedTextDocument | null {
  const words = normalizeTimedWords(input.words);
  if (words.length === 0) return null;

  return {
    schemaVersion: "voice.timed_text.v1",
    language: input.language,
    source: input.source,
    offsetMs: 0,
    title: normalizeTitle(input.title),
    lines: groupTimedTextLines(words),
  };
}

export function groupTimedTextLines(
  words: readonly TimedTextWord[],
): readonly TimedTextLine[] {
  const lines: TimedTextLine[] = [];
  let current: TimedTextWord[] = [];

  const flush = () => {
    const first = current[0];
    const last = current.at(-1);
    if (first === undefined || last === undefined) return;
    lines.push({
      text: joinWords(current.map((word) => word.text)),
      startMs: first.startMs,
      endMs: last.endMs,
      words: current,
    });
    current = [];
  };

  for (const word of words) {
    const first = current[0];
    const previous = current.at(-1);
    const shouldBreakBefore =
      first !== undefined &&
      previous !== undefined &&
      (current.length >= MAX_WORDS_PER_LINE ||
        word.startMs - first.startMs >= MAX_LINE_DURATION_MS ||
        word.startMs - previous.endMs >= LINE_BREAK_GAP_MS ||
        endsSentence(previous.text));

    if (shouldBreakBefore) flush();
    current.push(word);
  }
  flush();
  return lines;
}

export function normalizeTimedWords(
  input: readonly TimedTextWordInput[],
): readonly TimedTextWord[] {
  return input
    .flatMap((word) => {
      const text = word.word.replace(/\s+/gu, " ").trim();
      const startMs = Math.round(word.startMs);
      const endMs = Math.round(word.endMs);
      if (
        text.length === 0 ||
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        startMs < 0 ||
        endMs <= startMs
      ) {
        return [];
      }
      return [
        {
          text,
          startMs,
          endMs,
          confidence:
            word.confidence === undefined || word.confidence === null
              ? null
              : clamp(word.confidence, 0, 1),
        },
      ];
    })
    .sort(
      (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
    );
}

function endsSentence(word: string): boolean {
  return /[.!?…][\])}'\u201d\u00bb]*$/u.test(word);
}

function joinWords(words: readonly string[]): string {
  return words
    .join(" ")
    .replace(/\s+([,.;:!?…])/gu, "$1")
    .replace(/([\u2019'])\s+/gu, "$1")
    .trim();
}

function normalizeTitle(title?: string | null): string | null {
  const normalized = title?.replace(/\s+/gu, " ").trim() ?? "";
  return normalized.length === 0 ? null : normalized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
