import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCorpus } from "../src/domains/corpus";

test("canonical corpus has stable unique scenario and prompt ids", () => {
  const scenarioIds = new Set<string>();
  const promptIds = new Set<string>();

  for (const scenario of canonicalCorpus.scenarios) {
    assert.equal(
      scenarioIds.has(scenario.id),
      false,
      `duplicate scenario id: ${scenario.id}`,
    );
    scenarioIds.add(scenario.id);

    assert.ok(
      canonicalCorpus.languages.includes(scenario.language),
      `scenario ${scenario.id} uses undeclared language ${scenario.language}`,
    );
    assert.ok(
      scenario.prompts.length > 0,
      `scenario ${scenario.id} should contain prompts`,
    );

    for (const prompt of scenario.prompts) {
      assert.equal(
        promptIds.has(prompt.id),
        false,
        `duplicate prompt id: ${prompt.id}`,
      );
      promptIds.add(prompt.id);

      assert.ok(
        String(prompt.id).startsWith(`prompt.${scenario.language}.`),
        `prompt ${prompt.id} should be namespaced by scenario language ${scenario.language}`,
      );
    }
  }
});

test("canonical prompts keep capture gates and bounded emotion metadata", () => {
  for (const scenario of canonicalCorpus.scenarios) {
    for (const prompt of scenario.prompts) {
      assert.ok(
        prompt.text.trim().length > 0,
        `prompt ${prompt.id} should have text`,
      );
      assert.ok(
        prompt.phonetics.focus.length > 0,
        `prompt ${prompt.id} should define phonetic focus`,
      );
      assert.ok(
        prompt.phonetics.coverage.length > 0,
        `prompt ${prompt.id} should define phonetic coverage`,
      );
      assert.ok(
        prompt.qa.minDurationMs > 0 &&
          prompt.qa.maxDurationMs > prompt.qa.minDurationMs,
        `prompt ${prompt.id} should have valid duration gates`,
      );
      assert.ok(
        ["low", "medium", "high"].includes(prompt.phonetics.difficulty),
        `prompt ${prompt.id} should classify phonetic difficulty`,
      );

      for (const [name, value] of Object.entries(prompt.intention.emotion)) {
        if (name === "labels") {
          continue;
        }

        assert.ok(
          value >= -1 && value <= 1,
          `prompt ${prompt.id} emotion ${name} should be between -1 and 1`,
        );
      }
    }
  }
});

test("canonical corpus keeps a balanced bilingual training base", () => {
  const promptCountsByLanguage = new Map<string, number>();

  for (const scenario of canonicalCorpus.scenarios) {
    promptCountsByLanguage.set(
      scenario.language,
      (promptCountsByLanguage.get(scenario.language) ?? 0) +
        scenario.prompts.length,
    );
  }

  assert.ok(
    (promptCountsByLanguage.get("fr") ?? 0) >= 50,
    "French corpus should include at least 50 prompts",
  );
  assert.ok(
    (promptCountsByLanguage.get("en") ?? 0) >= 50,
    "English corpus should include at least 50 prompts",
  );
});
