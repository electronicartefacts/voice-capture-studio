import type { CorpusManifest } from "@domains/corpus";
import type { SpeakerProfile } from "@domains/speakers";
import type { LanguageCode } from "@shared/index";
import type { VoiceWorkspace } from "@domains/workspace";
import type { ProcessedVoiceArtifact } from "../analysis/processedVoiceArtifact";
import {
  createVoiceCapturePackagePlan,
  type VoiceArtifactProcessingContext,
  type VoiceCapturePackagePlan,
  type VoiceCapturePackageScope,
} from "./voiceCapturePackage";
import {
  listBrowserRecordings,
  type StoredRecording,
} from "../storage/browserRecordingStorage";

export type PrepareVoiceCapturePackageInput = {
  readonly corpus: CorpusManifest;
  readonly getAudioBlob: (fileName: string) => Promise<Blob | undefined>;
  readonly language: LanguageCode;
  readonly signal?: AbortSignal;
  readonly speakerId: string;
  readonly speakerProfiles: readonly SpeakerProfile[];
  readonly workspace: VoiceWorkspace;
  readonly listRecordings?: () => Promise<readonly StoredRecording[]>;
  readonly processAudioBlob?: (
    audioBlob: Blob,
    context: VoiceArtifactProcessingContext,
  ) => Promise<ProcessedVoiceArtifact>;
};

export async function prepareVoiceCapturePackage(
  input: PrepareVoiceCapturePackageInput,
): Promise<VoiceCapturePackagePlan> {
  throwIfAborted(input.signal);
  const recordings = await (input.listRecordings ?? listBrowserRecordings)();
  throwIfAborted(input.signal);
  const standaloneCaptures = recordings
    .filter((recording) => recording.metadata !== undefined)
    .map((recording) => ({
      blob: recording.blob,
      fileName: recording.fileName,
      metadata: recording.metadata ?? {},
    }));
  const scope = createCurrentVoicePackageScope({
    corpus: input.corpus,
    hasStandaloneCaptures: standaloneCaptures.length > 0,
    language: input.language,
    speakerId: input.speakerId,
    workspace: input.workspace,
  });

  return createVoiceCapturePackagePlan({
    corpus: input.corpus,
    getAudioBlob: input.getAudioBlob,
    processAudioBlob:
      input.processAudioBlob ??
      ((audioBlob, processingContext) =>
        import("../analysis/processedVoiceArtifact").then((module) =>
          module.createProcessedVoiceArtifact({
            audioBlob,
            roomToneBlob: processingContext.roomToneBlob,
            roomToneSourceRef: processingContext.roomToneSourceRef,
          }),
        )),
    licenses: input.workspace.rights.licenses,
    rights: input.workspace.rights.consents,
    scope,
    signal: input.signal,
    speakerProfiles: input.speakerProfiles,
    standaloneCaptures,
    workspace: input.workspace,
  });
}

export function createCurrentVoicePackageScope(input: {
  readonly corpus: CorpusManifest;
  readonly hasStandaloneCaptures?: boolean;
  readonly language: LanguageCode;
  readonly speakerId: string;
  readonly workspace: VoiceWorkspace;
}): VoiceCapturePackageScope {
  const sessionIds = input.workspace.capturedSessions
    .filter(
      (candidate) =>
        candidate.speakerId === input.speakerId &&
        candidate.language === input.language &&
        candidate.corpusId === input.corpus.id,
    )
    .map((candidate) => candidate.id);

  if (sessionIds.length === 0 && input.hasStandaloneCaptures !== true) {
    throw new Error(
      "Aucune session enregistrée dans le scope actuel. Sélectionne une voix, une langue et un corpus avec au moins une prise gardée.",
    );
  }

  return {
    datasetId: `dataset.${input.workspace.workspaceId}.${input.corpus.id}.${input.speakerId}.${input.language}`,
    projectId: "project.voice-capture-studio",
    speakerIds: [input.speakerId],
    languages: [input.language],
    locales: [input.language === "fr" ? "fr-FR" : "en-US"],
    corpusRefs: [{ id: input.corpus.id, version: input.corpus.version }],
    sessionIds,
    takeStatuses: ["keeper"],
    includeRoomTones: true,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Export annulé.", "AbortError");
}
