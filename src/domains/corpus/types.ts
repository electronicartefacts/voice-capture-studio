import type { Brand, LanguageCode, Semver } from "@shared/index";

export type CorpusId = Brand<string, "CorpusId">;
export type ScenarioId = Brand<string, "ScenarioId">;
export type PromptId = Brand<string, "PromptId">;
export type IntentionId = Brand<string, "IntentionId">;

export type CorpusManifest = {
  readonly id: CorpusId;
  readonly version: Semver;
  readonly languages: readonly LanguageCode[];
  readonly scenarios: readonly ScenarioDefinition[];
};

export type ScenarioDefinition = {
  readonly id: ScenarioId;
  readonly language: LanguageCode;
  readonly title: string;
  readonly description: string;
  readonly prompts: readonly PromptDefinition[];
};

export type PromptDefinition = {
  readonly id: PromptId;
  readonly text: string;
  readonly spokenText?: string;
  readonly sourceTiming?: PromptSourceTiming;
  readonly intention: PromptIntention;
  readonly delivery: PromptDelivery;
  readonly direction: PromptDirection;
  readonly prosody: PromptProsody;
  readonly phonetics: PromptPhonetics;
  readonly qa: PromptQualityGate;
  readonly tags: readonly string[];
};

export type PromptSourceTiming = {
  readonly startMs: number;
  readonly endMs: number;
};

export type PromptIntention = {
  readonly id: IntentionId;
  readonly primary: string;
  readonly secondary: readonly string[];
  readonly useCase: string;
  readonly label: string;
  readonly emotion: PromptEmotion;
};

export type PromptDelivery = {
  readonly tone: string;
  readonly pace: "slow" | "medium_slow" | "natural" | "medium_fast" | "fast";
  readonly energy: "low" | "medium_low" | "medium" | "medium_high" | "high";
  readonly articulation: "relaxed" | "clear_natural" | "precise" | "crisp";
  readonly projection:
    "intimate" | "conversational" | "presented" | "projected";
  readonly smile: "none" | "slight" | "audible";
  readonly breathiness: "low" | "medium" | "high";
  readonly pauseStyle: "minimal" | "thoughtful" | "structured" | "urgent";
};

export type PromptEmotion = {
  readonly valence: number;
  readonly arousal: number;
  readonly dominance: number;
  readonly labels: readonly string[];
};

export type PromptDirection = {
  readonly context: string;
  readonly directorNote: string;
  readonly pauseInstruction: string;
  readonly emphasis: readonly string[];
  readonly avoid: readonly string[];
  readonly example?: string;
};

export type PromptProsody = {
  readonly targetPace: string;
  readonly targetPitch:
    "lower_stable" | "natural" | "slightly_lifted" | "varied";
  readonly pitchVariation: "low" | "medium" | "high";
  readonly phraseAttack: "soft" | "clean" | "assertive";
  readonly sentenceEnding: "falling" | "rising" | "mixed";
  readonly intimacy: "close" | "neutral" | "open";
};

export type PromptPhonetics = {
  readonly focus: readonly string[];
  readonly coverage: readonly string[];
  readonly difficulty: "low" | "medium" | "high";
};

export type PromptQualityGate = {
  readonly minDurationMs: number;
  readonly maxDurationMs: number;
  readonly rejectIf: readonly QualityRejectionReason[];
};

export type QualityRejectionReason =
  | "clipping"
  | "unstable_noise"
  | "reverb"
  | "electrical_hum"
  | "variable_mic_distance"
  | "truncated_phrase"
  | "transcript_mismatch"
  | "forced_voice"
  | "overacted"
  | "intent_mismatch"
  | "emotion_imbalance";
