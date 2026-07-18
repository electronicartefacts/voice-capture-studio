export type SpeechSegment = {
  readonly startMs: number;
  readonly endMs: number;
};

export type SpeechSegmentSummary = {
  readonly leadingSilenceMs: number;
  readonly trailingSilenceMs: number;
  readonly speechDurationMs: number;
  readonly totalDurationMs: number;
};

export type WhisperWordTiming = {
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly source: "whisper_attention_timestamp";
};

export type LocalProcessingProfile = "balanced" | "compatible";
export type LocalTranscriptionModel = "tiny" | "base";
export type LocalExecutionProvider = "wasm" | "webgpu";
export type LocalExecutionPreference = "auto" | "wasm";
export type LocalDecodingStrategy = "greedy" | "beam";
export type LocalAcousticScene =
  | "clean_voice"
  | "constrained_voice"
  | "sung_voice"
  | "music_mix"
  | "uncertain";
export type LocalAnalysisDepth = "fast" | "verified" | "deep";
export type LocalRuntimeClass =
  "unmeasured" | "fast" | "moderate" | "constrained";

export type LocalAnalysisProgress =
  | { readonly stage: "loading-model"; readonly progressPercent: number }
  | { readonly stage: "transcribing" }
  | { readonly stage: "detecting-speech" }
  | { readonly stage: "enhancing-vocals" }
  | {
      readonly stage: "separating-vocals";
      readonly progressPercent: number;
    }
  | { readonly stage: "validating-result" };

export type LocalTakeAnalysis = {
  readonly transcript: string;
  readonly matchedWordCount: number;
  readonly expectedWordCount: number;
  readonly speechSegments: readonly SpeechSegment[];
  readonly segmentSummary: SpeechSegmentSummary;
  readonly whisperWords: readonly WhisperWordTiming[];
  readonly alignmentComparison: LocalAlignmentComparison;
  readonly executionProvider: LocalExecutionProvider;
  readonly strategy?: {
    readonly schemaVersion: "voice.adaptive_analysis.v1";
    readonly scene: LocalAcousticScene;
    readonly depth: LocalAnalysisDepth;
    readonly selectedModel: LocalTranscriptionModel;
    readonly selectionReason:
      "fast_path_sufficient" | "prompt_match" | "acoustic_support";
    readonly hypotheses: readonly {
      readonly model: LocalTranscriptionModel;
      readonly provider: LocalExecutionProvider;
      readonly decoding: LocalDecodingStrategy;
      readonly transcript: string;
      readonly wordCount: number;
      readonly matchedWordCount: number;
      readonly score: number;
    }[];
    readonly runtime?: {
      readonly runtimeClass: LocalRuntimeClass;
      readonly observedTranscriptionRealtimeFactor: number | null;
      readonly storedTranscriptionRealtimeFactor: number | null;
      readonly hypothesisBudget: 1 | 2 | 3;
      readonly reasons: readonly string[];
    };
  };
};

export type AnalysisWorkerRequest = {
  readonly id: number;
  readonly audio: Float32Array;
  readonly sampleRate: number;
  readonly language: string;
  readonly processingProfile: LocalProcessingProfile;
  readonly transcriptionModel: LocalTranscriptionModel;
  readonly decodingStrategy: LocalDecodingStrategy;
  readonly executionPreference: LocalExecutionPreference;
  readonly assetsBaseUrl: string;
};

export type AnalysisWorkerResponse =
  | {
      readonly id: number;
      readonly kind: "progress";
      readonly progress: LocalAnalysisProgress;
    }
  | {
      readonly id: number;
      readonly kind: "result";
      readonly transcript: string;
      readonly speechSegments: readonly SpeechSegment[];
      readonly whisperWords: readonly WhisperWordTiming[];
      readonly executionProvider: LocalExecutionProvider;
    }
  | {
      readonly id: number;
      readonly kind: "error";
      readonly message: string;
    };
import type { LocalAlignmentComparison } from "./localAlignmentComparison";
