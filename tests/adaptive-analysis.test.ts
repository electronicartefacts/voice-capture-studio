import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCaptureAcousticScene,
  classifyRuntimePerformance,
  createImportedAnalysisPlan,
  refineImportedAnalysisPlan,
  runAdaptiveTakeAnalysis,
  selectTakeAnalysisHypothesis,
  shouldEscalateTakeAnalysis,
} from "../src/app/analysis/adaptiveAnalysis";
import type { LocalTakeAnalysis } from "../src/app/analysis/types";

test("capture scene separates clean, constrained, and sung performances", () => {
  assert.equal(
    classifyCaptureAcousticScene({
      performanceKind: "spoken",
      snrDb: 31,
      reverbScore: 0.22,
      activeSpeechRatio: 0.5,
    }),
    "clean_voice",
  );
  assert.equal(
    classifyCaptureAcousticScene({
      performanceKind: "spoken",
      snrDb: 12,
      reverbScore: 0.7,
    }),
    "constrained_voice",
  );
  assert.equal(
    classifyCaptureAcousticScene({ performanceKind: "sung_candidate" }),
    "sung_voice",
  );
});

test("post-capture scout only escalates when the evidence needs it", () => {
  const clean = createAnalysis({
    transcript: "dans la nuit",
    expectedWordCount: 3,
    matchedWordCount: 3,
    status: "strong",
    words: ["dans", "la", "nuit"],
  });
  const mismatch = createAnalysis({
    transcript: "dans la",
    expectedWordCount: 3,
    matchedWordCount: 2,
    status: "review",
    words: ["dans", "la"],
  });

  assert.equal(
    shouldEscalateTakeAnalysis({ scene: "clean_voice", firstPass: clean }),
    false,
  );
  assert.equal(
    shouldEscalateTakeAnalysis({ scene: "clean_voice", firstPass: mismatch }),
    true,
  );
  assert.equal(
    shouldEscalateTakeAnalysis({ scene: "sung_voice", firstPass: clean }),
    true,
  );
  assert.equal(
    shouldEscalateTakeAnalysis({
      scene: "constrained_voice",
      firstPass: createAnalysis({
        transcript: "",
        expectedWordCount: 0,
        matchedWordCount: 0,
        status: "insufficient",
        words: [],
        speechSegments: [],
      }),
    }),
    false,
  );
});

test("prompt-aware arbitration retains the more coherent hypothesis", () => {
  const weak = createAnalysis({
    transcript: "blue moon",
    expectedWordCount: 4,
    matchedWordCount: 0,
    status: "review",
    words: ["blue", "moon"],
  });
  const coherent = createAnalysis({
    transcript: "dans la nuit claire",
    expectedWordCount: 4,
    matchedWordCount: 4,
    status: "strong",
    words: ["dans", "la", "nuit", "claire"],
  });
  const result = selectTakeAnalysisHypothesis([
    { model: "tiny", decoding: "greedy", analysis: weak },
    { model: "base", decoding: "beam", analysis: coherent },
  ]);

  assert.equal(result.selected.model, "base");
  assert.equal(result.selectionReason, "prompt_match");
  assert.ok(result.scores[1] > result.scores[0]);
});

test("free-capture arbitration penalizes unsupported repeated hallucinations", () => {
  const hallucinated = createAnalysis({
    transcript: "merci merci merci merci merci",
    expectedWordCount: 0,
    matchedWordCount: 0,
    status: "insufficient",
    words: ["merci", "merci", "merci", "merci", "merci"],
    speechSegments: [],
  });
  const supported = createAnalysis({
    transcript: "une voix claire",
    expectedWordCount: 0,
    matchedWordCount: 0,
    status: "insufficient",
    words: ["une", "voix", "claire"],
  });
  const result = selectTakeAnalysisHypothesis([
    { model: "tiny", decoding: "greedy", analysis: hallucinated },
    { model: "base", decoding: "beam", analysis: supported },
  ]);

  assert.equal(result.selected.model, "base");
  assert.equal(result.selectionReason, "acoustic_support");
});

