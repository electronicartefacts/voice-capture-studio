import type { Brand, LanguageCode } from "@shared/index";
import type { CorpusId, PromptId, ScenarioId } from "@domains/corpus";
import type { SpeakerId } from "@domains/speakers";

export type CoverageMetricId = Brand<string, "CoverageMetricId">;

export type CoverageSnapshot = {
  readonly corpusId: CorpusId;
  readonly speakerId: SpeakerId;
  readonly language: LanguageCode;
  readonly scenarioCoverage: readonly ScenarioCoverage[];
};

export type ScenarioCoverage = {
  readonly scenarioId: ScenarioId;
  readonly completedPromptIds: readonly PromptId[];
  readonly remainingPromptIds: readonly PromptId[];
};
