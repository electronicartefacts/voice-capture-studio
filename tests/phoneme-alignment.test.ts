import assert from "node:assert/strict";
import test from "node:test";
import {
  alignPromptToPhonemes,
  createAlignmentConsensus,
  estimateTranscriptMatch,
  importForcedAlignment,
  tokenizeTranscript,
} from "../src/domains/phonetics";
import type { LanguageCode } from "../src/shared";
import { assertForcedAlignmentMatchesTranscript } from "../src/domains/sessions/forcedAlignment";

test("phoneme alignment links every token to timed phonemes", () => {
  const alignment = alignPromptToPhonemes({
    durationMs: 2400,
    language: "fr" as LanguageCode,
    text: "Bonjour, la voix reste claire.",
  });

  assert.equal(alignment.schemaVersion, "voice.phoneme_alignment.v1");
  assert.equal(alignment.words.length, 5);
  assert.equal(alignment.words[0].startMs, 0);
  assert.equal(alignment.words.at(-1)?.endMs, 2400);
  assert.ok(alignment.phonemes.length > alignment.words.length);
  assert.ok(
    alignment.words.every((word) =>
      word.phonemes.every((phoneme) => phoneme.wordIndex === word.tokenIndex),
    ),
  );
  assert.ok(alignment.inventory.includes("on"));
  assert.ok(
    alignment.warnings.includes(
      "browser_alignment_is_text_derived_not_acoustic",
    ),
  );
});

test("alignment consensus favors acoustic agreement and exposes disagreement", () => {
  const estimated = alignPromptToPhonemes({
    durationMs: 1200,
    language: "fr" as LanguageCode,
    text: "Bonjour",
  });
  const acoustic = [
    createForcedAlignment("MFA", 180, 980, 0.95),
    createForcedAlignment("WhisperX", 200, 1000, 0.9),
  ];
  const consensus = createAlignmentConsensus({
    estimated,
    acoustic,
    now: new Date("2026-07-13T10:00:00.000Z"),
  });

  assert.equal(consensus.words[0].startMs, 180);
  assert.equal(consensus.words[0].endMs, 1000);
  assert.equal(consensus.consensus?.sourceCount, 3);
  assert.equal(consensus.consensus?.acousticSourceCount, 2);
  assert.equal(consensus.consensus?.status, "strong");
  assert.equal(consensus.consensus?.reviewRequired, false);
  assert.deepEqual(
    consensus.consensus?.sources.map((source) => source.words[0].startMs),
    [0, 180, 200],
  );

  const divergent = createAlignmentConsensus({
    estimated,
    acoustic: [
      createForcedAlignment("MFA", 100, 700, 0.95),
      createForcedAlignment("WhisperX", 400, 1100, 0.9),
    ],
  });
  assert.equal(divergent.consensus?.status, "review");
  assert.equal(divergent.consensus?.reviewRequired, true);
});

test("one external aligner can form a three-way consensus with local Whisper and G2P", () => {
  const estimated = alignPromptToPhonemes({
    durationMs: 1200,
    language: "fr" as LanguageCode,
    text: "Bonjour",
  });
  const consensus = createAlignmentConsensus({
    estimated,
    localAcoustic: {
      confidence: 0.84,
      words: [{ word: "Bonjour", startMs: 190, endMs: 990 }],
    },
    acoustic: [createForcedAlignment("MFA", 180, 980, 0.95)],
  });

  assert.equal(consensus.consensus?.sourceCount, 3);
  assert.equal(consensus.consensus?.acousticSourceCount, 2);
  assert.equal(consensus.consensus?.status, "strong");
  assert.match(consensus.aligner, /Local Whisper \+ MFA/);
  assert.equal(consensus.phonemes.length, 1);
  assert.deepEqual(
    consensus.consensus?.sources.map((source) => source.kind),
    ["estimated", "local_acoustic", "acoustic"],
  );
});

function createForcedAlignment(
  aligner: string,
  startMs: number,
  endMs: number,
  confidence: number,
) {
  return importForcedAlignment({
    aligner,
    language: "fr",
    durationMs: 1200,
    confidence,
    words: [{ word: "Bonjour", startMs, endMs, confidence, phonemes: [] }],
    phonemes: [
      {
        phoneme: "b",
        startMs,
        endMs,
        confidence,
        wordIndex: 0,
      },
    ],
  });
}

