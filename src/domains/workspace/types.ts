import type { Brand, IsoDateTime, LanguageCode, Semver } from "@shared/index";
import type {
  CorpusId,
  LocalCorpusSnapshot,
  PromptId,
  ScenarioId,
} from "@domains/corpus";
import type { SpeakerId } from "@domains/speakers";
import type { CaptureSession, SessionId } from "@domains/sessions";

export type WorkspaceId = Brand<string, "WorkspaceId">;
export type WorkspaceSchemaVersion = Brand<number, "WorkspaceSchemaVersion">;

export type VoiceWorkspace = {
  readonly schemaVersion: WorkspaceSchemaVersion;
  readonly workspaceId: WorkspaceId;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly speakers: readonly WorkspaceSpeaker[];
  readonly corpusProgress: readonly CorpusProgressSnapshot[];
  readonly localCorpusSnapshot: LocalCorpusSnapshot | null;
  readonly sessions: readonly SessionId[];
  readonly capturedSessions: readonly CaptureSession[];
  readonly rights: WorkspaceRights;
  readonly settings: WorkspaceSettings;
};

export type WorkspaceRights = {
  readonly consents: readonly WorkspaceConsentRecord[];
  readonly licenses: readonly WorkspaceLicenseRecord[];
};

export type WorkspaceConsentRecord = {
  readonly consentId: string;
  readonly speakerId: string;
  readonly policyVersion: string;
  readonly status: "granted" | "revoked" | "unknown";
  readonly grants: readonly string[];
  readonly restrictions: readonly string[];
  readonly grantedAt: string | null;
  readonly revokedAt: string | null;
  readonly evidenceRef: string | null;
  readonly source: "local_user_attestation";
};

export type WorkspaceLicenseRecord = {
  readonly licenseId: string;
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly status: "granted" | "unknown";
  readonly spdxId: string | null;
  readonly restrictions: readonly string[];
  readonly evidenceRef: string | null;
  readonly source: "local_user_attestation";
};

export type WorkspaceSpeaker = {
  readonly speakerId: SpeakerId;
  readonly displayName: string;
  readonly languages: readonly LanguageCode[];
};

export type CorpusProgressSnapshot = {
  readonly corpusId: CorpusId;
  readonly corpusVersionSeen: Semver;
  readonly speakerId: SpeakerId;
  readonly language: LanguageCode;
  readonly completedScenarios: readonly ScenarioId[];
  readonly completedPrompts: readonly PromptId[];
};

export type WorkspaceSettings = {
  readonly preferredSessionMinutes: number;
  readonly storageMode: "file-system-access" | "browser-private-storage";
  readonly captureProfile: CaptureProfile;
};

export type CaptureProfile = {
  readonly microphoneName: string;
  readonly audioInterface: string;
  readonly mouthToMicDistanceCm: number;
  readonly roomDescription: string;
  readonly roomToneCaptured: boolean;
  readonly roomToneNoiseFloorDbfs?: number;
  readonly roomTonePeakDbfs?: number;
  readonly roomToneIntegratedLufs?: number;
  readonly roomToneDurationMs?: number;
  readonly calibratedAt?: IsoDateTime;
  readonly roomToneFileName?: string;
  readonly roomToneSha256?: string;
};
