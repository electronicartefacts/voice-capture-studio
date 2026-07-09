import type { Brand, IsoDateTime, LanguageCode } from "@shared/index";
import type {
  PhonemeInterval,
  PromptPhonemeAlignment,
  TranscriptMatchEstimate,
  TranscriptToken,
  WordPhonemeAlignment,
} from "@domains/phonetics";
import type {
  CorpusId,
  PromptDefinition,
  PromptId,
  ScenarioId,
} from "@domains/corpus";
import type { SpeakerId } from "@domains/speakers";

export type SessionId = Brand<string, "SessionId">;
export type TakeId = Brand<string, "TakeId">;

export type CaptureSession = {
  readonly id: SessionId;
  readonly speakerId: SpeakerId;
  readonly language: LanguageCode;
  readonly corpusId: CorpusId;
  readonly scenarioIds: readonly ScenarioId[];
  readonly plannedPromptIds: readonly PromptId[];
  readonly startedAt: IsoDateTime;
  readonly completedAt?: IsoDateTime;
  readonly takes: readonly RecordedTake[];
};

export type RecordedTake = {
  readonly id: TakeId;
  readonly promptId: PromptId;
  readonly fileName: string;
  readonly durationMs: number;
  readonly recordedAt: IsoDateTime;
  readonly transcript: TakeTranscript;
  readonly timing: TakeTiming;
  readonly intent: TakeIntentMetadata;
  readonly quality: TakeQualityReport;
  readonly review: TakeReview;
};

export type TakeQuality = "unreviewed" | "keeper" | "maybe" | "reject";

export type TakeTranscript = {
  readonly schemaVersion: "voice.transcript.v2";
  readonly originalText: string;
  readonly spokenText: string;
  readonly observedText?: string | null;
  readonly matchEstimate?: TranscriptMatchEstimate;
  readonly strictMatchRequired: boolean;
  readonly annotations: readonly TranscriptAnnotation[];
  readonly tokens?: readonly TranscriptToken[];
};

export type TranscriptAnnotation = {
  readonly type: "breath" | "hesitation" | "laugh" | "sigh" | "correction";
  readonly note: string;
};

export type TakeTiming = {
  readonly schemaVersion: "voice.timing.v2";
  readonly durationMs: number;
  readonly words: readonly WordTiming[];
  readonly phonemes?: readonly PhonemeInterval[];
  readonly phrases: readonly PhraseTiming[];
  readonly alignment?: PromptPhonemeAlignment;
};

export type WordTiming = {
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly tokenIndex?: number;
  readonly normalized?: string;
  readonly confidence?: number;
  readonly syllableCount?: number;
  readonly phonemes?: WordPhonemeAlignment["phonemes"];
};

export type PhraseTiming = {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
};

export type TakeIntentMetadata = {
  readonly schemaVersion: "voice.intent.v2";
  readonly language: LanguageCode;
  readonly intent: PromptDefinition["intention"];
  readonly delivery: PromptDefinition["delivery"];
  readonly direction: {
    readonly directorNote: string;
    readonly avoid: readonly string[];
  };
  readonly prosody: PromptDefinition["prosody"];
};

export type TakeQualityReport = {
  readonly schemaVersion: "voice.quality.v2";
  readonly technical: TechnicalQualityMetrics;
  readonly performance: PerformanceQualityMetrics;
  readonly gates: readonly TakeQualityGateResult[];
  readonly verdict: "pass" | "review" | "reject";
};

export type TechnicalQualityMetrics = {
  readonly sampleRateHz: number;
  readonly bitDepth: number;
  readonly channels: number;
  readonly peakDbfs: number;
  readonly integratedLufs: number;
  readonly noiseFloorDbfs: number;
  readonly snrDb: number;
  readonly clippingDetected: boolean;
  readonly reverbScore: number;
  readonly plosiveScore: number;
  readonly mouthNoiseScore: number;
};

export type PerformanceQualityMetrics = {
  readonly transcriptMatch: number;
  readonly alignmentConfidence?: number;
  readonly phonemeInventoryCount?: number;
  readonly wordPhonemeLinkRate?: number;
  readonly intentMatch: number;
  readonly prosodyVariation: number;
  readonly naturalnessHumanReview: number | null;
  readonly keeper: boolean;
};

export type TakeQualityGateResult = {
  readonly id:
    | "clipping"
    | "noise_floor"
    | "signal_level"
    | "snr"
    | "duration"
    | "audio_persistence"
    | "transcript_match"
    | "phoneme_alignment"
    | "intent_match"
    | "prosody_balance";
  readonly label: string;
  readonly status: "pass" | "review" | "fail";
  readonly message: string;
};

export type TakeReview = {
  readonly rating: TakeQuality;
  readonly bestTake: boolean;
  readonly directorNotes: string;
  readonly rejectionReason?: string;
};
