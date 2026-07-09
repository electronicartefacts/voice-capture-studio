import type { CorpusManifest } from "@domains/corpus";
import type { SpeakerProfile } from "@domains/speakers";
import type { IsoDateTime } from "@shared/index";
import { DEFAULT_WORKSPACE_SETTINGS } from "./defaults";
import type {
  VoiceWorkspace,
  WorkspaceId,
  WorkspaceSchemaVersion,
} from "./types";

export const CURRENT_WORKSPACE_SCHEMA_VERSION = 1 as WorkspaceSchemaVersion;

export function createEmptyWorkspace(input: {
  readonly corpus: CorpusManifest;
  readonly speakers: readonly SpeakerProfile[];
  readonly now: Date;
}): VoiceWorkspace {
  const now = input.now.toISOString() as IsoDateTime;

  return {
    schemaVersion: CURRENT_WORKSPACE_SCHEMA_VERSION,
    workspaceId: "workspace.local.main" as WorkspaceId,
    createdAt: now,
    updatedAt: now,
    speakers: input.speakers.map((speaker) => ({
      speakerId: speaker.id,
      displayName: speaker.displayName,
      languages: speaker.supportedLanguages,
    })),
    corpusProgress: [],
    localCorpusSnapshot: null,
    sessions: [],
    capturedSessions: [],
    settings: DEFAULT_WORKSPACE_SETTINGS,
  };
}
