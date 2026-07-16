export type BenchmarkWord = {
  readonly word: string;
  readonly startMs?: number;
  readonly endMs?: number;
};

export type MusicPipelineBenchmarkResult = {
  readonly wordErrorRate: number;
  readonly characterErrorRate: number;
  readonly matchedWordRate: number;
  readonly boundaryMeanAbsoluteErrorMs: number | null;
  readonly insertionCount: number;
  readonly deletionCount: number;
  readonly substitutionCount: number;
};

export function evaluateMusicPipeline(input: {
  readonly reference: readonly BenchmarkWord[];
  readonly predicted: readonly BenchmarkWord[];
}): MusicPipelineBenchmarkResult {
  const referenceWords = input.reference.map(({ word }) => normalize(word));
  const predictedWords = input.predicted.map(({ word }) => normalize(word));
  const wordOperations = editOperations(referenceWords, predictedWords);
  const referenceCharacters = [...referenceWords.join(" ")];
  const predictedCharacters = [...predictedWords.join(" ")];
  const characterOperations = editOperations(
    referenceCharacters,
    predictedCharacters,
  );
  const timingErrors: number[] = [];

  for (const operation of wordOperations.alignment) {
    if (operation.kind !== "match") continue;
    const reference = input.reference[operation.referenceIndex];
    const predicted = input.predicted[operation.predictedIndex];
    if (
      reference.startMs === undefined ||
      reference.endMs === undefined ||
      predicted.startMs === undefined ||
      predicted.endMs === undefined
    ) {
      continue;
    }
    timingErrors.push(Math.abs(reference.startMs - predicted.startMs));
    timingErrors.push(Math.abs(reference.endMs - predicted.endMs));
  }

  return {
    wordErrorRate: roundRate(
      wordOperations.distance / Math.max(referenceWords.length, 1),
    ),
    characterErrorRate: roundRate(
      characterOperations.distance / Math.max(referenceCharacters.length, 1),
    ),
    matchedWordRate: roundRate(
      wordOperations.matchCount / Math.max(referenceWords.length, 1),
    ),
    boundaryMeanAbsoluteErrorMs:
      timingErrors.length === 0
        ? null
        : Math.round(
            timingErrors.reduce((sum, value) => sum + value, 0) /
              timingErrors.length,
          ),
    insertionCount: wordOperations.insertionCount,
    deletionCount: wordOperations.deletionCount,
    substitutionCount: wordOperations.substitutionCount,
  };
}

function editOperations(left: readonly string[], right: readonly string[]) {
  const table = Array.from(
    { length: left.length + 1 },
    () => new Uint16Array(right.length + 1),
  );
  for (let index = 0; index <= left.length; index += 1) table[index][0] = index;
  for (let index = 0; index <= right.length; index += 1)
    table[0][index] = index;

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      table[leftIndex][rightIndex] = Math.min(
        table[leftIndex - 1][rightIndex] + 1,
        table[leftIndex][rightIndex - 1] + 1,
        table[leftIndex - 1][rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
  }

  const alignment: Array<
    | {
        readonly kind: "match";
        readonly referenceIndex: number;
        readonly predictedIndex: number;
      }
    | { readonly kind: "substitution" | "deletion" | "insertion" }
  > = [];
  let insertionCount = 0;
  let deletionCount = 0;
  let substitutionCount = 0;
  let matchCount = 0;
  let leftIndex = left.length;
  let rightIndex = right.length;

  while (leftIndex > 0 || rightIndex > 0) {
    if (
      leftIndex > 0 &&
      rightIndex > 0 &&
      left[leftIndex - 1] === right[rightIndex - 1]
    ) {
      alignment.push({
        kind: "match",
        referenceIndex: leftIndex - 1,
        predictedIndex: rightIndex - 1,
      });
      matchCount += 1;
      leftIndex -= 1;
      rightIndex -= 1;
    } else if (
      leftIndex > 0 &&
      rightIndex > 0 &&
      table[leftIndex][rightIndex] === table[leftIndex - 1][rightIndex - 1] + 1
    ) {
      alignment.push({ kind: "substitution" });
      substitutionCount += 1;
      leftIndex -= 1;
      rightIndex -= 1;
    } else if (
      leftIndex > 0 &&
      table[leftIndex][rightIndex] === table[leftIndex - 1][rightIndex] + 1
    ) {
      alignment.push({ kind: "deletion" });
      deletionCount += 1;
      leftIndex -= 1;
    } else {
      alignment.push({ kind: "insertion" });
      insertionCount += 1;
      rightIndex -= 1;
    }
  }

  return {
    distance: table[left.length][right.length],
    alignment: alignment.reverse(),
    insertionCount,
    deletionCount,
    substitutionCount,
    matchCount,
  };
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function roundRate(value: number): number {
  return Math.round(Math.max(0, value) * 1_000) / 1_000;
}