test("english alignment emits ascii phone labels and bounded intervals", () => {
  const alignment = alignPromptToPhonemes({
    durationMs: 1800,
    language: "en" as LanguageCode,
    text: "The room sounds clean.",
  });

  assert.equal(alignment.words.length, 4);
  assert.ok(alignment.inventory.includes("TH"));
  assert.ok(
    alignment.phonemes.every(
      (phoneme) =>
        phoneme.startMs >= 0 &&
        phoneme.endMs <= 1800 &&
        phoneme.endMs >= phoneme.startMs,
    ),
  );
});

test("alignment follows recorded speech instead of stretching over room silence", () => {
  const alignment = alignPromptToPhonemes({
    activitySegments: [
      { startMs: 420, endMs: 1_100 },
      { startMs: 1_360, endMs: 2_240 },
    ],
    durationMs: 2_800,
    language: "fr" as LanguageCode,
    text: "La voix reste claire.",
  });

  assert.equal(alignment.words[0].startMs, 420);
  assert.equal(alignment.words.at(-1)?.endMs, 2_240);
  assert.ok(alignment.words.every((word) => word.startMs >= 420));
  assert.ok(alignment.words.every((word) => word.endMs <= 2_240));
  assert.ok(
    alignment.warnings.includes(
      "timing_constrained_to_recorded_speech_activity",
    ),
  );
});

test("transcript token matching distinguishes prompt-only and observed speech", () => {
  const promptOnly = estimateTranscriptMatch({
    expectedText: "La voix reste claire.",
  });
  const observed = estimateTranscriptMatch({
    expectedText: "La voix reste claire.",
    observedText: "La voix reste claire",
  });
  const mismatch = estimateTranscriptMatch({
    expectedText: "La voix reste claire.",
    observedText: "Le micro coupe la phrase",
  });

  assert.equal(promptOnly.source, "prompt_only");
  assert.equal(promptOnly.score, 0);
  assert.equal(observed.source, "web_speech");
  assert.equal(observed.score, 1);
  assert.ok(mismatch.score < 0.5);
  assert.deepEqual(
    tokenizeTranscript("L'audio reste stable.").map(
      (token) => token.normalized,
    ),
    ["l'audio", "reste", "stable"],
  );
});

test("forced alignment import keeps acoustic provenance and rejects invalid intervals", () => {
  const alignment = importForcedAlignment(
    {
      aligner: "WhisperX",
      language: "fr",
      durationMs: 1200,
      confidence: 0.91,
      words: [
        {
          word: "Bonjour",
          startMs: 0,
          endMs: 1200,
          confidence: 0.91,
          phonemes: [],
        },
      ],
      phonemes: [
        {
          phoneme: "b",
          startMs: 0,
          endMs: 500,
          confidence: 0.9,
          wordIndex: 0,
        },
      ],
    },
    { now: new Date("2026-07-10T10:00:00.000Z") },
  );

  assert.equal(alignment.source, "external_acoustic_forced_alignment");
  assert.equal(alignment.aligner, "WhisperX");
  assert.equal(alignment.importedAt, "2026-07-10T10:00:00.000Z");
  assert.doesNotThrow(() =>
    assertForcedAlignmentMatchesTranscript(alignment, "Bonjour !"),
  );
  assert.throws(
    () => assertForcedAlignmentMatchesTranscript(alignment, "Bonsoir"),
    /ne correspond pas à la prise ciblée/,
  );
  assert.throws(() =>
    importForcedAlignment({
      aligner: "WhisperX",
      language: "fr",
      durationMs: 1200,
      confidence: 0.91,
      words: [
        {
          word: "Bonjour",
          startMs: 900,
          endMs: 400,
          confidence: 0.91,
          phonemes: [],
        },
      ],
      phonemes: [
        {
          phoneme: "b",
          startMs: 0,
          endMs: 500,
          confidence: 0.9,
          wordIndex: 0,
        },
      ],
    }),
  );
  assert.throws(() =>
    importForcedAlignment({
      aligner: "MFA",
      language: "fr",
      durationMs: 1200,
      confidence: 0.9,
      words: [
        { word: "Bon", startMs: 0, endMs: 700, confidence: 0.9, phonemes: [] },
        {
          word: "jour",
          startMs: 600,
          endMs: 1000,
          confidence: 0.9,
          phonemes: [],
        },
      ],
      phonemes: [
        { phoneme: "b", startMs: 0, endMs: 500, confidence: 0.9, wordIndex: 0 },
      ],
    }),
  );
});
