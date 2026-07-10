import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserAsrObservation } from "../src/app/analysis/browserAsrObservation";

test("browser ASR observation keeps runtime, confidence, and final/intermediate evidence", () => {
  const observation = createBrowserAsrObservation({
    available: true,
    engine: "webkitSpeechRecognition",
    generatedAt: "2026-07-10T10:00:00.000Z",
    hypotheses: [
      {
        resultIndex: 0,
        alternativeIndex: 0,
        text: "bonjour",
        confidence: 0.84,
        final: true,
        capturedAtMs: 420,
      },
      {
        resultIndex: 1,
        alternativeIndex: 0,
        text: "le monde",
        confidence: null,
        final: false,
        capturedAtMs: 610,
      },
    ],
    locale: "fr-FR",
    userAgent:
      "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
  });

  assert.equal(observation.transcript, "bonjour");
  assert.equal(observation.runtime.browserName, "Chrome");
  assert.equal(observation.runtime.browserVersion, "126.0.0.0");
  assert.equal(observation.confidence.value, 0.84);
  assert.equal(observation.hypotheses[1].final, false);
});

test("unavailable browser ASR remains a valid absence of evidence", () => {
  const observation = createBrowserAsrObservation({
    available: false,
    engine: null,
    generatedAt: "2026-07-10T10:00:00.000Z",
    hypotheses: [],
    locale: "en-US",
  });

  assert.equal(observation.availability, "unavailable");
  assert.equal(observation.transcript, null);
  assert.equal(observation.confidence.status, "unavailable");
});
