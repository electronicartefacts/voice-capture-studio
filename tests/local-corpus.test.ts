import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalTextCorpus,
  createPromptSegments,
} from "../src/domains/corpus";
import type { LanguageCode } from "../src/shared";
import { planSession } from "../src/domains/sessions";
import { createEmptyWorkspace } from "../src/domains/workspace";
import { initialSpeakers } from "../src/domains/speakers";

const fr = "fr" as LanguageCode;

test("local text corpus turns script lines into recordable prompts", () => {
  const corpus = createLocalTextCorpus({
    mode: "dubbing",
    language: fr,
    sourceName: "scene-12.txt",
    text: [
      "ELLE: Tu es sur que c'est la bonne porte ?",
      "LUI: Non. Mais on n'a plus vraiment le choix.",
      "ELLE: Alors ouvre, doucement.",
    ].join("\n"),
  });

  assert.ok(corpus);
  assert.equal(corpus.summary.promptCount, 3);
  assert.equal(corpus.summary.sourceName, "scene-12.txt");
  assert.equal(corpus.corpus.scenarios[0]?.title, "Script de doublage");
  assert.equal(
    corpus.corpus.scenarios[0]?.prompts[0]?.text,
    "Tu es sur que c'est la bonne porte ?",
  );
  assert.equal(
    corpus.corpus.scenarios[0]?.prompts[0]?.intention.primary,
    "cinematic_dialogue",
  );
});

test("local text corpus ids are stable for the same content and isolated by mode", () => {
  const text = "Respire avant l'attaque. Garde la fin propre.";
  const dubbing = createLocalTextCorpus({
    mode: "dubbing",
    language: fr,
    text,
  });
  const sameDubbing = createLocalTextCorpus({
    mode: "dubbing",
    language: fr,
    text,
  });
  const mastering = createLocalTextCorpus({
    mode: "mastering",
    language: fr,
    text,
  });

  assert.ok(dubbing);
  assert.ok(sameDubbing);
  assert.ok(mastering);
  assert.equal(dubbing.corpus.id, sameDubbing.corpus.id);
  assert.notEqual(dubbing.corpus.id, mastering.corpus.id);
  assert.equal(
    mastering.corpus.scenarios[0]?.prompts[0]?.intention.primary,
    "music_master_take",
  );
});

test("local text segmentation ignores empty input and chunks long prose", () => {
  assert.deepEqual(createPromptSegments(" \n\n "), []);

  const segments = createPromptSegments(
    "Une premiere phrase assez courte. Une deuxieme phrase qui continue le mouvement. " +
      "Puis un long passage sans retour ligne pour verifier que le corpus reste utilisable meme quand le texte vient d'un bloc colle dans le navigateur.",
  );

  assert.ok(segments.length >= 2);
  assert.ok(segments.every((segment) => segment.trim().length > 0));
});

test("local text corpus parses SRT and VTT cues without recording timecodes", () => {
  const srt = createLocalTextCorpus({
    mode: "dubbing",
    language: fr,
    sourceName: "scene.srt",
    text: [
      "1",
      "00:00:01,000 --> 00:00:03,000",
      "ELLE: Bonjour, comment ça va ?",
      "",
      "2",
      "00:00:04,000 --> 00:00:06,000",
      "LUI: Très bien, merci.",
    ].join("\n"),
  });

  assert.ok(srt);
  assert.deepEqual(
    srt.corpus.scenarios[0]?.prompts.map((prompt) => prompt.text),
    ["Bonjour, comment ça va ?", "Très bien, merci."],
  );
  assert.equal(srt.summary.timedPromptCount, 2);
  assert.deepEqual(srt.corpus.scenarios[0]?.prompts[0]?.sourceTiming, {
    startMs: 1_000,
    endMs: 3_000,
  });

  const vtt = createPromptSegments(
    ["WEBVTT", "", "00:00:01.000 --> 00:00:02.000", "<v Alice>Oui."].join("\n"),
    "scene.vtt",
  );

  assert.deepEqual(vtt, ["Oui."]);
});

test("local script sessions preserve scene order instead of ML coverage priority", () => {
  const corpus = createLocalTextCorpus({
    mode: "dubbing",
    language: fr,
    sourceName: "scene.srt",
    text: [
      "1",
      "00:00:01,000 --> 00:00:02,000",
      "Première réplique.",
      "",
      "2",
      "00:00:03,000 --> 00:00:04,000",
      "Deuxième réplique.",
      "",
      "3",
      "00:00:05,000 --> 00:00:06,000",
      "Troisième réplique.",
    ].join("\n"),
  });

  assert.ok(corpus);
  const workspace = createEmptyWorkspace({
    corpus: corpus.corpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-11T09:00:00.000Z"),
  });
  const session = planSession({
    workspace,
    corpus: corpus.corpus,
    speakerId: initialSpeakers[0].id,
    language: fr,
    targetMinutes: 5,
    now: new Date("2026-07-11T09:01:00.000Z"),
    strategy: "sequential",
  });

  assert.deepEqual(
    session.plannedPromptIds,
    corpus.corpus.scenarios[0]?.prompts.map((prompt) => prompt.id),
  );
});

test("local corpus keeps one-word lines and does not silently truncate scripts", () => {
  assert.deepEqual(createPromptSegments("Oui.\nNon.\nD'accord."), [
    "Oui.",
    "Non.",
    "D'accord.",
  ]);

  const lines = Array.from({ length: 81 }, (_, index) => `Ligne ${index + 1}.`);

  assert.equal(createPromptSegments(lines.join("\n")).length, 81);
});
