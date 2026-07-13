import type { IsoDateTime } from "@shared/index";
import type { LocalCorpusSnapshot } from "@domains/corpus";
import { CURRENT_WORKSPACE_SCHEMA_VERSION } from "./factory";
import {
  DEFAULT_CAPTURE_PROFILE,
  DEFAULT_WORKSPACE_SETTINGS,
} from "./defaults";
import type {
  CaptureProfile,
  VoiceWorkspace,
  WorkspaceConsentRecord,
  WorkspaceId,
  WorkspaceLicenseRecord,
  WorkspaceSettings,
} from "./types";

export class UnsupportedWorkspaceSchemaError extends Error {
  constructor(
    readonly schemaVersion: number,
    readonly supportedSchemaVersion: number,
  ) {
    super(
      `Cette progression locale utilise le format ${schemaVersion}, plus récent que le format pris en charge (${supportedSchemaVersion}).`,
    );
    this.name = "UnsupportedWorkspaceSchemaError";
  }
}

export function normalizeWorkspacePayload(
  payload: unknown,
  options: {
    readonly now?: Date;
    readonly workspaceId?: WorkspaceId;
  } = {},
): VoiceWorkspace {
  const workspace = isRecord(payload) ? payload : {};
  const schemaVersion = normalizeWorkspaceSchemaVersion(
    workspace.schemaVersion,
  );
  const now = (options.now ?? new Date()).toISOString() as IsoDateTime;

  return {
    schemaVersion,
    workspaceId: coerceString(
      workspace.workspaceId,
      options.workspaceId ?? ("workspace.local.main" as WorkspaceId),
    ) as WorkspaceId,
    createdAt: coerceString(workspace.createdAt, now) as IsoDateTime,
    updatedAt: coerceString(workspace.updatedAt, now) as IsoDateTime,
    speakers: coerceReadonlyArray(workspace.speakers),
    corpusProgress: coerceReadonlyArray(workspace.corpusProgress),
    localCorpusSnapshot: normalizeLocalCorpusSnapshot(
      workspace.localCorpusSnapshot,
    ),
    sessions: coerceReadonlyArray(workspace.sessions),
    capturedSessions: coerceReadonlyArray(workspace.capturedSessions),
    rights: normalizeWorkspaceRights(workspace.rights),
    settings: normalizeWorkspaceSettings(workspace.settings),
  };
}

function normalizeWorkspaceRights(value: unknown): VoiceWorkspace["rights"] {
  const rights = isRecord(value) ? value : {};
  return {
    consents: coerceReadonlyArray(rights.consents).filter(
      isWorkspaceConsentRecord,
    ),
    licenses: coerceReadonlyArray(rights.licenses).filter(
      isWorkspaceLicenseRecord,
    ),
  };
}

function isWorkspaceConsentRecord(
  value: unknown,
): value is WorkspaceConsentRecord {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.consentId) &&
    isNonEmptyString(value.speakerId) &&
    isNonEmptyString(value.policyVersion) &&
    (value.status === "granted" ||
      value.status === "revoked" ||
      value.status === "unknown") &&
    isStringArray(value.grants) &&
    isStringArray(value.restrictions) &&
    isNullableString(value.grantedAt) &&
    isNullableString(value.revokedAt) &&
    isNullableString(value.evidenceRef) &&
    value.source === "local_user_attestation"
  );
}

function isWorkspaceLicenseRecord(
  value: unknown,
): value is WorkspaceLicenseRecord {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.licenseId) &&
    isNonEmptyString(value.corpusId) &&
    isNonEmptyString(value.corpusVersion) &&
    (value.status === "granted" || value.status === "unknown") &&
    isNullableString(value.spdxId) &&
    isStringArray(value.restrictions) &&
    isNullableString(value.evidenceRef) &&
    value.source === "local_user_attestation"
  );
}

function normalizeLocalCorpusSnapshot(
  value: unknown,
): VoiceWorkspace["localCorpusSnapshot"] {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isNonEmptyString(value.corpusId) ||
    !isNonEmptyString(value.language) ||
    !isNonEmptyString(value.text) ||
    (value.mode !== "dubbing" && value.mode !== "mastering")
  ) {
    return null;
  }

  return {
    corpusId: value.corpusId as LocalCorpusSnapshot["corpusId"],
    mode: value.mode as LocalCorpusSnapshot["mode"],
    language: value.language as LocalCorpusSnapshot["language"],
    sourceName: isNonEmptyString(value.sourceName) ? value.sourceName : null,
    text: value.text,
  };
}

