import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCaptureDurationLimit,
  FREE_CAPTURE_MAX_DURATION_MS,
} from "../src/app/recording/captureLimits";

test("free capture has a bounded mobile-safe duration", () => {
  assert.equal(FREE_CAPTURE_MAX_DURATION_MS, 10 * 60 * 1000);
});

test("capture duration limits remain readable in the interface", () => {
  assert.equal(
    formatCaptureDurationLimit(FREE_CAPTURE_MAX_DURATION_MS),
    "10 min",
  );
  assert.equal(formatCaptureDurationLimit(90_000), "1 min 30 s");
});
