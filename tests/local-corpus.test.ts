import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalTextCorpus,
  createPromptSegments,
} from "../src/domains/corpus";
import type { LanguageCode } from "../src/shared";

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
