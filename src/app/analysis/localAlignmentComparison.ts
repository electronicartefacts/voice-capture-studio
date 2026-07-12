import type { WordPhonemeAlignment } from "@domains/phonetics";
import type { WhisperWordTiming } from "./types";

export type LocalAlignmentComparison = {
  readonly schemaVersion: "voice.local_alignment_comparison.v1";
  readonly status: "strong" | "acceptable" | "review" | "insufficient";
  readonly reviewRequired: boolean;
  readonly matchedWordCount: number;
  readonly expectedWordCount: number;
  readonly whisperWordCount: number;
  readonly matchRate: number;
  readonly medianBoundaryDeltaMs: number | null;
  readonly maximumBoundaryDeltaMs: number | null;
  readonly words: readonly {
    readonly word: string;
    readonly expectedIndex: number;
    readonly whisperIndex: number;
    readonly estimatedStartMs: number;
    readonly estimatedEndMs: number;
    readonly whisperStartMs: number;
    readonly whisperEndMs: number;
    readonly boundaryDeltaMs: number;
  }[];
};

export function compareLocalWordAlignments(input: {
  readonly estimatedWords: readonly WordPhonemeAlignment[];
  readonly whisperWords: readonly WhisperWordTiming[];
}): LocalAlignmentComparison {
  const pairs = alignMatchingWords(input.estimatedWords, input.whisperWords);
  const words = pairs.map(({ estimatedIndex, whisperIndex }) => {
    const estimated = input.estimatedWords[estimatedIndex];
    const whisper = input.whisperWords[whisperIndex];
    return {
      word: estimated.word,
      expectedIndex: estimatedIndex,
      whisperIndex,
      estimatedStartMs: estimated.startMs,
      estimatedEndMs: estimated.endMs,
      whisperStartMs: whisper.startMs,
      whisperEndMs: whisper.endMs,
      boundaryDeltaMs: Math.max(
        Math.abs(estimated.startMs - whisper.startMs),
        Math.abs(estimated.endMs - whisper.endMs),
      ),
    };
  });
  const deltas = words.map((word) => word.boundaryDeltaMs);
  const matchRate = round(
    pairs.length /
      Math.max(input.estimatedWords.length, input.whisperWords.length, 1),
  );
  const medianBoundaryDeltaMs =
    deltas.length === 0 ? null : Math.round(median(deltas));
  const maximumBoundaryDeltaMs =
    deltas.length === 0 ? null : Math.max(...deltas);
  const status =
    matchRate < 0.7 || medianBoundaryDeltaMs === null
      ? "insufficient"
      : medianBoundaryDeltaMs <= 80
        ? "strong"
        : medianBoundaryDeltaMs <= 180
          ? "acceptable"
          : "review";

  return {
    schemaVersion: "voice.local_alignment_comparison.v1",
    status,
    reviewRequired: status === "review" || status === "insufficient",
    matchedWordCount: pairs.length,
    expectedWordCount: input.estimatedWords.length,
    whisperWordCount: input.whisperWords.length,
    matchRate,
    medianBoundaryDeltaMs,
    maximumBoundaryDeltaMs,
    words,
  };
}

function alignMatchingWords(
  estimated: readonly WordPhonemeAlignment[],
  whisper: readonly WhisperWordTiming[],
): readonly { estimatedIndex: number; whisperIndex: number }[] {
  const rows = estimated.length + 1;
  const columns = whisper.length + 1;
  const scores = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0),
  );

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const matches =
        normalize(estimated[row - 1].word) ===
        normalize(whisper[column - 1].word);
      scores[row][column] = matches
        ? scores[row - 1][column - 1] + 1
        : Math.max(scores[row - 1][column], scores[row][column - 1]);
    }
  }

  const pairs: { estimatedIndex: number; whisperIndex: number }[] = [];
  let row = estimated.length;
  let column = whisper.length;
  while (row > 0 && column > 0) {
    if (
      normalize(estimated[row - 1].word) === normalize(whisper[column - 1].word)
    ) {
      pairs.push({ estimatedIndex: row - 1, whisperIndex: column - 1 });
      row -= 1;
      column -= 1;
    } else if (scores[row - 1][column] >= scores[row][column - 1]) {
      row -= 1;
    } else {
      column -= 1;
    }
  }
  return pairs.reverse();
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9']/g, "");
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