test("media analysis budgets depth from scene, duration, and runtime", () => {
  const compatibleClean = createImportedAnalysisPlan({
    durationMs: 45_000,
    profile: "compatible",
    initialStatus: "review",
    speechCoverage: 0.62,
    focusedCoverage: 0.63,
    focusDifference: 0.01,
    stereoCenterUsed: false,
  });
  const musical = createImportedAnalysisPlan({
    durationMs: 90_000,
    profile: "balanced",
    initialStatus: "insufficient",
    speechCoverage: 0.18,
    focusedCoverage: 0.58,
    focusDifference: 0.12,
    stereoCenterUsed: true,
  });
  const long = createImportedAnalysisPlan({
    durationMs: 6 * 60_000,
    profile: "balanced",
    initialStatus: "insufficient",
    speechCoverage: 0.08,
    focusedCoverage: 0.44,
    focusDifference: 0.2,
    stereoCenterUsed: true,
  });

  assert.deepEqual(compatibleClean, {
    scene: "clean_voice",
    depth: "fast",
    maximumHypotheses: 1,
    runBaseOriginal: false,
    allowVocalFocus: false,
    allowSpectralSeparation: false,
    runtimeClass: "unmeasured",
    scoutRealtimeFactor: null,
    verificationRealtimeFactor: null,
  });
  assert.equal(musical.scene, "music_mix");
  assert.equal(musical.maximumHypotheses, 4);
  assert.equal(musical.allowSpectralSeparation, true);
  assert.equal(long.depth, "fast");
  assert.equal(long.maximumHypotheses, 1);
});

test("media analysis uses observed inference speed instead of device hints", () => {
  const moderate = createImportedAnalysisPlan({
    durationMs: 90_000,
    profile: "balanced",
    initialStatus: "insufficient",
    speechCoverage: 0.18,
    focusedCoverage: 0.58,
    focusDifference: 0.12,
    stereoCenterUsed: true,
    scoutRealtimeFactor: 0.55,
  });
  const constrained = createImportedAnalysisPlan({
    durationMs: 90_000,
    profile: "balanced",
    initialStatus: "insufficient",
    speechCoverage: 0.18,
    focusedCoverage: 0.58,
    focusDifference: 0.12,
    stereoCenterUsed: true,
    scoutRealtimeFactor: 1.2,
  });

  assert.equal(classifyRuntimePerformance(null), "unmeasured");
  assert.equal(classifyRuntimePerformance(0.35), "fast");
  assert.equal(classifyRuntimePerformance(0.8), "moderate");
  assert.equal(classifyRuntimePerformance(0.81), "constrained");
  assert.equal(moderate.maximumHypotheses, 3);
  assert.equal(moderate.allowVocalFocus, true);
  assert.equal(moderate.allowSpectralSeparation, false);
  assert.equal(moderate.runtimeClass, "moderate");
  assert.equal(constrained.maximumHypotheses, 2);
  assert.equal(constrained.runtimeClass, "constrained");
});

test("media analysis refines its remaining budget after the Base verifier", () => {
  const initial = createImportedAnalysisPlan({
    durationMs: 90_000,
    profile: "balanced",
    initialStatus: "insufficient",
    speechCoverage: 0.18,
    focusedCoverage: 0.58,
    focusDifference: 0.12,
    stereoCenterUsed: true,
    scoutRealtimeFactor: 0.2,
  });
  const moderate = refineImportedAnalysisPlan({
    plan: initial,
    verificationRealtimeFactor: 0.6,
  });
  const constrained = refineImportedAnalysisPlan({
    plan: initial,
    verificationRealtimeFactor: 1.1,
  });

  assert.equal(initial.maximumHypotheses, 4);
  assert.equal(moderate.maximumHypotheses, 3);
  assert.equal(moderate.allowVocalFocus, true);
  assert.equal(moderate.allowSpectralSeparation, false);
  assert.equal(moderate.runtimeClass, "moderate");
  assert.equal(moderate.verificationRealtimeFactor, 0.6);
  assert.equal(constrained.maximumHypotheses, 2);
  assert.equal(constrained.allowVocalFocus, false);
  assert.equal(constrained.runtimeClass, "constrained");
});