function normalizeWorkspaceSchemaVersion(
  value: unknown,
): VoiceWorkspace["schemaVersion"] {
  if (typeof value === "number" && value > CURRENT_WORKSPACE_SCHEMA_VERSION) {
    throw new UnsupportedWorkspaceSchemaError(
      value,
      CURRENT_WORKSPACE_SCHEMA_VERSION,
    );
  }

  return CURRENT_WORKSPACE_SCHEMA_VERSION;
}

function normalizeWorkspaceSettings(settings: unknown): WorkspaceSettings {
  const settingsRecord = isRecord(settings) ? settings : {};

  return {
    preferredSessionMinutes: coerceFiniteInteger(
      settingsRecord.preferredSessionMinutes,
      DEFAULT_WORKSPACE_SETTINGS.preferredSessionMinutes,
      1,
      60,
    ),
    storageMode: isStorageMode(settingsRecord.storageMode)
      ? settingsRecord.storageMode
      : DEFAULT_WORKSPACE_SETTINGS.storageMode,
    captureProfile: normalizeCaptureProfile(settingsRecord.captureProfile),
  };
}

function normalizeCaptureProfile(captureProfile: unknown): CaptureProfile {
  const profile = isRecord(captureProfile) ? captureProfile : {};
  const calibratedAt = isNonEmptyString(profile.calibratedAt)
    ? { calibratedAt: profile.calibratedAt as IsoDateTime }
    : {};
  const roomToneNoiseFloorDbfs = coerceOptionalFiniteNumber(
    profile.roomToneNoiseFloorDbfs,
    -120,
    0,
  );
  const roomTonePeakDbfs = coerceOptionalFiniteNumber(
    profile.roomTonePeakDbfs,
    -120,
    0,
  );
  const roomToneIntegratedLufs = coerceOptionalFiniteNumber(
    profile.roomToneIntegratedLufs,
    -120,
    0,
  );
  const roomToneDurationMs = coerceOptionalFiniteInteger(
    profile.roomToneDurationMs,
    0,
    60_000,
  );

  return {
    microphoneName: coerceString(
      profile.microphoneName,
      DEFAULT_CAPTURE_PROFILE.microphoneName,
    ),
    audioInterface: coerceString(
      profile.audioInterface,
      DEFAULT_CAPTURE_PROFILE.audioInterface,
    ),
    mouthToMicDistanceCm: coerceFiniteInteger(
      profile.mouthToMicDistanceCm,
      DEFAULT_CAPTURE_PROFILE.mouthToMicDistanceCm,
      5,
      45,
    ),
    roomDescription: coerceString(
      profile.roomDescription,
      DEFAULT_CAPTURE_PROFILE.roomDescription,
    ),
    roomToneCaptured:
      typeof profile.roomToneCaptured === "boolean"
        ? profile.roomToneCaptured
        : DEFAULT_CAPTURE_PROFILE.roomToneCaptured,
    ...(roomToneNoiseFloorDbfs === null ? {} : { roomToneNoiseFloorDbfs }),
    ...(roomTonePeakDbfs === null ? {} : { roomTonePeakDbfs }),
    ...(roomToneIntegratedLufs === null ? {} : { roomToneIntegratedLufs }),
    ...(roomToneDurationMs === null ? {} : { roomToneDurationMs }),
    ...calibratedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function coerceString(value: unknown, fallback: string): string {
  return isNonEmptyString(value) ? value : fallback;
}

function coerceReadonlyArray<TValue>(value: unknown): readonly TValue[] {
  return Array.isArray(value) ? (value as readonly TValue[]) : [];
}

function coerceOptionalFiniteNumber(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(max, Math.max(min, value));
}

function coerceOptionalFiniteInteger(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function coerceFiniteInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numericValue = typeof value === "number" ? value : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numericValue)));
}

function isStorageMode(
  value: unknown,
): value is WorkspaceSettings["storageMode"] {
  return value === "file-system-access" || value === "browser-private-storage";
}
