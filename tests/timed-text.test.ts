import assert from "node:assert/strict";
import test from "node:test";
import {
  createTimedTextDocument,
  serializeCsv,
  serializeLrc,
  serializeSrt,
  serializeVtt,
} from "../src/domains/timedText";
import {
  createStandaloneTimedTextDocument,
  createTimedTextExportArtifact,
} from "../src/app/export/timedTextExport";

test("timed text normalizes words and groups deterministic readable lines", () => {
  const document = createTimedTextDocument({
    language: "fr",
    source: "local_acoustic_analysis",
    title: "  Une prise test.wav  ",
    words: [
      { word: "Encore", startMs: 1_500.4, endMs: 2_050.2, confidence: 1.4 },
      { word: "Bonjour", startMs: 100.2, endMs: 520.7, confidence: 0.94 },
      { word: "monde.", startMs: 540, endMs: 1_020, confidence: 0.82 },
      { word: " ", startMs: 2_100, endMs: 2_300 },
      { word: "invalide", startMs: 2_400, endMs: 2_300 },
    ],
  });

  assert.ok(document);
  assert.equal(document.schemaVersion, "voice.timed_text.v1");
  assert.equal(document.title, "Une prise test.wav");
  assert.deepEqual(
    document.lines.map((line) => line.text),
    ["Bonjour monde.", "Encore"],
  );
  assert.equal(document.lines[0]?.words[0]?.startMs, 100);
  assert.equal(document.lines[1]?.words[0]?.confidence, 1);
});

test("LRC serializers expose compatible line timing and enhanced word timing", () => {
  const document = fixtureDocument();

  assert.equal(
    serializeLrc(document, false),
    [
      "[ti:prise test]",
      "[by:Voice Capture Studio]",
      "[offset:0]",
      "",
      "[00:00.10]Bonjour monde.",
      "[00:01.50]Encore",
      "",
    ].join("\n"),
  );
  assert.equal(
    serializeLrc(document, true),
    [
      "[ti:prise test]",
      "[by:Voice Capture Studio]",
      "[offset:0]",
      "",
      "[00:00.10]<00:00.10>Bonjour <00:00.54>monde.",
      "[00:01.50]<00:01.50>Encore",
      "",
    ].join("\n"),
  );
});

test("subtitle and analysis serializers preserve explicit timing provenance", () => {
  const document = fixtureDocument();

  assert.match(
    serializeSrt(document),
    /1\n00:00:00,100 --> 00:00:01,020\nBonjour monde\./u,
  );
  assert.match(
    serializeVtt(document),
    /^WEBVTT\n\n00:00:00\.100 --> 00:00:01\.020\nBonjour monde\./u,
  );
  const csv = serializeCsv(document);
  assert.match(csv, /"Bonjour",100,521,0\.94,local_acoustic_analysis/u);
  assert.match(csv, /"Encore",1500,2050,1,local_acoustic_analysis/u);
});

test("standalone timing metadata projects to safe user-selected file names", () => {
  const document = createStandaloneTimedTextDocument({
    language: "fr",
    metadata: {
      timing: {
        source: "browser_live_alignment",
        words: [
          { word: "Une", startMs: 0, endMs: 220 },
          { word: "voix", startMs: 250, endMs: 680 },
        ],
      },
    },
  });

  assert.ok(document);
  assert.equal(document.source, "browser_live_alignment");
  const artifact = createTimedTextExportArtifact({
    baseName: "Ma prise d'été.wav",
    document,
    format: "enhanced-lrc",
  });
  assert.equal(artifact.fileName, "Ma-prise-d-ete.enhanced.lrc");
  assert.match(artifact.description, /suivi vocal en direct/u);
});

function fixtureDocument() {
  const document = createTimedTextDocument({
    language: "fr",
    source: "local_acoustic_analysis",
    title: "prise test",
    words: [
      { word: "Bonjour", startMs: 100.2, endMs: 520.7, confidence: 0.94 },
      { word: "monde.", startMs: 540, endMs: 1_020, confidence: 0.82 },
      { word: "Encore", startMs: 1_500.4, endMs: 2_050.2, confidence: 1.4 },
    ],
  });
  assert.ok(document);
  return document;
}
