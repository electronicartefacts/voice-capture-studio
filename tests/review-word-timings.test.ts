import assert from "node:assert/strict";
import test from "node:test";
import {
  createReviewWordTimings,
  findActiveReviewWordIndex,
} from "../src/app/audio/reviewWordTimings";
import type { RecordedTake } from "../src/domains/sessions";

function takeWithTimings(): RecordedTake {
  return {
    durationMs: 2_000,
    transcript: { spokenText: "Bonjour monde" },
    timing: {
      words: [
        { word: "Bonjour", startMs: 0, endMs: 600 },
        { word: "monde", startMs: 600, endMs: 1_200 },
      ],
      localAcousticAnalysis: {
        words: [
          {
            word: "Bonjour",
            startMs: 420,
            endMs: 980,
            source: "whisper_attention_timestamp",
          },
          {
            word: "monde",
            startMs: 1_050,
            endMs: 1_640,
            source: "whisper_attention_timestamp",
          },
        ],
      },
    },
  } as RecordedTake;
}

test("replay uses acoustic Whisper timings instead of early G2P estimates", () => {
  const timings = createReviewWordTimings(takeWithTimings());

  assert.equal(timings[0].startMs, 420);
  assert.equal(timings[1].startMs, 1_050);
});

test("replay gives verified forced alignment the highest priority", () => {
  const take = takeWithTimings();
  const timings = createReviewWordTimings({
    ...take,
    timing: {
      ...take.timing,
      forcedAlignment: {
        words: [{ word: "Bonjour", startMs: 500, endMs: 1_000 }],
      },
    },
  } as RecordedTake);

  assert.equal(timings.length, 1);
  assert.equal(timings[0].startMs, 500);
});

test("replay does not highlight transcription during leading silence", () => {
  const timings = createReviewWordTimings(takeWithTimings());

  assert.equal(findActiveReviewWordIndex(timings, 0), -1);
  assert.equal(findActiveReviewWordIndex(timings, 419), -1);
  assert.equal(findActiveReviewWordIndex(timings, 420), 0);
  assert.equal(findActiveReviewWordIndex(timings, 1_020), 0);
  assert.equal(findActiveReviewWordIndex(timings, 1_050), 1);
});
