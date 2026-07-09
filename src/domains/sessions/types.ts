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
  /** Immutable technical identity of the exact audio object reviewed here. */
  readonly media: TakeMedia;
  readonly transcript: TakeTranscript;
  readonly timing: TakeTiming;
  readonly intent: TakeIntentMetadata;
  readonly quality: TakeQualityReport;
  readonly review: TakeReview;
};

export type TakeMedia = {
  readonly schemaVersion: "voice.media.v1";
  readonly byteLength: number;
  readonly container: "WAVE";
  readonly codec: "PCM";
  readonly mimeType: "audio/wav";
  /** Lowercase hexadecimal SHA-256 over the complete WAV container. */
  readonly sha256: string;
  readonly capture: AudioCaptureProvenance;
};

export type AudioCaptureProvenance = {
  readonly schemaVersion: "voice.capture_provenance.v1";
  readonly captureApi: "MediaStream";
  readonly capturedChannelCount: number | null;
  readonly capturedSampleRateHz: number | null;
  readonly deviceGroupId: string | null;
  readonly deviceId: string | null;
  readonly deviceLabel: string | null;
  readonly requestedFormat: {
    readonly bitDepth: 24;
    readonly channels: 1;
    readonly sampleRateHz: 48000;
  };
  readonly processing: {
    readonly autoGainControl: boolean | null;
    readonly echoCancellation: boolean | null;
    readonly noiseSuppression: boolean | null;
  };
  readonly sourceSampleRateHz: number;
  readonly targetSampleRateHz: number;
  readonly resampledToTarget: boolean;
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
  readonly schemaVersion: "voice.audio_metrics.v1";
  readonly sampleRateHz: number;
  readonly bitDepth: number;
  readonly channels: number;
  readonly sampleCount: number;
  readonly peakDbfs: number;
  readonly estimatedTruePeakDbfs: number;
  readonly rmsDbfs: number;
  readonly integratedLufs: number;
  readonly noiseFloorDbfs: number;
  readonly snrDb: number;
  readonly crestFactorDb: number;
  readonly dcOffset: number;
  readonly clippingDetected: boolean;
  readonly clippingSampleCount: number;
  readonly clippingRate: number;
  readonly activeSpeechRatio: number;
  readonly silenceRatio: number;
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
    | "prosody_balance"
    | "headroom"
    | "dc_offset"
    | "speech_activity"
    | "plosives"
    | "mouth_noise"
    | "reverb";
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
