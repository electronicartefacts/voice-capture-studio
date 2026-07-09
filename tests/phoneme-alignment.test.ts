import assert from "node:assert/strict";
import test from "node:test";
import {
  alignPromptToPhonemes,
  estimateTranscriptMatch,
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
  assert.equal(promptOnly.score, 0.96);
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