test("adaptive take runner stops after a sufficient clean scout", async () => {
  const audio = new Float32Array([0.1, 0.2, 0.3]);
  const clean = createAnalysis({
    transcript: "dans la nuit",
    expectedWordCount: 3,
    matchedWordCount: 3,
    status: "strong",
    words: ["dans", "la", "nuit"],
  });
  const calls: Array<{ model: string; sameBuffer: boolean }> = [];
  const progress: string[] = [];
  const result = await runAdaptiveTakeAnalysis({
    audio,
    context: {
      performanceKind: "spoken",
      snrDb: 30,
      reverbScore: 0.2,
      activeSpeechRatio: 0.5,
    },
    onProgress: ({ stage }) => progress.push(stage),
    analyze: async ({ audio: candidateAudio, model }) => {
      calls.push({ model, sameBuffer: candidateAudio.buffer === audio.buffer });
      return clean;
    },
  });

  assert.deepEqual(calls, [{ model: "tiny", sameBuffer: false }]);
  assert.deepEqual(progress, ["validating-result"]);
  assert.equal(result.strategy?.depth, "fast");
  assert.equal(result.strategy?.selectionReason, "fast_path_sufficient");
});

test("adaptive take runner escalates difficult vocals and records arbitration", async () => {
  const weak = createAnalysis({
    transcript: "blue moon",
    expectedWordCount: 3,
    matchedWordCount: 0,
    status: "review",
    words: ["blue", "moon"],
  });
  const strong = createAnalysis({
    transcript: "dans la nuit",
    expectedWordCount: 3,
    matchedWordCount: 3,
    status: "strong",
    words: ["dans", "la", "nuit"],
  });
  const calls: string[] = [];
  const result = await runAdaptiveTakeAnalysis({
    audio: new Float32Array([0.1, 0.2, 0.3]),
    context: { performanceKind: "sung" },
    onProgress: () => undefined,
    analyze: async ({ model }) => {
      calls.push(model);
      return model === "tiny" ? weak : strong;
    },
  });

  assert.deepEqual(calls, ["tiny", "base"]);
  assert.equal(result.transcript, "dans la nuit");
  assert.equal(result.strategy?.depth, "verified");
  assert.equal(result.strategy?.selectedModel, "base");
  assert.equal(result.strategy?.hypotheses.length, 2);
  assert.equal(result.strategy?.selectionReason, "prompt_match");
});

test("local hypothesis arbitration rejects an empty candidate set", () => {
  assert.throws(
    () => selectTakeAnalysisHypothesis([]),
    /Aucune hypothèse locale/,
  );
});

function createAnalysis(input: {
  readonly transcript: string;
  readonly expectedWordCount: number;
  readonly matchedWordCount: number;
  readonly status: "strong" | "acceptable" | "review" | "insufficient";
  readonly words: readonly string[];
  readonly speechSegments?: readonly {
    readonly startMs: number;
    readonly endMs: number;
  }[];
}): LocalTakeAnalysis {
  const speechSegments = input.speechSegments ?? [{ startMs: 50, endMs: 950 }];

  return {
    transcript: input.transcript,
    matchedWordCount: input.matchedWordCount,
    expectedWordCount: input.expectedWordCount,
    speechSegments,
    whisperWords: input.words.map((word, index) => ({
      word,
      startMs: 100 + index * 180,
      endMs: 260 + index * 180,
      source: "whisper_attention_timestamp",
    })),
    executionProvider: "wasm",
    segmentSummary: {
      leadingSilenceMs: 50,
      trailingSilenceMs: 50,
      speechDurationMs: speechSegments.length === 0 ? 0 : 900,
      totalDurationMs: 1_000,
    },
    alignmentComparison: {
      schemaVersion: "voice.local_alignment_comparison.v1",
      status: input.status,
      reviewRequired:
        input.status === "review" || input.status === "insufficient",
      matchedWordCount: input.matchedWordCount,
      expectedWordCount: input.expectedWordCount,
      whisperWordCount: input.words.length,
      matchRate:
        input.expectedWordCount === 0
          ? 0
          : input.matchedWordCount / input.expectedWordCount,
      medianBoundaryDeltaMs: input.status === "insufficient" ? null : 35,
      maximumBoundaryDeltaMs: input.status === "insufficient" ? null : 70,
      words: [],
    },
  };
}
