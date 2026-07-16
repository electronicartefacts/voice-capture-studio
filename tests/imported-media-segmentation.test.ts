import assert from "node:assert/strict";
import test from "node:test";
import {
  createWordAudioSegments,
  shouldPreferLexicalAssessment,
} from "../src/app/analysis/importedMediaSegmentation";
import { detectFocusedVocalActivity } from "../src/app/analysis/focusedVocalActivity";
import { separateVocalsOffThread } from "../src/app/analysis/localSpectralVocalSeparation";
import {
  buildLexicalConsensus,
  transcriptAgreement,
  type LexicalHypothesis,
} from "../src/app/analysis/lexicalConsensus";
import { evaluateMusicPipeline } from "../src/app/analysis/musicPipelineBenchmark";
import { separateVocalsSpectrally } from "../src/app/analysis/spectralVocalSeparation";
import {
  applyVocalActivityMask,
  mergeVocalActivitySegments,
} from "../src/app/analysis/vocalActivityMask";
import type {
  LocalTakeAnalysis,
  WhisperWordTiming,
} from "../src/app/analysis/types";
import {
  createStereoVocalFocusSignal,
  createVocalFocusSignal,
} from "../src/app/analysis/vocalFocus";
import { assessLexicalSegmentation } from "../src/app/analysis/lexicalSegmentationQuality";
import {
  assertImportedMediaWithinLimits,
  LEXICAL_SEGMENTATION_MAX_DURATION_MS,
  LEXICAL_SEGMENTATION_MAX_FILE_SIZE_BYTES,
} from "../src/app/analysis/lexicalSegmentationPolicy";

test("word segmentation keeps detected timing and creates stable unique paths", () => {
  const segments = createWordAudioSegments([
    {
      word: "Écoute,",
      startMs: 120,
      endMs: 510,
      source: "whisper_attention_timestamp",
    },
    {
      word: "écoute !",
      startMs: 520,
      endMs: 980,
      source: "whisper_attention_timestamp",
    },
    {
      word: "voix/locale",
      startMs: 1000,
      endMs: 1600,
      source: "whisper_attention_timestamp",
    },
  ]);

  assert.deepEqual(segments, [
    {
      index: 0,
      word: "Écoute,",
      startMs: 120,
      endMs: 510,
      durationMs: 390,
      clipStartMs: 60,
      clipEndMs: 570,
      acousticSupport: 1,
      evidence: "speech_vad",
      confidence: 0.5,
      consensusVotes: 1,
      audioPath: "audio/mots/0001_ecoute.wav",
    },
    {
      index: 1,
      word: "écoute !",
      startMs: 520,
      endMs: 980,
      durationMs: 460,
      clipStartMs: 460,
      clipEndMs: 1040,
      acousticSupport: 1,
      evidence: "speech_vad",
      confidence: 0.5,
      consensusVotes: 1,
      audioPath: "audio/mots/0002_ecoute.wav",
    },
    {
      index: 2,
      word: "voix/locale",
      startMs: 1000,
      endMs: 1600,
      durationMs: 600,
      clipStartMs: 940,
      clipEndMs: 1660,
      acousticSupport: 1,
      evidence: "speech_vad",
      confidence: 0.5,
      consensusVotes: 1,
      audioPath: "audio/mots/0003_voix-locale.wav",
    },
  ]);
});

test("media preflight rejects imports that can exhaust a mobile tab", () => {
  assert.doesNotThrow(() =>
    assertImportedMediaWithinLimits({
      durationMs: LEXICAL_SEGMENTATION_MAX_DURATION_MS,
      sizeBytes: LEXICAL_SEGMENTATION_MAX_FILE_SIZE_BYTES,
    }),
  );
  assert.throws(
    () =>
      assertImportedMediaWithinLimits({
        sizeBytes: LEXICAL_SEGMENTATION_MAX_FILE_SIZE_BYTES + 1,
      }),
    /200 Mo/,
  );
  assert.throws(
    () =>
      assertImportedMediaWithinLimits({
        durationMs: LEXICAL_SEGMENTATION_MAX_DURATION_MS + 1,
        sizeBytes: 1,
      }),
    /10 minutes/,
  );
});

test("vocal focus sanitizes samples and removes sustained low-frequency offset", () => {
  const samples = new Float32Array(16_000).fill(0.4);
  samples[10] = Number.NaN;
  const focused = createVocalFocusSignal(samples);
  const tailPeak = focused
    .subarray(8_000)
    .reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);

  assert.equal(focused.length, samples.length);
  assert.equal(focused.every(Number.isFinite), true);
  assert.ok(tailPeak < 0.001);
});

