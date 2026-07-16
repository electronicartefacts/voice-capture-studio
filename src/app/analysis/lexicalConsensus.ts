import type {
  assessLexicalSegmentation,
  SupportedWordTiming,
} from "./lexicalSegmentationQuality";
import type {
  LocalExecutionProvider,
  LocalDecodingStrategy,
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
  readonly decodingStrategy: LocalDecodingStrategy;
  readonly activityMaskApplied: boolean;
  readonly activityCoverage: number;
  readonly analysis: LocalTakeAnalysis;
  readonly assessment: ReturnType<typeof assessLexicalSegmentation>;
};

export type LexicalConsensus = {
  readonly selected: LexicalHypothesis;
  readonly acceptedTimings: readonly SupportedWordTiming[];
  readonly meanConfidence: number;
  readonly agreementRate: number;
  readonly recoveredWordCount: number;
  readonly rejectedSingletonCount: number;
  readonly fuzzyMatchedWordCount: number;
  readonly executionProviders: readonly LocalExecutionProvider[];
};

type Alignment = {
  readonly matches: ReadonlyMap<number, SupportedWordTiming>;
  readonly unmatched: readonly {
    readonly gapIndex: number;
    readonly timing: SupportedWordTiming;
  }[];
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
  const alignedHypotheses = hypotheses
    .filter((hypothesis) => hypothesis !== selected)
    .map((hypothesis) => ({
      hypothesis,
      alignment: alignWordSequences(
        selected.assessment.acceptedTimings,
        hypothesis.assessment.acceptedTimings,
      ),
    }));
  let agreedWords = 0;
  let confidenceTotal = 0;
  let rejectedSingletonCount = 0;
  let fuzzyMatchedWordCount = 0;
  const minimumVotes = hypotheses.length >= 3 ? 2 : 1;
  const anchorTimings = selected.assessment.acceptedTimings.flatMap(
    (timing, index) => {
      const matchingTimings = alignedHypotheses
        .map(({ alignment }) => alignment.matches.get(index))
        .filter((candidate): candidate is SupportedWordTiming =>
          Boolean(candidate),
        );
      const consensusVotes = 1 + matchingTimings.length;
      if (consensusVotes < minimumVotes) {
        rejectedSingletonCount += 1;
        return [];
      }
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
          mean(
            [timing, ...matchingTimings].map(
              ({ acousticSupport }) => acousticSupport,
            ),
          ) *
            0.25 +
          (selected.model === "base" ? 0.1 : 0.04),
      );

      fuzzyMatchedWordCount += matchingTimings.filter(
        (candidate) =>
          normalizeWord(candidate.word) !== normalizeWord(timing.word),
      ).length;

      if (matchingTimings.length > 0) agreedWords += 1;
      confidenceTotal += confidence;

      return [
        {
          ...timing,
          word: chooseConsensusWord(timing, matchingTimings),
          startMs: Math.max(0, Math.round(startMs)),
          endMs: Math.max(Math.round(startMs) + 1, Math.round(endMs)),
          acousticSupport: roundRate(
            mean(
              [timing, ...matchingTimings].map(
                ({ acousticSupport }) => acousticSupport,
              ),
            ),
          ),
          evidence:
            matchingTimings.length > 0
              ? ("multi_pass_consensus" as const)
              : timing.evidence,
          confidence,
          consensusVotes,
        },
      ];
    },
  );

  const recoveredTimings = recoverSharedInsertions(
    alignedHypotheses,
    hypotheses.length,
  );
  for (const timing of recoveredTimings) {
    confidenceTotal += timing.confidence ?? 0;
    agreedWords += 1;
  }

  const acceptedTimings = resolveTimingOverlaps(
    [...anchorTimings, ...recoveredTimings].sort(
      (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
    ),
  );

  return {
    selected,
    acceptedTimings,
    meanConfidence: roundRate(
      confidenceTotal / Math.max(acceptedTimings.length, 1),
    ),
    agreementRate: roundRate(agreedWords / Math.max(acceptedTimings.length, 1)),
    recoveredWordCount: recoveredTimings.length,
    rejectedSingletonCount,
    fuzzyMatchedWordCount,
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
): Alignment {
  const left = reference.map((timing) => normalizeWord(timing.word));
  const right = candidate.map((timing) => normalizeWord(timing.word));
  const table = createLcsTable(left, right, (leftIndex, rightIndex) =>
    timingsAreCompatible(reference[leftIndex], candidate[rightIndex]),
  );
  const aligned = new Map<number, SupportedWordTiming>();
  const matchedCandidateIndexes = new Set<number>();
  let leftIndex = left.length;
  let rightIndex = right.length;

  while (leftIndex > 0 && rightIndex > 0) {
    if (
      timingsAreCompatible(
        reference[leftIndex - 1],
        candidate[rightIndex - 1],
      ) &&
      table[leftIndex][rightIndex] === table[leftIndex - 1][rightIndex - 1] + 1
    ) {
      aligned.set(leftIndex - 1, candidate[rightIndex - 1]);
      matchedCandidateIndexes.add(rightIndex - 1);
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

  const orderedMatches = [...aligned.entries()].sort(
    (leftMatch, rightMatch) => leftMatch[0] - rightMatch[0],
  );
  const unmatched = candidate.flatMap((timing, candidateIndex) => {
    if (matchedCandidateIndexes.has(candidateIndex)) return [];
    let gapIndex = reference.length;
    for (const [referenceIndex, matchedTiming] of orderedMatches) {
      const matchedCandidateIndex = candidate.indexOf(matchedTiming);
      if (matchedCandidateIndex > candidateIndex) {
        gapIndex = referenceIndex;
        break;
      }
    }
    return [{ gapIndex, timing }];
  });

  return { matches: aligned, unmatched };
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
    if (
      wordsAreCompatible(left[leftIndex - 1], right[rightIndex - 1]) &&
      table[leftIndex][rightIndex] === table[leftIndex - 1][rightIndex - 1] + 1
    ) {
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

function createLcsTable(
  left: readonly string[],
  right: readonly string[],
  compatible: (leftIndex: number, rightIndex: number) => boolean = (
    leftIndex,
    rightIndex,
  ) => wordsAreCompatible(left[leftIndex], right[rightIndex]),
) {
  const table = Array.from(
    { length: left.length + 1 },
    () => new Uint16Array(right.length + 1),
  );

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      table[leftIndex][rightIndex] = compatible(leftIndex - 1, rightIndex - 1)
        ? table[leftIndex - 1][rightIndex - 1] + 1
        : Math.max(
            table[leftIndex - 1][rightIndex],
            table[leftIndex][rightIndex - 1],
          );
    }
  }

  return table;
}

function recoverSharedInsertions(
  alignedHypotheses: readonly {
    readonly hypothesis: LexicalHypothesis;
    readonly alignment: Alignment;
  }[],
  hypothesisCount: number,
): readonly SupportedWordTiming[] {
  if (hypothesisCount < 3) return [];
  const clusters: Array<{
    readonly gapIndex: number;
    readonly members: Array<{
      readonly hypothesis: LexicalHypothesis;
      readonly timing: SupportedWordTiming;
    }>;
  }> = [];

  for (const { hypothesis, alignment } of alignedHypotheses) {
    for (const unmatched of alignment.unmatched) {
      const cluster = clusters.find(
        (candidate) =>
          candidate.gapIndex === unmatched.gapIndex &&
          !candidate.members.some(
            (member) => member.hypothesis === hypothesis,
          ) &&
          candidate.members.some((member) =>
            timingsAreCompatible(member.timing, unmatched.timing),
          ),
      );
      if (cluster === undefined) {
        clusters.push({
          gapIndex: unmatched.gapIndex,
          members: [{ hypothesis, timing: unmatched.timing }],
        });
      } else {
        cluster.members.push({ hypothesis, timing: unmatched.timing });
      }
    }
  }

  return clusters.flatMap(({ members }) => {
    if (members.length < 2) return [];
    const timings = members.map(({ timing }) => timing);
    const representative = members
      .slice()
      .sort(
        (left, right) =>
          hypothesisWeight(right.hypothesis) -
          hypothesisWeight(left.hypothesis),
      )[0].timing;
    const acousticSupport = roundRate(
      mean(timings.map((timing) => timing.acousticSupport)),
    );
    const agreement = members.length / hypothesisCount;
    const startMs = Math.max(
      0,
      Math.round(median(timings.map(({ startMs }) => startMs))),
    );
    return [
      {
        ...representative,
        word: chooseConsensusWord(
          representative,
          timings.filter((timing) => timing !== representative),
        ),
        startMs,
        endMs: Math.max(
          startMs + 1,
          Math.round(median(timings.map(({ endMs }) => endMs))),
        ),
        acousticSupport,
        evidence: "multi_pass_consensus" as const,
        confidence: roundRate(0.22 + agreement * 0.55 + acousticSupport * 0.23),
        consensusVotes: members.length,
      },
    ];
  });
}

function timingsAreCompatible(
  left: SupportedWordTiming,
  right: SupportedWordTiming,
): boolean {
  if (
    !wordsAreCompatible(normalizeWord(left.word), normalizeWord(right.word))
  ) {
    return false;
  }
  const leftMiddle = (left.startMs + left.endMs) / 2;
  const rightMiddle = (right.startMs + right.endMs) / 2;
  const tolerance = Math.max(
    450,
    Math.min(
      1_200,
      Math.max(left.endMs - left.startMs, right.endMs - right.startMs) * 1.5,
    ),
  );
  return Math.abs(leftMiddle - rightMiddle) <= tolerance;
}

function wordsAreCompatible(left: string, right: string): boolean {
  if (left === right) return left !== "";
  const longest = Math.max(left.length, right.length);
  const shortest = Math.min(left.length, right.length);
  if (shortest < 4 || longest - shortest > 2) return false;
  return 1 - editDistance(left, right) / longest >= (longest <= 5 ? 0.8 : 0.72);
}

function editDistance(left: string, right: string): number {
  const previous = new Uint16Array(right.length + 1);
  const current = new Uint16Array(right.length + 1);
  for (let index = 0; index <= right.length; index += 1)
    previous[index] = index;
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.set(current);
  }
  return previous[right.length];
}

function chooseConsensusWord(
  reference: SupportedWordTiming,
  candidates: readonly SupportedWordTiming[],
): string {
  const counts = new Map<string, { count: number; surface: string }>();
  for (const timing of [reference, ...candidates]) {
    const normalized = normalizeWord(timing.word);
    const current = counts.get(normalized);
    counts.set(normalized, {
      count: (current?.count ?? 0) + 1,
      surface: current?.surface ?? timing.word,
    });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count)[0]
    .surface;
}

function hypothesisWeight(hypothesis: LexicalHypothesis): number {
  return (
    (hypothesis.model === "base" ? 2 : 0) +
    (hypothesis.signal === "spectral_vocal" ? 1 : 0)
  );
}

function mean(values: readonly number[]): number {
  return (
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
  );
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
