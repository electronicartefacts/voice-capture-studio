import assert from "node:assert/strict";
import test from "node:test";
import {
  assessLexicalSegmentation,
  selectLexicalProcessingProfile,
} from "../src/app/analysis/lexicalSegmentationQuality";

const source = "whisper_attention_timestamp" as const;

test("rejects hallucinated timings outside independently detected voice", () => {
  const result = assessLexicalSegmentation({
    speechSegments: [{ startMs: 1_000, endMs: 2_000 }],
    timings: [
      { word: "musique", startMs: 50, endMs: 400, source },
      { word: "voix", startMs: 1_100, endMs: 1_500, source },
    ],
  });

  assert.deepEqual(
    result.acceptedTimings.map((timing) => timing.word),
    ["voix"],
  );
  assert.equal(result.quality.status, "review");
  assert.equal(result.quality.reviewRequired, true);
  assert.equal(result.quality.rejectedWordCount, 1);
});

test("refuses a transcript when no independent voice is detected", () => {
  const result = assessLexicalSegmentation({
    speechSegments: [],
    timings: [{ word: "inventé", startMs: 0, endMs: 500, source }],
  });

  assert.equal(result.quality.status, "insufficient");
  assert.deepEqual(result.acceptedTimings, []);
});

test("filters implausible word durations and punctuation-only chunks", () => {
  const result = assessLexicalSegmentation({
    speechSegments: [{ startMs: 0, endMs: 6_000 }],
    timings: [
      { word: "!", startMs: 0, endMs: 300, source },
      { word: "trop-court", startMs: 400, endMs: 430, source },
      { word: "chant", startMs: 500, endMs: 1_200, source },
      { word: "interminable", startMs: 1_300, endMs: 5_900, source },
    ],
  });

  assert.deepEqual(
    result.acceptedTimings.map((timing) => timing.word),
    ["chant"],
  );
  assert.equal(result.quality.status, "insufficient");
});

test("selects an inclusive compatible profile for long or constrained runs", () => {
  assert.equal(
    selectLexicalProcessingProfile({
      durationMs: 11 * 60_000,
      webGpuAvailable: true,
      wasmThreadsAvailable: true,
    }),
    "compatible",
  );
  assert.equal(
    selectLexicalProcessingProfile({
      durationMs: 60_000,
      webGpuAvailable: false,
      wasmThreadsAvailable: false,
    }),
    "compatible",
  );
  assert.equal(
    selectLexicalProcessingProfile({
      durationMs: 60_000,
      webGpuAvailable: false,
      wasmThreadsAvailable: true,
    }),
    "balanced",
  );
});
