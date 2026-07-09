export type {
  CorpusId,
  CorpusManifest,
  IntentionId,
  PromptDefinition,
  PromptDelivery,
  PromptDirection,
  PromptEmotion,
  PromptPhonetics,
  PromptId,
  PromptIntention,
  PromptProsody,
  PromptQualityGate,
  QualityRejectionReason,
  ScenarioDefinition,
  ScenarioId,
} from "./types";
export { canonicalCorpus } from "./data/canonicalCorpus";
export {
  createLocalTextCorpus,
  createPromptSegments,
  type LocalCorpusMode,
  type LocalCorpusSnapshot,
  type LocalTextCorpus,
  type LocalTextCorpusInput,
  type LocalTextCorpusSummary,
} from "./localCorpus";
export { corpusCompatibilityPolicy } from "./versioning";
