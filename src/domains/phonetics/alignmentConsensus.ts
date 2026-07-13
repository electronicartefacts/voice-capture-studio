import type { IsoDateTime, LanguageCode } from "@shared/index";
import type {
  AlignmentConsensus,
  ForcedAlignment,
  ForcedAlignmentWord,
  PromptPhonemeAlignment,
} from "./types";
import { importForcedAlignment } from "./forcedAlignment";

type ConsensusSource = {
  readonly id: string;
  readonly kind: "estimated" | "local_acoustic" | "acoustic";
  readonly confidence: number;
  readonly words: readonly ForcedAlignmentWord[];
  readonly alignment?: ForcedAlignment;
};

export function importAlignmentWithConsensus(input: {
  readonly payload: unknown;
  readonly estimated?: PromptPhonemeAlignment;
  readonly localAcoustic?: {
    readonly matchRate: number;
    readonly medianBoundaryDeltaMs: number | null;
    readonly words: readonly {
      readonly word: string;
      readonly startMs: number;
      readonly endMs: number;
    }[];
  };
}): ForcedAlignment {
  const acousticPayloads =
    isRecord(input.payload) && Array.isArray(input.payload.alignments)
      ? input.payload.alignments
      : [input.payload];
  const acoustic = acousticPayloads.map((item) => importForcedAlignment(item));
  const local = input.localAcoustic;
  const canUseLocalEvidence =
    local !== undefined &&
    local.matchRate === 1 &&
    local.words.length === acoustic[0].words.length;

  if (acoustic.length === 1 && !canUseLocalEvidence) {
    return acoustic[0];
  }

  return createAlignmentConsensus({
    estimated: input.estimated,
    localAcoustic: canUseLocalEvidence
      ? {
          confidence: round(
            local.matchRate *
              Math.max(0, 1 - (local.medianBoundaryDeltaMs ?? 500) / 500),
          ),
          words: local.words,
        }
      : undefined,
    acoustic,
  });
}

