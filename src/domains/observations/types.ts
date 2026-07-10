import type { LanguageCode } from "@shared/index";
import type { PromptDefinition } from "@domains/corpus";
import type {
  PromptPhonemeAlignment,
  TranscriptMatchEstimate,
} from "@domains/phonetics";

export type EvidenceStatus =
  | "measured"
  | "observed"
  | "estimated"
  | "declared"
  | "unavailable"
  | "human_review";

export type EvidenceSource =
  | "audio_signal"
  | "audio_analysis"
  | "energy_vad"
  | "browser_asr"
  | "corpus"
  | "g2p"
  | "evidence_fusion"
  | "human_review";

export type EvidenceConfidence = {
  readonly value: number | null;
  readonly status: EvidenceStatus;
  readonly source: EvidenceSource;
  readonly reason: string;
};

export type EvidenceProvenance = {
  readonly source: EvidenceSource;
  readonly method: string;
  readonly methodVersion: string;
  readonly generatedAt: string;
};

export type BrowserAsrHypothesis = {
  readonly resultIndex: number;
  readonly alternativeIndex: number;
  readonly text: string;
  readonly confidence: number | null;
  readonly final: boolean;
  readonly capturedAtMs: number;
};

export type BrowserAsrObservation = {
  readonly schemaVersion: "voice.browser_asr_observation.v1";
  readonly availability: "available" | "unavailable" | "failed";
  readonly engine: "SpeechRecognition" | "webkitSpeechRecognition" | null;
  readonly locale: string;
  readonly transcript: string | null;
  readonly hypotheses: readonly BrowserAsrHypothesis[];
  readonly runtime: {
    readonly userAgent: string | null;
    readonly browserName: string | null;
    readonly browserVersion: string | null;
  };
  readonly confidence: EvidenceConfidence;
  readonly provenance: EvidenceProvenance;
};

export type CorpusObservation = {
  readonly schemaVersion: "voice.corpus_observation.v1";
  readonly rawText: string;
  readonly spokenText: string;
  readonly normalizedText: string;
  readonly tokens: readonly string[];
  readonly sentences: readonly string[];
  readonly punctuation: readonly string[];
  readonly variants: readonly string[];
  readonly language: LanguageCode;
  readonly locale: string;
  readonly intent: PromptDefinition["intention"];
  readonly emotionTarget: PromptDefinition["intention"]["emotion"];
  readonly style: string;
  readonly expectedEnergy: string;
  readonly confidence: EvidenceConfidence;
  readonly provenance: EvidenceProvenance;
};

export type SignalObservation = {
  readonly schemaVersion: "voice.signal_observation.v1";
  readonly metrics: SignalMetrics;
  readonly vad: {
    readonly method: "energy_activity_estimate";
    readonly speechDetected: boolean;
    readonly activeSpeechRatio: number;
    readonly silenceRatio: number;
    readonly confidence: EvidenceConfidence;
  };
  readonly temporal: {
    readonly durationMs: number;
    readonly estimatedSpeechMs: number;
    readonly estimatedSilenceMs: number;
    readonly speakingRateWpm: number | null;
    readonly pauseCount: number;
    readonly leadingSilenceMs: number;
    readonly trailingSilenceMs: number;
    readonly pauses: readonly {
      readonly startMs: number;
      readonly endMs: number;
      readonly status: "estimated";
    }[];
  };
  readonly energyEnvelope: readonly {
    readonly startMs: number;
    readonly endMs: number;
    readonly rmsDbfs: number;
  }[];
  readonly speechSegments: readonly {
    readonly startMs: number;
    readonly endMs: number;
    readonly source: "energy_threshold";
  }[];
  readonly acoustic: {
    readonly rmsDbfs: number;
    readonly integratedLufs: number;
    readonly noiseFloorDbfs: number;
    readonly snrDb: number;
    readonly peakDbfs: number;
    readonly estimatedTruePeakDbfs: number;
    readonly energyVariationDb: number;
    readonly dcOffset: number;
    readonly clippingRate: number;
    readonly reverbScore: number;
    readonly plosiveScore: number;
    readonly mouthNoiseScore: number;
  };
  readonly prosody: {
    readonly meanPitchHz: number | null;
    readonly pitchRangeSemitones: number | null;
    readonly pitchVariationSemitones: number | null;
    readonly voicedFrameRatio: number;
  };
  readonly confidence: EvidenceConfidence;
  readonly provenance: EvidenceProvenance;
};

export type SignalMetrics = {
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
  readonly voicedFrameRatio: number;
  readonly meanPitchHz: number | null;
  readonly pitchRangeSemitones: number | null;
  readonly pitchVariationSemitones: number | null;
  readonly energyVariationDb: number;
  readonly reverbScore: number;
  readonly plosiveScore: number;
  readonly mouthNoiseScore: number;
  readonly energyEnvelope?: readonly {
    readonly startMs: number;
    readonly endMs: number;
    readonly rmsDbfs: number;
  }[];
  readonly speechSegments?: readonly {
    readonly startMs: number;
    readonly endMs: number;
    readonly source: "energy_threshold";
  }[];
};

export type EstimatedAlignmentObservation = {
  readonly schemaVersion: "voice.estimated_alignment_observation.v1";
  readonly status: "estimated";
  readonly kind: "preparatory_alignment";
  readonly inputs: readonly ("corpus" | "g2p" | "energy_vad" | "browser_asr")[];
  readonly wordAlignment: PromptPhonemeAlignment["words"];
  readonly phonemeAlignment: PromptPhonemeAlignment["phonemes"];
  readonly g2p: PromptPhonemeAlignment;
  readonly warnings: readonly string[];
  readonly forcedAlignmentRequired: true;
  readonly replaceableBy: readonly (
    "WhisperX" | "Montreal Forced Aligner" | "Gentle" | "MFA"
  )[];
  readonly confidence: EvidenceConfidence;
  readonly provenance: EvidenceProvenance;
};

export type FusedDecision = {
  readonly subjectType: "take" | "word" | "phoneme" | "annotation";
  readonly subjectId: string;
  readonly decision: string;
  readonly status: EvidenceStatus;
  readonly confidence: number | null;
  readonly source: EvidenceSource;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
};

export type TakeObservationPackage = {
  readonly schemaVersion: "voice.take_observation.v1";
  readonly generatedAt: string;
  readonly corpus: CorpusObservation;
  readonly signal: SignalObservation;
  readonly speechRecognition: BrowserAsrObservation;
  readonly alignment: EstimatedAlignmentObservation;
  readonly transcriptMatch: TranscriptMatchEstimate;
  readonly decisions: readonly FusedDecision[];
  readonly limitations: readonly string[];
};
