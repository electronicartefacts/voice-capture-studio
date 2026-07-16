import type {
  LocalAcousticScene,
  LocalAnalysisProgress,
  LocalAnalysisDepth,
  LocalDecodingStrategy,
  LocalProcessingProfile,
  LocalRuntimeClass,
  LocalTakeAnalysis,
  LocalTranscriptionModel,
} from "./types";

export type CaptureAnalysisContext = {
  readonly performanceKind?:
    "spoken" | "sung" | "sung_candidate" | "undetermined";
  readonly snrDb?: number;
  readonly reverbScore?: number;
  readonly activeSpeechRatio?: number;
};

export type ImportedAnalysisPlan = {
  readonly scene: LocalAcousticScene;
  readonly depth: LocalAnalysisDepth;
  readonly maximumHypotheses: 1 | 2 | 3 | 4;
  readonly runBaseOriginal: boolean;
  readonly allowVocalFocus: boolean;
  readonly allowSpectralSeparation: boolean;
  readonly runtimeClass: LocalRuntimeClass;
  readonly scoutRealtimeFactor: number | null;
  readonly verificationRealtimeFactor: number | null;
};

export function classifyCaptureAcousticScene(
  context: CaptureAnalysisContext = {},
): LocalAcousticScene {
  if (
    context.performanceKind === "sung" ||
    context.performanceKind === "sung_candidate"
  ) {
    return "sung_voice";
  }

  const snrDb = finiteOrNull(context.snrDb);
  const reverbScore = finiteOrNull(context.reverbScore);
  const activeSpeechRatio = finiteOrNull(context.activeSpeechRatio);

  if (
    (snrDb !== null && snrDb < 18) ||
    (reverbScore !== null && reverbScore > 0.6) ||
    (activeSpeechRatio !== null && activeSpeechRatio < 0.12)
  ) {
    return "constrained_voice";
  }

  if (
    context.performanceKind === "spoken" &&
    (snrDb === null || snrDb >= 24) &&
    (reverbScore === null || reverbScore <= 0.45) &&
    (activeSpeechRatio === null || activeSpeechRatio >= 0.18)
  ) {
    return "clean_voice";
  }

  return "uncertain";
}

export function shouldEscalateTakeAnalysis(input: {
  readonly scene: LocalAcousticScene;
  readonly firstPass: LocalTakeAnalysis;
}): boolean {
  const pass = input.firstPass;

  // A second language model must not turn verified non-speech into words.
  // Singing is the exception because speech VAD is known to miss sustained
  // vowels and the stronger model remains useful there.
  if (pass.speechSegments.length === 0) {
    return input.scene === "sung_voice";
  }

  if (input.scene !== "clean_voice") return true;
  if (pass.whisperWords.length === 0) return true;

  if (pass.expectedWordCount === 0) return false;
  const matchRate = pass.matchedWordCount / pass.expectedWordCount;

  return (
    matchRate < 0.9 ||
    (pass.alignmentComparison.status !== "strong" &&
      pass.alignmentComparison.status !== "acceptable")
  );
}

export async function runAdaptiveTakeAnalysis(input: {
  readonly audio: Float32Array;
  readonly context?: CaptureAnalysisContext;
  readonly onProgress: (progress: LocalAnalysisProgress) => void;
  readonly analyze: (candidate: {
    readonly audio: Float32Array;
    readonly model: LocalTranscriptionModel;
    readonly decoding: LocalDecodingStrategy;
  }) => Promise<LocalTakeAnalysis>;
}): Promise<LocalTakeAnalysis> {
  const scene = classifyCaptureAcousticScene(input.context);
  const tinyAnalysis = await input.analyze({
    audio: input.audio.slice(),
    model: "tiny",
    decoding: "greedy",
  });
  const hypotheses: Array<{
    readonly model: LocalTranscriptionModel;
    readonly decoding: LocalDecodingStrategy;
    readonly analysis: LocalTakeAnalysis;
  }> = [
    {
      model: "tiny",
      decoding: "greedy",
      analysis: tinyAnalysis,
    },
  ];

  if (shouldEscalateTakeAnalysis({ scene, firstPass: tinyAnalysis })) {
    input.onProgress({ stage: "validating-result" });
    const baseAnalysis = await input.analyze({
      audio: input.audio,
      model: "base",
      decoding: "beam",
    });
    hypotheses.push({
      model: "base",
      decoding: "beam",
      analysis: baseAnalysis,
    });
  }

  input.onProgress({ stage: "validating-result" });

  if (hypotheses.length === 1) {
    return {
      ...tinyAnalysis,
      strategy: {
        schemaVersion: "voice.adaptive_analysis.v1",
        scene,
        depth: "fast",
        selectedModel: "tiny",
        selectionReason: "fast_path_sufficient",
        hypotheses: [
          {
            model: "tiny",
            provider: tinyAnalysis.executionProvider,
            decoding: "greedy",
            transcript: tinyAnalysis.transcript,
            wordCount: tinyAnalysis.whisperWords.length,
            matchedWordCount: tinyAnalysis.matchedWordCount,
            score: 1,
          },
        ],
      },
    };
  }

  const selection = selectTakeAnalysisHypothesis(hypotheses);

  return {
    ...selection.selected.analysis,
    strategy: {
      schemaVersion: "voice.adaptive_analysis.v1",
      scene,
      depth: "verified",
      selectedModel: selection.selected.model,
      selectionReason: selection.selectionReason,
      hypotheses: hypotheses.map((hypothesis, index) => ({
        model: hypothesis.model,
        provider: hypothesis.analysis.executionProvider,
        decoding: hypothesis.decoding,
        transcript: hypothesis.analysis.transcript,
        wordCount: hypothesis.analysis.whisperWords.length,
        matchedWordCount: hypothesis.analysis.matchedWordCount,
        score: selection.scores[index],
      })),
    },
  };
}

