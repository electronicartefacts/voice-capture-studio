import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrivacySafeSupportBundle,
  createSupportBundleFile,
  SUPPORT_BUNDLE_SCHEMA,
} from "../src/app/system/supportBundle";
import { DEFAULT_CAPTURE_PROFILE } from "../src/domains/workspace";
import type { RuntimeDiagnostics } from "../src/app/system/runtimeDiagnostics";

test("support bundle reports field conditions without recording or identity data", async () => {
  const forbiddenMicrophone = "Joey private microphone";
  const forbiddenRoom = "Private home address";
  const bundle = createPrivacySafeSupportBundle({
    captureMode: "training",
    captureProfile: {
      ...DEFAULT_CAPTURE_PROFILE,
      microphoneName: forbiddenMicrophone,
      roomDescription: forbiddenRoom,
      roomToneCaptured: true,
      roomToneNoiseFloorDbfs: -62,
    },
    diagnostics: createDiagnostics(),
    language: "fr",
    now: new Date("2026-08-04T12:00:00.000Z"),
    recordingCount: 8,
    savedSessionCount: 3,
    storageMode: "browser-downloads",
    surfaceProfile: "mobile-focus",
    workspaceDurability: "persistent",
  });
  const file = createSupportBundleFile(bundle);
  const payload = await file.blob.text();

  assert.equal(bundle.schemaVersion, SUPPORT_BUNDLE_SCHEMA);
  assert.equal(bundle.runtime.status, "limited");
  assert.equal(bundle.capture.roomToneNoiseFloorDbfs, -62);
  assert.equal(file.fileName, "voice-capture-studio-support-2026-08-04.json");
  assert.doesNotMatch(payload, new RegExp(forbiddenMicrophone));
  assert.doesNotMatch(payload, new RegExp(forbiddenRoom));
  assert.doesNotMatch(payload, /transcript content that must stay private/);
});

function createDiagnostics(): RuntimeDiagnostics {
  return {
    canRecord: true,
    canPersistWorkspace: true,
    canPersistRecordings: true,
    canExportFolder: false,
    canDownloadFallback: true,
    recordingInputCount: 1,
    supportsLocalSpeechRecognition: false,
    supportsSpeechSynthesis: true,
    supportsBackgroundProcessing: true,
    supportsHardwareRendering: true,
    primaryAction: "Keep recording locally.",
    primaryRisk: "No folder access.",
    status: "limited",
    storageEstimate: { quotaMb: 1024, usageMb: 24 },
    checks: [
      {
        id: "folder-export",
        label: "Folder",
        status: "limited",
        detail: "transcript content that must stay private",
        action: "Use download.",
      },
    ],
  };
}
