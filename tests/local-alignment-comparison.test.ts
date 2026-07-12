import assert from "node:assert/strict";
import test from "node:test";
import { compareLocalWordAlignments } from "../src/app/analysis/localAlignmentComparison";
import { alignPromptToPhonemes } from "../src/domains/phonetics";
import type { LanguageCode } from "../src/shared";

test("local alignment comparison matches repeated evidence without hiding divergence", () => {
  const estimated = alignPromptToPhonemes({
    durationMs: 1000,
    language: "fr" as LanguageCode,
    text: "Bonjour monde",
  });
  const strong = compareLocalWordAlignments({
    estimatedWords: estimated.words,
    whisperWords: estimated.words.map((word) => ({
      word: word.word,
      startMs: word.startMs + 20,
      endMs: word.endMs + 20,
      source: "whisper_attention_timestamp" as const,
    })),
  });

  assert.equal(strong.status, "strong");
  assert.equal(strong.matchRate, 1);
  assert.equal(strong.medianBoundaryDeltaMs, 20);

  const divergent = compareLocalWordAlignments({
    estimatedWords: estimated.words,
    whisperWords: [
      {
        word: "Bonjour",
        startMs: 400,
        endMs: 900,
        source: "whisper_attention_timestamp",
      },
    ],
  });
  assert.equal(divergent.status, "insufficient");
  assert.equal(divergent.reviewRequired, true);
});
