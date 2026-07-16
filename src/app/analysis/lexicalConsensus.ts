import type {
  assessLexicalSegmentation,
  SupportedWordTiming,
} from "./lexicalSegmentationQuality";
import type {
  LocalExecutionProvider,
  LocalTakeAnalysis,
  LocalTranscriptionModel,
} from "./types";

export type LexicalHypothesisKind =
  | "original_tiny"
  | "original_base"
  | "vocal_focus_base"
  | "spectral_vocal_base";

export type LexicalHypothesis = {
  readonly kind: LexicalHypothesisKind;
  readonly model: LocalTranscriptionModel;
  readonly signal: "original" | "vocal_focus" | "spectral_vocal";
  readonly analysis: LocalTakeAnalysis;
  readonly assessment: ReturnType<typeof assessLexicalSegmentation>;
};

export type LexicalConsensus = {
  readonly selected: LexicalHypothesis;
  readonly acceptedTimings: readonly SupportedWordTiming[];
  readonly meanConfidence: number;
  readonly agreementRate: number;
  readonly executionProviders: readonly LocalExecutionProvider[];
};

export function buildLexicalConsensus(
  hypotheses: readonly LexicalHypothesis[],
): LexicalConsensus {
  if (hypotheses.length === 0) {
    throw new Error("Aucune hypothèse lexicale à comparer.");
  }

  const scored = hypotheses.map((hypothesis) => ({
    hypothesis,
    score: scoreHypothesis(hypothesis, hypotheses),
  }));
  scored.sort((left, right) => right.score - left.score);
  const selected = scored[0].hypothesis;
  const alignments = hypotheses
    .filter((hypothesis) => hypothesis !== selected)
    .map((hypothesis) =>
      alignWordSequences(
        selected.assessment.acceptedTimings,
        hypothesis.assessment.acceptedTimings,
      ),
    );
  let agreedWords = 0;
  let confidenceTotal = 0;
  const consensusTimings = selected.assessment.acceptedTimings.map(
    (timing, index) => {
      const matchingTimings = alignments
        .map((alignment) => alignment.get(index))
        .filter((candidate): candidate is SupportedWordTiming =>
          Boolean(candidate),
        );
      const consensusVotes = 1 + matchingTimings.length;
      const startMs = median([
        timing.startMs,
        ...matchingTimings.map((candidate) => candidate.startMs),
      ]);
      const endMs = median([
        timing.endMs,
        ...matchingTimings.map((candidate) => candidate.endMs),
      ]);
      const agreement =
        hypotheses.length === 1
          ? 0.5
          : matchingTimings.length / (hypotheses.length - 1);
      const confidence = roundRate(
        0.18 +
          agreement * 0.47 +
          timing.acousticSupport * 0.25 +
          (selected.model === "base" ? 0.1 : 0.04),
      );

      if (matchingTimings.length > 0) agreedWords += 1;
      confidenceTotal += confidence;

      return {
        ...timing,
        startMs: Math.max(0, Math.round(startMs)),
        endMs: Math.max(Math.round(startMs) + 1, Math.round(endMs)),
        evidence:
          matchingTimings.length > 0
            ? ("multi_pass_consensus" as const)
            : timing.evidence,
        confidence,
        consensusVotes,
      };
    },
  );

  const acceptedTimings = resolveTimingOverlaps(consensusTimings);

  return {
    selected,
    acceptedTimings,
    meanConfidence: roundRate(
      confidenceTotal / Math.max(acceptedTimings.length, 1),
    ),
    agreementRate: roundRate(agreedWords / Math.max(acceptedTimings.length, 1)),
    executionProviders: [
      ...new Set(hypotheses.map(({ analysis }) => analysis.executionProvider)),
    ],
  };
}

export function transcriptAgreement(left: string, right: string): number {
  const leftWords = tokenize(left);
  const rightWords = tokenize(right);
  if (leftWords.length === 0 || rightWords.length === 0) return 0;
  const shared = longestCommonSubsequence(leftWords, rightWords).length;
  return roundRate((2 * shared) / (leftWords.length + rightWords.length));
}

