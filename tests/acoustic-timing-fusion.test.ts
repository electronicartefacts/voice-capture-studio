import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLocalAcousticTiming,
  createAcousticPhraseTimings,
} from "../src/app/analysis/acousticTimingFusion";
import type {
  LocalAcousticAnalysis,
  RecordedTake,
} from "../src/domains/sessions";

test("local acoustic evidence promotes exact word and sentence timings", () => {
  const take = createTake();
  const analysis: LocalAcousticAnalysis = {
    schemaVersion: "voice.local_acoustic_analysis.v1",
    engine: "whisper-adaptive",
    transcript: "Bonjour monde. Encore.",
    analyzedAt: "2026-07-18T10:01:00.000Z",
    words: [
      whisperWord("Bonjour", 240, 680),
      whisperWord("monde", 720, 1_130),
      whisperWord("Encore", 1_510, 2_020),
    ],
    speechSegments: [
      { startMs: 220, endMs: 1_170, source: "silero_vad" },
      { startMs: 1_480, endMs: 2_060, source: "silero_vad" },
    ],
    alignmentComparison: {
      schemaVersion: "voice.local_alignment_comparison.v1",
      status: "acceptable",
      reviewRequired: false,
      matchedWordCount: 3,
      expectedWordCount: 3,
      whisperWordCount: 3,
      matchRate: 1,
      medianBoundaryDeltaMs: 120,
      maximumBoundaryDeltaMs: 180,
      words: [
        comparisonWord("Bonjour", 0, 0, 0, 800, 240, 680),
        comparisonWord("monde", 1, 1, 800, 1_600, 720, 1_130),
        comparisonWord("Encore", 2, 2, 1_600, 2_400, 1_510, 2_020),
      ],
    },
  };

  const fused = applyLocalAcousticTiming({ analysis, take });

  assert.deepEqual(
    fused.timing.words.map(({ startMs, endMs }) => ({ startMs, endMs })),
    [
      { startMs: 240, endMs: 680 },
      { startMs: 720, endMs: 1_130 },
      { startMs: 1_510, endMs: 2_020 },
    ],
  );
  assert.deepEqual(fused.timing.phrases, [
    { text: "Bonjour monde.", startMs: 240, endMs: 1_130 },
    { text: "Encore.", startMs: 1_510, endMs: 2_020 },
  ]);
  assert.equal(fused.timing.localAcousticAnalysis, analysis);
  assert.ok((fused.timing.phonemes?.[0]?.startMs ?? 0) >= 0);
  assert.equal(fused.timing.alignment?.words[0]?.startMs, 240);
});

test("phrase timing keeps punctuation-only text explicit", () => {
  assert.deepEqual(
    createAcousticPhraseTimings(
      "... !",
      [{ word: "silence", startMs: 100, endMs: 300 }],
      400,
    ),
    [{ text: "... !", startMs: 100, endMs: 300 }],
  );
});

function createTake(): RecordedTake {
  const words = ["Bonjour", "monde", "Encore"].map((word, index) => ({
    word,
    normalized: word.toLowerCase(),
    tokenIndex: index,
    startMs: index * 800,
    endMs: (index + 1) * 800,
    confidence: 0.5,
    syllableCount: 1,
    phonemes: [
      {
        phoneme: "a",
        startMs: index * 800,
        endMs: (index + 1) * 800,
        confidence: 0.5,
        wordIndex: index,
        source: "local_grapheme_phoneme_estimate" as const,
      },
    ],
  }));
  const alignmentWords = words.map((word, index) => ({
    ...word,
    startChar: index * 8,
    endChar: index * 8 + word.word.length,
  }));
  const phonemes = words.flatMap((word) => word.phonemes);
  return {
    id: "take.test" as RecordedTake["id"],
    promptId: "prompt.test" as RecordedTake["promptId"],
    fileName: "take.wav",
    durationMs: 2_400,
    recordedAt: "2026-07-18T10:00:00.000Z" as RecordedTake["recordedAt"],
    transcript: {
      schemaVersion: "voice.transcript.v2",
      originalText: "Bonjour monde. Encore.",
      spokenText: "Bonjour monde. Encore.",
      strictMatchRequired: true,
      annotations: [],
    },
    timing: {
      schemaVersion: "voice.timing.v2",
      durationMs: 2_400,
      words,
      phonemes,
      phrases: [{ text: "Bonjour monde. Encore.", startMs: 0, endMs: 2_400 }],
      alignment: {
        schemaVersion: "voice.phoneme_alignment.v1",
        language: "fr",
        source: "local_grapheme_phoneme_estimate",
        dictionary: "rule_based_fr_en_v1",
        durationMs: 2_400,
        confidence: 0.5,
        forcedAlignmentRequired: true,
        tokens: [],
        words: alignmentWords,
        phonemes,
        inventory: ["a"],
        warnings: [],
      },
    },
  } as RecordedTake;
}

function whisperWord(word: string, startMs: number, endMs: number) {
  return {
    word,
    startMs,
    endMs,
    source: "whisper_attention_timestamp" as const,
  };
}

function comparisonWord(
  word: string,
  expectedIndex: number,
  whisperIndex: number,
  estimatedStartMs: number,
  estimatedEndMs: number,
  whisperStartMs: number,
  whisperEndMs: number,
) {
  return {
    word,
    expectedIndex,
    whisperIndex,
    estimatedStartMs,
    estimatedEndMs,
    whisperStartMs,
    whisperEndMs,
    boundaryDeltaMs: Math.max(
      Math.abs(estimatedStartMs - whisperStartMs),
      Math.abs(estimatedEndMs - whisperEndMs),
    ),
  };
}