export function createAlignmentConsensus(input: {
  readonly estimated?: PromptPhonemeAlignment;
  readonly localAcoustic?: {
    readonly confidence: number;
    readonly words: readonly {
      readonly word: string;
      readonly startMs: number;
      readonly endMs: number;
    }[];
  };
  readonly acoustic: readonly ForcedAlignment[];
  readonly now?: Date;
}): ForcedAlignment {
  if (
    input.acoustic.length < 1 ||
    (input.acoustic.length < 2 && input.localAcoustic === undefined)
  ) {
    throw new Error(
      "Le consensus exige deux preuves acoustiques, dont au moins un alignement externe.",
    );
  }

  const reference = input.acoustic[0];
  const sources: ConsensusSource[] = [
    ...(input.estimated === undefined
      ? []
      : [
          {
            id: "local_g2p_vad",
            kind: "estimated" as const,
            confidence: input.estimated.confidence,
            words: input.estimated.words,
          },
        ]),
    ...(input.localAcoustic === undefined
      ? []
      : [
          {
            id: "local_whisper_word_timestamps",
            kind: "local_acoustic" as const,
            confidence: input.localAcoustic.confidence,
            words: input.localAcoustic.words.map((word) => ({
              ...word,
              confidence: input.localAcoustic?.confidence ?? 0,
              phonemes: [],
            })),
          },
        ]),
    ...input.acoustic.map((alignment) => ({
      id: alignment.aligner,
      kind: "acoustic" as const,
      confidence: alignment.confidence,
      words: alignment.words,
      alignment,
    })),
  ];

  assertCompatibleSources(sources, reference.language, reference.durationMs);

  const spreads: number[] = [];
  const words = reference.words.map((word, wordIndex) => {
    const observations = sources.map((source) => ({
      startMs: source.words[wordIndex].startMs,
      endMs: source.words[wordIndex].endMs,
      weight: sourceWeight(source),
    }));
    const startMs = weightedMedian(observations, "startMs");
    const endMs = weightedMedian(observations, "endMs");
    const acousticObservations = sources
      .map((source, index) => ({ source, observation: observations[index] }))
      .filter((item) => item.source.kind !== "estimated")
      .map((item) => item.observation);
    const startBoundaries = acousticObservations.map((item) => item.startMs);
    const endBoundaries = acousticObservations.map((item) => item.endMs);
    spreads.push(
      Math.max(
        Math.max(...startBoundaries) - Math.min(...startBoundaries),
        Math.max(...endBoundaries) - Math.min(...endBoundaries),
      ),
    );

    return {
      ...word,
      startMs,
      endMs: Math.max(startMs + 1, endMs),
      confidence: round(
        sources.reduce(
          (sum, source) => sum + source.confidence * sourceWeight(source),
          0,
        ) / sources.reduce((sum, source) => sum + sourceWeight(source), 0),
      ),
    };
  });
  const agreementMs = Math.round(median(spreads));
  const status =
    agreementMs <= 40 ? "strong" : agreementMs <= 120 ? "acceptable" : "review";
  const consensus: AlignmentConsensus = {
    schemaVersion: "voice.alignment_consensus.v1",
    method: "weighted_median",
    sourceCount: sources.length,
    acousticSourceCount:
      input.acoustic.length + (input.localAcoustic === undefined ? 0 : 1),
    agreementMs,
    status,
    reviewRequired: status === "review",
    sources: sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      weight: sourceWeight(source),
      confidence: source.confidence,
      words: source.words.map((word) => ({
        word: word.word,
        startMs: word.startMs,
        endMs: word.endMs,
        confidence: word.confidence,
      })),
    })),
  };
  const bestAcoustic = [...input.acoustic].sort(
    (left, right) => right.confidence - left.confidence,
  )[0];

  return {
    schemaVersion: "voice.forced_alignment.v1",
    source: "external_acoustic_forced_alignment",
    aligner: `Consensus (${[
      ...(input.localAcoustic === undefined ? [] : ["Local Whisper"]),
      ...input.acoustic.map((item) => item.aligner),
    ].join(" + ")})`,
    language: reference.language,
    durationMs: reference.durationMs,
    confidence: round(
      Math.max(0, bestAcoustic.confidence - Math.min(0.45, agreementMs / 500)),
    ),
    words,
    phonemes: bestAcoustic.phonemes,
    importedAt: (input.now ?? new Date()).toISOString() as IsoDateTime,
    consensus,
  };
}

function assertCompatibleSources(
  sources: readonly ConsensusSource[],
  language: LanguageCode,
  durationMs: number,
): void {
  const referenceWords = sources.find(
    (source) => source.kind === "acoustic",
  )?.words;

  if (referenceWords === undefined || referenceWords.length === 0) {
    throw new Error("Les alignements acoustiques ne contiennent aucun mot.");
  }

  for (const source of sources) {
    if (source.alignment !== undefined) {
      if (source.alignment.language !== language) {
        throw new Error("Les langues des alignements ne correspondent pas.");
      }
      if (Math.abs(source.alignment.durationMs - durationMs) > 250) {
        throw new Error("Les durées des alignements ne correspondent pas.");
      }
    }
    if (source.words.length !== referenceWords.length) {
      throw new Error(
        "Les alignements ne contiennent pas le même nombre de mots.",
      );
    }
    source.words.forEach((word, index) => {
      if (normalize(word.word) !== normalize(referenceWords[index].word)) {
        throw new Error(`Les alignements divergent au mot ${index + 1}.`);
      }
    });
  }
}

function sourceWeight(source: ConsensusSource): number {
  const trust =
    source.kind === "acoustic"
      ? 1
      : source.kind === "local_acoustic"
        ? 0.65
        : 0.2;
  return round(trust * source.confidence);
}

function weightedMedian(
  values: readonly { startMs: number; endMs: number; weight: number }[],
  field: "startMs" | "endMs",
): number {
  const sorted = [...values].sort((left, right) => left[field] - right[field]);
  const midpoint = sorted.reduce((sum, item) => sum + item.weight, 0) / 2;
  let accumulated = 0;
  for (const item of sorted) {
    accumulated += item.weight;
    if (accumulated >= midpoint) return item[field];
  }
  return sorted.at(-1)?.[field] ?? 0;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
