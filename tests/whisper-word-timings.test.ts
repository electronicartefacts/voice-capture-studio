import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWhisperWordTimings } from "../src/app/analysis/whisperWordTimings";

test("Whisper word timestamps are bounded, monotonic, and provenance-labeled", () => {
  const words = normalizeWhisperWordTimings(
    [
      { text: " Bonjour", timestamp: [0.12, 0.62] },
      { text: " monde", timestamp: [0.6, 1.4] },
      { text: " invalid", timestamp: [null, 1.6] },
      { text: " clipped", timestamp: [1.4, 2.5] },
    ],
    2_000,
  );

  assert.deepEqual(words, [
    {
      word: "Bonjour",
      startMs: 120,
      endMs: 620,
      source: "whisper_attention_timestamp",
    },
    {
      word: "monde",
      startMs: 620,
      endMs: 1400,
      source: "whisper_attention_timestamp",
    },
    {
      word: "clipped",
      startMs: 1400,
      endMs: 2000,
      source: "whisper_attention_timestamp",
    },
  ]);
});