test("stereo vocal focus attenuates side-only accompaniment", () => {
  const left = new Float32Array(16_000);
  const right = new Float32Array(16_000);

  for (let index = 0; index < left.length; index += 1) {
    const voice = Math.sin((index / 16_000) * Math.PI * 2 * 220) * 0.2;
    const wideInstrument =
      Math.sin((index / 16_000) * Math.PI * 2 * 440) * 0.35;
    left[index] = voice + wideInstrument;
    right[index] = voice - wideInstrument;
  }

  const focused = createStereoVocalFocusSignal(left, right);

  assert.equal(focused.stereoCenterUsed, true);
  assert.equal(focused.signal.every(Number.isFinite), true);
  assert.ok(Math.max(...focused.signal) > 0.1);
});

test("adaptive retry is selected only when acoustic evidence improves", () => {
  const source = "whisper_attention_timestamp" as const;
  const timing = [{ word: "refrain", startMs: 100, endMs: 800, source }];
  const unsupported = assessLexicalSegmentation({
    timings: timing,
    speechSegments: [],
  });
  const supported = assessLexicalSegmentation({
    timings: timing,
    speechSegments: [{ startMs: 80, endMs: 820 }],
  });

  assert.equal(shouldPreferLexicalAssessment(supported, unsupported), true);
  assert.equal(shouldPreferLexicalAssessment(unsupported, supported), false);
});

test("a richer base-model lyric hypothesis can replace a weak music pass", () => {
  const source = "whisper_attention_timestamp" as const;
  const tiny = assessLexicalSegmentation({
    timings: [{ word: "nuit", startMs: 100, endMs: 600, source }],
    speechSegments: [],
  });
  const base = assessLexicalSegmentation({
    timings: [
      { word: "dans", startMs: 100, endMs: 350, source },
      { word: "la", startMs: 360, endMs: 540, source },
      { word: "nuit", startMs: 550, endMs: 900, source },
    ],
    speechSegments: [],
  });

  assert.equal(shouldPreferLexicalAssessment(base, tiny), true);
  assert.equal(shouldPreferLexicalAssessment(tiny, base), false);
});

test("spectral separation produces a finite vocal residual for mono and stereo", () => {
  const left = new Float32Array(8_000);
  const right = new Float32Array(8_000);
  for (let index = 0; index < left.length; index += 1) {
    const stableInstrument =
      Math.sin((index / 16_000) * Math.PI * 2 * 110) * 0.35;
    const voice =
      index > 2_000 && index < 6_500
        ? Math.sin((index / 16_000) * Math.PI * 2 * 330) * 0.22
        : 0;
    const wide = Math.sin((index / 16_000) * Math.PI * 2 * 700) * 0.18;
    left[index] = stableInstrument + voice + wide;
    right[index] = stableInstrument + voice - wide;
  }

  const result = separateVocalsSpectrally({ left, right });

  assert.equal(result.signal.length, left.length);
  assert.equal(result.signal.every(Number.isFinite), true);
  assert.ok(result.centerEnergyRatio > 0.5);
  assert.ok(result.residualEnergyRatio > 0);
});

test("focused vocal activity keeps sustained singing without speech VAD", () => {
  const signal = new Float32Array(32_000);
  for (let index = 4_000; index < 24_000; index += 1) {
    signal[index] = Math.sin((index / 16_000) * Math.PI * 2 * 240) * 0.18;
  }

  const segments = detectFocusedVocalActivity(signal);

  assert.ok(segments.length > 0);
  assert.ok(segments[0].startMs < 400);
  assert.ok(segments.at(-1)!.endMs > 1_400);
});

test("off-thread spectral separation transfers progress and result", async () => {
  const originalWorker = globalThis.Worker;
  class MockWorker {
    private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    postMessage() {
      queueMicrotask(() => {
        this.emit("message", { kind: "progress", progressPercent: 40 });
        this.emit("message", {
          kind: "result",
          signal: new Float32Array([0.1, 0.2]),
          centerEnergyRatio: 0.8,
          residualEnergyRatio: 0.6,
        });
      });
    }

    terminate() {}

    private emit(type: string, data: unknown) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ data } as MessageEvent);
      }
    }
  }
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: MockWorker,
  });
  const progress: number[] = [];

  try {
    const result = await separateVocalsOffThread({
      left: new Float32Array([0.1, 0.2]),
      right: null,
      onProgress: (value) => progress.push(value),
    });
    assert.deepEqual(progress, [40]);
    assert.equal(result.signal.length, 2);
    assert.ok(Math.abs(result.signal[0] - 0.1) < 1e-6);
    assert.equal(result.centerEnergyRatio, 0.8);
  } finally {
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: originalWorker,
    });
  }
});