export function selectTakeAnalysisHypothesis(
  hypotheses: readonly {
    readonly model: LocalTranscriptionModel;
    readonly decoding: LocalDecodingStrategy;
    readonly analysis: LocalTakeAnalysis;
  }[],
): {
  readonly selected: (typeof hypotheses)[number];
  readonly selectionReason: "prompt_match" | "acoustic_support";
  readonly scores: readonly number[];
} {
  if (hypotheses.length === 0) {
    throw new Error("Aucune hypothèse locale à comparer.");
  }

  const hasPrompt = hypotheses.some(
    ({ analysis }) => analysis.expectedWordCount > 0,
  );
  const scores = hypotheses.map((hypothesis) =>
    scoreTakeHypothesis(hypothesis.analysis, hypothesis.model, hasPrompt),
  );
  let selectedIndex = 0;

  for (let index = 1; index < hypotheses.length; index += 1) {
    if (scores[index] > scores[selectedIndex]) selectedIndex = index;
  }

  return {
    selected: hypotheses[selectedIndex],
    selectionReason: hasPrompt ? "prompt_match" : "acoustic_support",
    scores: scores.map(roundScore),
  };
}

export function createImportedAnalysisPlan(input: {
  readonly durationMs: number;
  readonly profile: LocalProcessingProfile;
  readonly initialStatus: "review" | "insufficient";
  readonly speechCoverage: number;
  readonly focusedCoverage: number;
  readonly focusDifference: number;
  readonly stereoCenterUsed: boolean;
  readonly scoutRealtimeFactor?: number;
}): ImportedAnalysisPlan {
  const scene = classifyImportedAcousticScene(input);
  const scoutRealtimeFactor = normalizeRealtimeFactor(
    input.scoutRealtimeFactor,
  );
  const runtimeClass = classifyRuntimePerformance(scoutRealtimeFactor);
  const plan = (depth: LocalAnalysisDepth, maximumHypotheses: 1 | 2 | 3 | 4) =>
    boundedImportedPlan(
      scene,
      depth,
      maximumHypotheses,
      runtimeClass,
      scoutRealtimeFactor,
    );

  if (input.durationMs > 5 * 60_000) {
    return plan("fast", 1);
  }

  if (input.profile === "compatible") {
    return scene === "clean_voice" ? plan("fast", 1) : plan("verified", 2);
  }

  // Measured inference speed is more inclusive than Chromium-only memory or
  // core-count hints. A first pass slower than the source duration keeps one
  // independent verification for difficult audio but avoids multiplying the
  // wait and peak-memory risk with two more enhancement passes.
  if (runtimeClass === "constrained") {
    return scene === "clean_voice" ? plan("fast", 1) : plan("verified", 2);
  }

  if (scene === "clean_voice") {
    return plan("verified", 2);
  }

  if (input.durationMs > 3 * 60_000) {
    return plan("verified", 2);
  }

  if (scene === "music_mix") {
    return runtimeClass === "moderate" ? plan("deep", 3) : plan("deep", 4);
  }

  return plan("deep", 3);
}

export function refineImportedAnalysisPlan(input: {
  readonly plan: ImportedAnalysisPlan;
  readonly verificationRealtimeFactor?: number;
}): ImportedAnalysisPlan {
  const verificationRealtimeFactor = normalizeRealtimeFactor(
    input.verificationRealtimeFactor,
  );
  if (verificationRealtimeFactor === null) return input.plan;

  const verificationRuntimeClass = classifyRuntimePerformance(
    verificationRealtimeFactor,
  );
  const runtimeClass = slowerRuntimeClass(
    input.plan.runtimeClass,
    verificationRuntimeClass,
  );
  const maximumHypotheses =
    verificationRealtimeFactor > 0.8
      ? Math.min(input.plan.maximumHypotheses, 2)
      : verificationRealtimeFactor > 0.45
        ? Math.min(input.plan.maximumHypotheses, 3)
        : input.plan.maximumHypotheses;
  const boundedMaximum = maximumHypotheses as 1 | 2 | 3 | 4;
  const depth: LocalAnalysisDepth =
    boundedMaximum === 1 ? "fast" : boundedMaximum === 2 ? "verified" : "deep";

  return {
    ...boundedImportedPlan(
      input.plan.scene,
      depth,
      boundedMaximum,
      runtimeClass,
      input.plan.scoutRealtimeFactor,
    ),
    verificationRealtimeFactor,
  };
}

