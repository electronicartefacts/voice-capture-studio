import assert from "node:assert/strict";
import test from "node:test";
import {
  createFreeCaptureTranscript,
  extractFinalSpeechRecognitionTranscript,
  extractSpeechRecognitionTranscript,
  mergeSpeechRecognitionHypotheses,
  type SpeechRecognitionEventLike,
} from "../src/app/shell/speech";

function recognitionEvent(): SpeechRecognitionEventLike {
  return {
    results: {
      0: {
        0: { transcript: "Bonjour", confidence: 0.98 },
        isFinal: true,
        length: 1,
      },
      1: {
        0: { transcript: "le monde", confidence: 0.71 },
        isFinal: false,
        length: 1,
      },
      length: 2,
    },
  };
}

test("free capture retains final speech hypotheses and never stores an interim word", () => {
  const event = recognitionEvent();

  assert.equal(extractSpeechRecognitionTranscript(event), "Bonjour le monde");
  assert.equal(extractFinalSpeechRecognitionTranscript(event), "Bonjour");
});

test("free capture transcript keeps normalized words and repeated occurrences", () => {
  const transcript = createFreeCaptureTranscript({
    finalTranscript: "L'été, c'est l'été.",
    recognitionAvailable: true,
  });

  assert.equal(transcript.schemaVersion, "voice.free_transcript.v1");
  assert.equal(transcript.status, "detected");
  assert.equal(transcript.wordCount, 3);
  assert.deepEqual(transcript.words, [
    { word: "L'été", normalized: "lete", occurrence: 1 },
    { word: "c'est", normalized: "cest", occurrence: 1 },
    { word: "l'été", normalized: "lete", occurrence: 2 },
  ]);
});

test("free capture records when word recognition was unavailable", () => {
  const transcript = createFreeCaptureTranscript({
    finalTranscript: "",
    recognitionAvailable: false,
  });

  assert.equal(transcript.engine, "unavailable");
  assert.equal(transcript.status, "unavailable");
  assert.equal(transcript.wordCount, 0);
});

test("speech hypotheses retain finality, confidence, and their first final timestamp", () => {
  const first = mergeSpeechRecognitionHypotheses([], recognitionEvent(), 120);
  const replayed = mergeSpeechRecognitionHypotheses(
    first,
    recognitionEvent(),
    450,
  );

  assert.deepEqual(replayed, [
    {
      resultIndex: 0,
      alternativeIndex: 0,
      text: "Bonjour",
      confidence: 0.98,
      final: true,
      capturedAtMs: 120,
    },
    {
      resultIndex: 1,
      alternativeIndex: 0,
      text: "le monde",
      confidence: 0.71,
      final: false,
      capturedAtMs: 450,
    },
  ]);
});
