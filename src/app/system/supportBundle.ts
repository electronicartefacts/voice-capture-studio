import type { CaptureProfile, WorkspaceDurability } from "@domains/workspace";
import type { LanguageCode } from "@shared/index";
import type { CaptureMode } from "../shell/types";
import type { SurfaceProfile } from "../shell/surfaceProfile";
import type { RuntimeDiagnostics } from "./runtimeDiagnostics";

export const SUPPORT_BUNDLE_SCHEMA = "voice.support_profile.v1" as const;

export function createPrivacySafeSupportBundle(input: {
  readonly captureMode: CaptureMode;
  readonly captureProfile: CaptureProfile | null;
  readonly diagnostics: RuntimeDiagnostics;
  readonly language: LanguageCode;
  readonly recordingCount: number;
  readonly savedSessionCount: number;
  readonly storageMode: "folder-capable" | "browser-downloads";
  readonly surfaceProfile: SurfaceProfile;
  readonly workspaceDurability: WorkspaceDurability | null;
  readonly now?: Date;
}) {
  const profile = input.captureProfile;

  return {
    schemaVersion: SUPPORT_BUNDLE_SCHEMA,
    createdAt: (input.now ?? new Date()).toISOString(),
    privacy: {
      localOnly: true,
      excluded: [
        "audio",
        "transcripts",
        "speaker names",
        "microphone labels",
        "room descriptions",
        "corpus text",
      ],
    },
    surface: {
      profile: input.surfaceProfile,
      storageMode: input.storageMode,
    },
    runtime: {
      status: input.diagnostics.status,
      canRecord: input.diagnostics.canRecord,
      canPersistWorkspace: input.diagnostics.canPersistWorkspace,
      canPersistRecordings: input.diagnostics.canPersistRecordings,
      canExportFolder: input.diagnostics.canExportFolder,
      canDownloadFallback: input.diagnostics.canDownloadFallback,
      recordingInputCount: input.diagnostics.recordingInputCount,
      supportsLocalSpeechRecognition:
        input.diagnostics.supportsLocalSpeechRecognition,
      supportsSpeechSynthesis: input.diagnostics.supportsSpeechSynthesis,
      supportsBackgroundProcessing:
        input.diagnostics.supportsBackgroundProcessing,
      supportsHardwareRendering: input.diagnostics.supportsHardwareRendering,
      storageEstimate: input.diagnostics.storageEstimate,
      checks: input.diagnostics.checks.map(({ id, status }) => ({
        id,
        status,
      })),
    },
    capture: {
      mode: input.captureMode,
      language: input.language,
      roomToneCaptured: profile?.roomToneCaptured ?? false,
      roomToneDurationMs: profile?.roomToneDurationMs ?? null,
      roomToneNoiseFloorDbfs: profile?.roomToneNoiseFloorDbfs ?? null,
      roomTonePeakDbfs: profile?.roomTonePeakDbfs ?? null,
      roomToneIntegratedLufs: profile?.roomToneIntegratedLufs ?? null,
    },
    persistence: {
      workspaceDurability: input.workspaceDurability,
      savedSessionCount: input.savedSessionCount,
      recordingCount: input.recordingCount,
    },
  };
}

export function createSupportBundleFile(
  bundle: ReturnType<typeof createPrivacySafeSupportBundle>,
): { readonly blob: Blob; readonly fileName: string } {
  const date = bundle.createdAt.slice(0, 10);
  return {
    blob: new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json",
    }),
    fileName: `voice-capture-studio-support-${date}.json`,
  };
}
