import assert from "node:assert/strict";
import test from "node:test";

import { getAnalysisDurationMs } from "../src/app/analysis/localTakeAnalysis";

test("local analysis keeps its duration before transferring audio to the worker", () => {
  const audio = new Float32Array(16_000 * 3);
  const durationMs = getAnalysisDurationMs(audio);

  structuredClone(audio.buffer, { transfer: [audio.buffer] });

  assert.equal(audio.length, 0);
  assert.equal(durationMs, 3_000);
});
