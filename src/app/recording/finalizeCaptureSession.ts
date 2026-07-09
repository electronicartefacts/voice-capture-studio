import type { CorpusManifest, PromptDefinition } from "../../domains/corpus";
import { summarizeCoverage } from "../../domains/coverage";
import type { SpeakerProfile } from "../../domains/speakers";
import type {
  AudioCaptureProvenance,
  CaptureSession,
  RecordedTake,
} from "../../domains/sessions";
import {
  completePlannedSession,
  type VoiceWorkspace,
  type WorkspaceRepository,
} from "../../domains/workspace";
import type { Result } from "../../shared";
import type { PcmRecordingMetrics } from "../audio/pcmRecorder";
import { sha256Blob } from "../storage/sha256";
import {
  createRecordingFileName,
  createTakeId,
} from "../audio/recordingFileName";
import { createCaptureSessionExportBundle } from "../export/captureSessionExport";
import type { RecordingSaveTarget } from "../storage/workspaceFolder";
import { createRecordedTake } from "./recordedTake";

export type FinalizedRecording = {
  readonly blob: Blob;
  readonly extension: "wav";
  readonly mimeType: "audio/wav";
  readonly metrics: PcmRecordingMetrics;
  readonly capture: AudioCaptureProvenance;
};

export type RecordingSaveReceipt = {
  readonly fileName: string;
  readonly target: RecordingSaveTarget;
};

export type AudioSaveResult = Result<
  RecordingSaveReceipt,
  "folder-unavailable" | "folder-save-failed"
>;

export type MetadataSaveResult = Result<
  { readonly target: "folder" },
  "folder-unavailable" | "folder-save-failed"
>;

export type SessionMetadata = CaptureSession & {
  readonly captureProfile: VoiceWorkspace["settings"]["captureProfile"];
  readonly exportFormat: "voice.capture_session";
  readonly exportFormatVersion: "0.3.0";
};

export type CaptureFinalizationResult = {
  readonly audioBlob: Blob;
  readonly audioDownloadAvailable: boolean;
  readonly audioSaveResult: AudioSaveResult;
  readonly completedSession: CaptureSession;
  readonly exportBundle: ReturnType<
    typeof createCaptureSessionExportBundle
  > | null;
  readonly fileName: string;
  readonly metadataDownloadPayload: unknown;
  readonly metadataSaveMessage: string | null;
  readonly nextWorkspace: VoiceWorkspace;
  readonly sessionMetadata: SessionMetadata;
  readonly take: RecordedTake | null;
  readonly workspaceSaveResult: Awaited<
    ReturnType<WorkspaceRepository["save"]>
  >;
};

