import type { Brand, IsoDateTime, Semver } from "@shared/index";
import type { CorpusId } from "@domains/corpus";
import type { WorkspaceId } from "@domains/workspace";

export type ExportId = Brand<string, "ExportId">;

export type VoiceArchiveExportManifest = {
  readonly exportId: ExportId;
  readonly format: "voice.capture_session";
  readonly formatVersion: Semver;
  readonly workspaceId: WorkspaceId;
  readonly corpusId: CorpusId;
  readonly createdAt: IsoDateTime;
  readonly consent: VoiceCaptureConsent;
  readonly provenance: VoiceCaptureProvenance;
  readonly forgePipeline: readonly ForgePipelineStage[];
  readonly reports: readonly VoiceCaptureReport[];
  readonly artifacts: readonly ExportArtifact[];
};

export type VoiceCaptureConsent = {
  readonly speakerConsent: true;
  readonly consentCapturedAt: IsoDateTime;
  readonly permittedUses: readonly (
    "training" | "fine_tuning" | "evaluation" | "private_archive"
  )[];
};

export type VoiceCaptureProvenance = {
  readonly captureTool: "Voice Capture Studio";
  readonly captureToolVersion: Semver;
  readonly audioPolicy: {
    readonly requiredFormat: "wav_pcm_mono_48khz";
    readonly requiredIntegrityAlgorithm: "sha256";
    readonly destructiveNoiseReductionAllowed: false;
    readonly compressedFormatsAllowed: false;
  };
};

export type ForgePipelineStage =
  | "voice_capture_archive"
  | "validate_audio_quality"
  | "normalize_metadata"
  | "forced_alignment"
  | "phonetic_coverage_report"
  | "prosody_analysis"
  | "intent_balance_report"
  | "dataset_score"
  | "voice_archive";

export type VoiceCaptureReport =
  | "report.audio_quality"
  | "report.transcript_alignment"
  | "report.phonetic_coverage"
  | "report.intent_balance"
  | "report.prosody_distribution"
  | "report.dataset_readiness";

export type ExportArtifact = {
  readonly path: string;
  readonly mediaType: string;
  readonly sha256: string;
};