function classifyImportedAcousticScene(input: {
  readonly initialStatus: "review" | "insufficient";
  readonly speechCoverage: number;
  readonly focusedCoverage: number;
  readonly focusDifference: number;
  readonly stereoCenterUsed: boolean;
}): LocalAcousticScene {
  const focusedActivityGain = input.focusedCoverage - input.speechCoverage;
  const musicEvidence =
    (input.focusDifference >= 0.07 && input.focusedCoverage >= 0.08) ||
    (focusedActivityGain >= 0.16 && input.focusedCoverage >= 0.18) ||
    (input.stereoCenterUsed && input.focusDifference >= 0.045);

  if (musicEvidence) return "music_mix";
  if (input.initialStatus === "insufficient" || input.speechCoverage < 0.12) {
    return "constrained_voice";
  }
  if (input.speechCoverage >= 0.18 && input.focusDifference < 0.035) {
    return "clean_voice";
  }
  return "uncertain";
}

function boundedImportedPlan(
  scene: LocalAcousticScene,
  depth: LocalAnalysisDepth,
  maximumHypotheses: 1 | 2 | 3 | 4,
  runtimeClass: LocalRuntimeClass,
  scoutRealtimeFactor: number | null,
): ImportedAnalysisPlan {
  return {
    scene,
    depth,
    maximumHypotheses,
    runBaseOriginal: maximumHypotheses >= 2,
    allowVocalFocus: maximumHypotheses >= 3,
    allowSpectralSeparation: maximumHypotheses >= 4,
    runtimeClass,
    scoutRealtimeFactor,
    verificationRealtimeFactor: null,
  };
}

export function classifyRuntimePerformance(
  scoutRealtimeFactor: number | null,
): LocalRuntimeClass {
  if (scoutRealtimeFactor === null) return "unmeasured";
  if (scoutRealtimeFactor <= 0.35) return "fast";
  if (scoutRealtimeFactor <= 0.8) return "moderate";
  return "constrained";
}

function normalizeRealtimeFactor(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return roundScore(value);
}

function slowerRuntimeClass(
  left: LocalRuntimeClass,
  right: LocalRuntimeClass,
): LocalRuntimeClass {
  const ranks: Record<LocalRuntimeClass, number> = {
    unmeasured: 0,
    fast: 1,
    moderate: 2,
    constrained: 3,
  };
  return ranks[right] > ranks[left] ? right : left;
}

function scoreTakeHypothesis(
  analysis: LocalTakeAnalysis,
  model: LocalTranscriptionModel,
  hasPrompt: boolean,
): number {
  const segmentDurationMs = analysis.speechSegments.reduce(
    (sum, segment) => sum + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  const supportedWordRate =
    analysis.whisperWords.length === 0
      ? 0
      : analysis.whisperWords.filter((word) =>
          analysis.speechSegments.some(
            (segment) =>
              Math.min(word.endMs, segment.endMs) -
                Math.max(word.startMs, segment.startMs) >
              0,
          ),
        ).length / analysis.whisperWords.length;
  const wordsPerMinute =
    segmentDurationMs <= 0
      ? 0
      : analysis.whisperWords.length / (segmentDurationMs / 60_000);
  const densityPenalty = wordsPerMinute > 360 ? 1.5 : 0;
  const repetitionPenalty = repeatedWordRun(analysis.transcript) >= 4 ? 1 : 0;
  const modelBonus = model === "base" ? 0.12 : 0;

  if (!hasPrompt || analysis.expectedWordCount === 0) {
    return (
      supportedWordRate * 2.5 +
      Math.min(analysis.whisperWords.length, 24) / 80 +
      modelBonus -
      densityPenalty -
      repetitionPenalty
    );
  }

  const matchRate = analysis.matchedWordCount / analysis.expectedWordCount;
  const countCloseness = Math.max(
    0,
    1 -
      Math.abs(analysis.whisperWords.length - analysis.expectedWordCount) /
        analysis.expectedWordCount,
  );
  const alignmentScore =
    analysis.alignmentComparison.status === "strong"
      ? 1
      : analysis.alignmentComparison.status === "acceptable"
        ? 0.78
        : analysis.alignmentComparison.status === "review"
          ? 0.42
          : 0;

  return (
    matchRate * 4 +
    alignmentScore * 1.6 +
    countCloseness * 0.8 +
    supportedWordRate * 0.6 +
    modelBonus -
    densityPenalty -
    repetitionPenalty
  );
}

function repeatedWordRun(transcript: string): number {
  const words = transcript
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  let longest = 0;
  let current = 0;
  let previous = "";

  for (const word of words ?? []) {
    current = word === previous ? current + 1 : 1;
    previous = word;
    longest = Math.max(longest, current);
  }

  return longest;
}

function finiteOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function roundScore(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