export async function finalizeCaptureSession(input: {
  readonly activePrompt: PromptDefinition | undefined;
  readonly completedAt?: Date;
  readonly corpus: CorpusManifest;
  readonly folderName: string | null;
  readonly recording: FinalizedRecording;
  readonly recordedAt?: Date;
  readonly recognizedTranscript?: string;
  readonly saveRecording: (
    fileName: string,
    audioBlob: Blob,
  ) => Promise<AudioSaveResult>;
  readonly saveTakeMetadata: (input: {
    readonly audioBlob?: Blob;
    readonly corpusJson: unknown;
    readonly manifestJson: NonNullable<
      CaptureFinalizationResult["exportBundle"]
    >["manifestJson"];
    readonly reportsJson: NonNullable<
      CaptureFinalizationResult["exportBundle"]
    >["reportsJson"];
    readonly sessionId: string;
    readonly speakerJson: unknown;
    readonly takeJson: unknown;
    readonly takeId: string;
    readonly transcriptText: string;
    readonly timingJson: unknown;
    readonly phonemesJson: unknown;
    readonly intentJson: unknown;
    readonly qualityJson: unknown;
    readonly sessionJson: unknown;
  }) => Promise<MetadataSaveResult>;
  readonly saveWorkspace: WorkspaceRepository["save"];
  readonly selectedSpeaker: SpeakerProfile | undefined;
  readonly session: CaptureSession;
  readonly workspace: VoiceWorkspace;
}): Promise<CaptureFinalizationResult> {
  const audioBlob = input.recording.blob;
  const recordedAt = input.recordedAt ?? new Date();
  const completedAt = input.completedAt ?? new Date();
  const takeId = createTakeId(recordedAt);
  const fileName = createRecordingFileName({
    extension: input.recording.extension,
    sessionId: input.session.id,
    takeId,
  });
  const audioDownloadAvailable = audioBlob.size > 0;
  const audioSha256 = audioDownloadAvailable
    ? await sha256Blob(audioBlob)
    : null;
  const audioSaveResult = audioDownloadAvailable
    ? await input.saveRecording(fileName, audioBlob)
    : ({
        ok: false,
        error: "folder-save-failed",
        message: "Aucun son n'a été capturé.",
      } satisfies AudioSaveResult);
  const recordedTake =
    input.activePrompt === undefined || !audioDownloadAvailable
      ? null
      : createRecordedTake({
          durationMs:
            input.recording.metrics.durationMs ||
            estimateDurationMs(input.activePrompt.text),
          fileName,
          media: {
            schemaVersion: "voice.media.v1",
            byteLength: audioBlob.size,
            container: "WAVE",
            codec: "PCM",
            mimeType: input.recording.mimeType,
            sha256: audioSha256 ?? "",
            capture: input.recording.capture,
          },
          metrics: input.recording.metrics,
          profile: input.workspace.settings.captureProfile,
          prompt: input.activePrompt,
          recordedAt,
          recognizedTranscript: input.recognizedTranscript,
          session: input.session,
          takeId,
        });
  const take =
    recordedTake !== null && !audioSaveResult.ok
      ? rejectTakeWithoutPersistedAudio(recordedTake, audioSaveResult.message)
      : recordedTake;
  const completedSession: CaptureSession = {
    ...input.session,
    completedAt: completedAt.toISOString() as CaptureSession["completedAt"],
    takes: take === null ? input.session.takes : [...input.session.takes, take],
  };
  const sessionMetadata: SessionMetadata = {
    ...completedSession,
    captureProfile: input.workspace.settings.captureProfile,
    exportFormat: "voice.capture_session",
    exportFormatVersion: "0.3.0",
  };
  const nextWorkspace = completePlannedSession(
    input.workspace,
    input.corpus,
    completedSession,
    completedAt,
  );
  const workspaceSaveResult = await input.saveWorkspace(nextWorkspace);
  let exportBundle: CaptureFinalizationResult["exportBundle"] = null;
  let metadataSaveMessage: string | null = null;

  if (take !== null && audioSaveResult.ok) {
    exportBundle = createCaptureSessionExportBundle({
      corpus: input.corpus,
      coverage: summarizeCoverage({
        workspace: nextWorkspace,
        corpus: input.corpus,
        speakerId: input.session.speakerId,
        language: input.session.language,
      }),
      session: completedSession,
      speaker: input.selectedSpeaker,
      workspace: nextWorkspace,
    });

    const metadataSaveResult = await input.saveTakeMetadata({
      audioBlob,
      corpusJson: exportBundle.corpusJson,
      manifestJson: exportBundle.manifestJson,
      reportsJson: exportBundle.reportsJson,
      sessionId: completedSession.id,
      speakerJson: exportBundle.speakerJson,
      takeJson: take,
      takeId: take.id,
      transcriptText: take.transcript.spokenText,
      timingJson: take.timing,
      phonemesJson: {
        schemaVersion: "voice.take_phonemes.v1",
        takeId: take.id,
        promptId: take.promptId,
        alignment: take.timing.alignment ?? null,
        wordPhonemeMap: take.timing.words.map((word) => ({
          word: word.word,
          normalized: word.normalized ?? word.word.toLowerCase(),
          startMs: word.startMs,
          endMs: word.endMs,
          confidence: word.confidence ?? null,
          phonemes: word.phonemes ?? [],
        })),
        inventory: take.timing.alignment?.inventory ?? [],
      },
      intentJson: take.intent,
      qualityJson: take.quality,
      sessionJson: sessionMetadata,
    });

    if (
      !metadataSaveResult.ok &&
      input.folderName !== null &&
      input.folderName !== "Stockage du navigateur"
    ) {
      metadataSaveMessage = metadataSaveResult.message;
    }
  }

  return {
    audioBlob,
    audioDownloadAvailable,
    audioSaveResult,
    completedSession,
    exportBundle,
    fileName,
    metadataDownloadPayload:
      exportBundle === null
        ? sessionMetadata
        : {
            session: sessionMetadata,
            speaker: exportBundle.speakerJson,
            corpus: exportBundle.corpusJson,
            manifest: exportBundle.manifestJson,
            reports: exportBundle.reportsJson,
          },
    metadataSaveMessage,
    nextWorkspace,
    sessionMetadata,
    take,
    workspaceSaveResult,
  };
}

function estimateDurationMs(text: string): number {
  return Math.max(1800, text.split(/\s+/).filter(Boolean).length * 520);
}

function rejectTakeWithoutPersistedAudio(
  take: RecordedTake,
  message: string,
): RecordedTake {
  return {
    ...take,
    quality: {
      ...take.quality,
      performance: {
        ...take.quality.performance,
        keeper: false,
      },
      gates: [
        ...take.quality.gates,
        {
          id: "audio_persistence",
          label: "Sauvegarde audio",
          status: "fail",
          message,
        },
      ],
      verdict: "reject",
    },
    review: {
      rating: "reject",
      bestTake: false,
      directorNotes:
        "Audio non sauvegardé durablement. Télécharge le WAV puis refais une prise.",
      rejectionReason: message,
    },
  };
}