test("vocal activity fusion joins speech consonants and sustained singing", () => {
  const segments = mergeVocalActivitySegments(
    [
      [{ startMs: 180, endMs: 360 }],
      [
        { startMs: 430, endMs: 680 },
        { startMs: 1_400, endMs: 1_620 },
      ],
    ],
    2_000,
    100,
    120,
  );

  assert.deepEqual(segments, [
    { startMs: 80, endMs: 780 },
    { startMs: 1_300, endMs: 1_720 },
  ]);
});

test("vocal activity mask silences instrumental gaps without shifting time", () => {
  const signal = new Float32Array(16_000).fill(1);
  signal[8_000] = Number.NaN;
  const result = applyVocalActivityMask({
    signal,
    segments: [{ startMs: 250, endMs: 750 }],
  });

  assert.equal(result.applied, true);
  assert.equal(result.retainedRatio, 0.5);
  assert.equal(result.signal.length, signal.length);
  assert.equal(result.signal[1_000], 0);
  assert.equal(result.signal[15_000], 0);
  assert.equal(result.signal[8_000], 0);
  assert.equal(result.signal[7_000], 1);
  assert.ok(result.signal[4_000] > 0 && result.signal[4_000] < 0.01);
});

test("vocal activity mask preserves risky sparse and continuous detections", () => {
  const signal = new Float32Array(16_000).fill(0.1);
  const sparse = applyVocalActivityMask({
    signal,
    segments: [{ startMs: 100, endMs: 120 }],
  });
  const continuous = applyVocalActivityMask({
    signal,
    segments: [{ startMs: 0, endMs: 980 }],
  });

  assert.equal(sparse.applied, false);
  assert.equal(sparse.signal, signal);
  assert.equal(continuous.applied, false);
  assert.equal(continuous.signal, signal);
});

test("multi-pass consensus prefers repeated lyrics and median word boundaries", () => {
  const tiny = createHypothesis("original_tiny", "tiny", "original", [
    timing("blue", 80, 340),
    timing("moon", 350, 700),
  ]);
  const originalBase = createHypothesis("original_base", "base", "original", [
    timing("dans", 100, 360),
    timing("la", 370, 510),
    timing("nuit", 520, 850),
  ]);
  const spectralBase = createHypothesis(
    "spectral_vocal_base",
    "base",
    "spectral_vocal",
    [
      timing("dans", 120, 380),
      timing("la", 390, 530),
      timing("nuit", 540, 880),
    ],
  );

  const consensus = buildLexicalConsensus([tiny, originalBase, spectralBase]);

  assert.equal(consensus.selected.kind, "spectral_vocal_base");
  assert.equal(consensus.acceptedTimings[0].startMs, 110);
  assert.equal(consensus.acceptedTimings[0].consensusVotes, 2);
  assert.equal(consensus.acceptedTimings[0].evidence, "multi_pass_consensus");
  assert.ok(consensus.meanConfidence > 0.6);
  assert.equal(consensus.acceptedTimings.length, 3);
  assert.equal(consensus.rejectedSingletonCount, 0);
  assert.equal(transcriptAgreement("Dans, la nuit", "dans la nuit !"), 1);
});

test("lexical consensus handles missing and single-pass evidence explicitly", () => {
  assert.throws(() => buildLexicalConsensus([]), /Aucune hypothèse lexicale/);
  const single = createHypothesis("original_tiny", "tiny", "original", [
    timing("seule", 120, 520),
  ]);
  const consensus = buildLexicalConsensus([single]);

  assert.equal(consensus.acceptedTimings.length, 1);
  assert.equal(consensus.acceptedTimings[0].consensusVotes, 1);
  assert.equal(consensus.agreementRate, 0);
  assert.equal(transcriptAgreement("", "seule"), 0);
});

