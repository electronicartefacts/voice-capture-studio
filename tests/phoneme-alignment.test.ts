import assert from "node:assert/strict";
import test from "node:test";
import {
  alignPromptToPhonemes,
  estimateTranscriptMatch,
  importForcedAlignment,
  tokenizeTranscript,
} from "../src/domains/phonetics";
import type { LanguageCode } from "../src/shared";

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
});
