import assert from "node:assert/strict";
import test from "node:test";
import { createWordAudioSegments } from "../src/app/analysis/importedMediaSegmentation";

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
      audioPath: "audio/mots/0003_voix-locale.wav",
    },
  ]);
});