test("temporal consensus accepts close sung variants and rejects isolated hallucinations", () => {
  const tiny = createHypothesis("original_tiny", "tiny", "original", [
    timing("lumière", 100, 430),
    timing("fragile", 450, 820),
  ]);
  const originalBase = createHypothesis("original_base", "base", "original", [
    timing("lumières", 120, 450),
    timing("fragile", 470, 840),
  ]);
  const spectralBase = createHypothesis(
    "spectral_vocal_base",
    "base",
    "spectral_vocal",
    [
      timing("lumière", 110, 440),
      timing("fragile", 460, 830),
      timing("fantôme", 850, 980),
    ],
  );

  const consensus = buildLexicalConsensus([tiny, originalBase, spectralBase]);

  assert.deepEqual(
    consensus.acceptedTimings.map(({ word }) =>
      word
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    ),
    ["lumiere", "fragile"],
  );
  assert.ok(consensus.fuzzyMatchedWordCount > 0);
  assert.ok(
    !consensus.acceptedTimings.some(({ word }) => /fantôme/i.test(word)),
  );
});

test("temporal consensus recovers a word confirmed by two non-anchor passes", () => {
  const tiny = createHypothesis("original_tiny", "tiny", "original", [
    timing("dans", 100, 250),
    timing("douce", 270, 440),
    timing("nuit", 460, 700),
    timing("bleue", 720, 920),
  ]);
  const originalBase = createHypothesis("original_base", "base", "original", [
    timing("dans", 110, 260),
    timing("douce", 280, 450),
    timing("nuit", 470, 710),
    timing("claire", 730, 930),
  ]);
  const spectralBase = createHypothesis(
    "spectral_vocal_base",
    "base",
    "spectral_vocal",
    [timing("dans", 120, 270), timing("nuit", 480, 720)],
  );

  const consensus = buildLexicalConsensus([tiny, originalBase, spectralBase]);

  assert.ok(consensus.acceptedTimings.some(({ word }) => word === "douce"));
  assert.ok(
    consensus.acceptedTimings.every(
      ({ word }) => word !== "bleue" && word !== "claire",
    ),
  );
});

test("music benchmark reports lexical errors and temporal boundary drift", () => {
  const result = evaluateMusicPipeline({
    reference: [
      { word: "dans", startMs: 100, endMs: 300 },
      { word: "la", startMs: 310, endMs: 430 },
      { word: "nuit", startMs: 440, endMs: 800 },
    ],
    predicted: [
      { word: "dans", startMs: 120, endMs: 320 },
      { word: "une", startMs: 330, endMs: 450 },
      { word: "nuit", startMs: 460, endMs: 820 },
    ],
  });

  assert.equal(result.wordErrorRate, 0.333);
  assert.equal(result.substitutionCount, 1);
  assert.equal(result.matchedWordRate, 0.667);
  assert.equal(result.boundaryMeanAbsoluteErrorMs, 20);
});

function timing(
  word: string,
  startMs: number,
  endMs: number,
): WhisperWordTiming {
  return { word, startMs, endMs, source: "whisper_attention_timestamp" };
}

function createHypothesis(
  kind: LexicalHypothesis["kind"],
  model: LexicalHypothesis["model"],
  signal: LexicalHypothesis["signal"],
  timings: readonly WhisperWordTiming[],
): LexicalHypothesis {
  const speechSegments = [{ startMs: 0, endMs: 1_000 }];
  const assessment = assessLexicalSegmentation({ timings, speechSegments });
  const transcript = timings.map(({ word }) => word).join(" ");
  const analysis: LocalTakeAnalysis = {
    transcript,
    matchedWordCount: 0,
    expectedWordCount: 0,
    speechSegments,
    whisperWords: timings,
    executionProvider: "wasm",
    segmentSummary: {
      leadingSilenceMs: 0,
      trailingSilenceMs: 0,
      speechDurationMs: 1_000,
      totalDurationMs: 1_000,
    },
    alignmentComparison: {
      schemaVersion: "voice.local_alignment_comparison.v1",
      status: "insufficient",
      reviewRequired: true,
      matchedWordCount: 0,
      expectedWordCount: 0,
      whisperWordCount: timings.length,
      matchRate: 0,
      medianBoundaryDeltaMs: null,
      maximumBoundaryDeltaMs: null,
      words: [],
    },
  };

  return {
    kind,
    model,
    signal,
    analysis,
    assessment,
    decodingStrategy: "greedy",
    activityMaskApplied: false,
    activityCoverage: 1,
  };
}