function scoreHypothesis(
  hypothesis: LexicalHypothesis,
  all: readonly LexicalHypothesis[],
): number {
  const words = hypothesis.assessment.acceptedTimings;
  if (words.length === 0) return -100;
  const normalizedWords = words.map((timing) => normalizeWord(timing.word));
  const agreement =
    all.length === 1
      ? 0.5
      : all
          .filter((candidate) => candidate !== hypothesis)
          .reduce(
            (sum, candidate) =>
              sum +
              transcriptAgreement(
                normalizedWords.join(" "),
                candidate.assessment.acceptedTimings
                  .map((timing) => timing.word)
                  .join(" "),
              ),
            0,
          ) /
        (all.length - 1);
  const repeatedRunPenalty = longestRepeatedRun(normalizedWords) >= 4 ? 1.2 : 0;
  const densityPenalty =
    hypothesis.assessment.quality.wordsPerSpeechMinute > 320 ? 1.4 : 0;

  return (
    agreement * 3.4 +
    hypothesis.assessment.quality.speechOverlapRate * 0.9 +
    hypothesis.assessment.quality.timingAcceptanceRate * 0.7 +
    (hypothesis.assessment.quality.status === "review" ? 0.65 : 0) +
    (hypothesis.model === "base" ? 0.35 : 0) +
    (hypothesis.signal === "spectral_vocal" ? 0.12 : 0) -
    repeatedRunPenalty -
    densityPenalty
  );
}

function resolveTimingOverlaps(
  timings: readonly SupportedWordTiming[],
): readonly SupportedWordTiming[] {
  const result = timings.map((timing) => ({ ...timing }));
  for (let index = 0; index < result.length - 1; index += 1) {
    const current = result[index];
    const next = result[index + 1];
    if (current.endMs <= next.startMs) continue;
    const boundary = Math.max(
      current.startMs + 1,
      Math.min(next.endMs - 1, Math.round((current.endMs + next.startMs) / 2)),
    );
    result[index] = { ...current, endMs: boundary };
    result[index + 1] = { ...next, startMs: boundary };
  }
  return result;
}

function alignWordSequences(
  reference: readonly SupportedWordTiming[],
  candidate: readonly SupportedWordTiming[],
): ReadonlyMap<number, SupportedWordTiming> {
  const left = reference.map((timing) => normalizeWord(timing.word));
  const right = candidate.map((timing) => normalizeWord(timing.word));
  const table = createLcsTable(left, right);
  const aligned = new Map<number, SupportedWordTiming>();
  let leftIndex = left.length;
  let rightIndex = right.length;

  while (leftIndex > 0 && rightIndex > 0) {
    if (left[leftIndex - 1] === right[rightIndex - 1]) {
      aligned.set(leftIndex - 1, candidate[rightIndex - 1]);
      leftIndex -= 1;
      rightIndex -= 1;
    } else if (
      table[leftIndex - 1][rightIndex] >= table[leftIndex][rightIndex - 1]
    ) {
      leftIndex -= 1;
    } else {
      rightIndex -= 1;
    }
  }

  return aligned;
}

function longestCommonSubsequence(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  const table = createLcsTable(left, right);
  const result: string[] = [];
  let leftIndex = left.length;
  let rightIndex = right.length;

  while (leftIndex > 0 && rightIndex > 0) {
    if (left[leftIndex - 1] === right[rightIndex - 1]) {
      result.push(left[leftIndex - 1]);
      leftIndex -= 1;
      rightIndex -= 1;
    } else if (
      table[leftIndex - 1][rightIndex] >= table[leftIndex][rightIndex - 1]
    ) {
      leftIndex -= 1;
    } else {
      rightIndex -= 1;
    }
  }

  return result.reverse();
}

function createLcsTable(left: readonly string[], right: readonly string[]) {
  const table = Array.from(
    { length: left.length + 1 },
    () => new Uint16Array(right.length + 1),
  );

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      table[leftIndex][rightIndex] =
        left[leftIndex - 1] === right[rightIndex - 1]
          ? table[leftIndex - 1][rightIndex - 1] + 1
          : Math.max(
              table[leftIndex - 1][rightIndex],
              table[leftIndex][rightIndex - 1],
            );
    }
  }

  return table;
}

function tokenize(value: string): readonly string[] {
  return value.split(/\s+/u).map(normalizeWord).filter(Boolean);
}

function normalizeWord(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function longestRepeatedRun(words: readonly string[]): number {
  let longest = 0;
  let current = 0;
  let previous = "";
  for (const word of words) {
    current = word !== "" && word === previous ? current + 1 : 1;
    previous = word;
    longest = Math.max(longest, current);
  }
  return longest;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function roundRate(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1_000) / 1_000;
}
