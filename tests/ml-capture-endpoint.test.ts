import assert from "node:assert/strict";
import test from "node:test";
import { isConfirmedMlEndpointReady } from "../src/app/recording/mlCaptureEndpoint";

test("ML endpoint waits for a real tail after final script confirmation", () => {
  assert.equal(
    isConfirmedMlEndpointReady({
      finalAlignmentConfirmedAtMs: 1_000,
      nowMs: 1_400,
      expressiveEnding: false,
      speechActive: false,
      trailingSilenceMs: 400,
    }),
    false,
  );
  assert.equal(
    isConfirmedMlEndpointReady({
      finalAlignmentConfirmedAtMs: 1_000,
      nowMs: 1_600,
      expressiveEnding: false,
      speechActive: false,
      trailingSilenceMs: 600,
    }),
    true,
  );
});

test("ML endpoint cannot be held open forever by a sticky VAD", () => {
  assert.equal(
    isConfirmedMlEndpointReady({
      finalAlignmentConfirmedAtMs: 1_000,
      nowMs: 2_400,
      expressiveEnding: false,
      speechActive: true,
      trailingSilenceMs: 0,
    }),
    false,
  );
  assert.equal(
    isConfirmedMlEndpointReady({
      finalAlignmentConfirmedAtMs: 1_000,
      nowMs: 2_550,
      expressiveEnding: false,
      speechActive: true,
      trailingSilenceMs: 0,
    }),
    true,
  );
});

test("ML endpoint gives expressive endings a longer safety tail", () => {
  assert.equal(
    isConfirmedMlEndpointReady({
      finalAlignmentConfirmedAtMs: 1_000,
      nowMs: 2_700,
      expressiveEnding: true,
      speechActive: true,
      trailingSilenceMs: 0,
    }),
    false,
  );
  assert.equal(
    isConfirmedMlEndpointReady({
      finalAlignmentConfirmedAtMs: 1_000,
      nowMs: 2_900,
      expressiveEnding: true,
      speechActive: true,
      trailingSilenceMs: 0,
    }),
    true,
  );
});
