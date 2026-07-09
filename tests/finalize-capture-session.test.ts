import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeCaptureSession,
  type FinalizedRecording,
} from "../src/app/recording/finalizeCaptureSession";
import type { PcmRecordingMetrics } from "../src/app/audio/pcmRecorder";
import { canonicalCorpus, type PromptDefinition } from "../src/domains/corpus";
import { initialSpeakers } from "../src/domains/speakers";
import { planSession, type CaptureSession } from "../src/domains/sessions";
import {
  createEmptyWorkspace,
  type VoiceWorkspace,
  type WorkspaceRepository,
} from "../src/domains/workspace";
import { sha256Blob } from "../src/app/storage/sha256";

const speakerId = initialSpeakers[0].id;
const language = initialSpeakers[0].primaryLanguage;
const recordedAt = new Date("2026-07-09T08:01:30.000Z");
const completedAt = new Date("2026-07-09T08:01:35.000Z");

test("capture finalization persists a non-empty keeper take and export bundle", async () => {
  const { prompt, session, workspace } = createPlannedCapture();
  let savedAudioFileName: string | null = null;
  let metadataSaveCount = 0;
  const result = await finalizeCaptureSession({
    activePrompt: prompt,
    completedAt,
    corpus: canonicalCorpus,
    folderName: "Voice Workspace",
    recordedAt,
    recording: createRecording(new Blob(["audio"], { type: "audio/wav" })),
    saveRecording: async (fileName) => {
      savedAudioFileName = fileName;

      return {
        ok: true,
        value: { fileName, target: "browser-and-folder" },
      };
    },
    saveTakeMetadata: async () => {
      metadataSaveCount += 1;

      return { ok: true, value: { target: "folder" } };
    },
    saveWorkspace: createWorkspaceSave(),
    selectedSpeaker: initialSpeakers[0],
    session,
    workspace,
  });
  const progress = result.nextWorkspace.corpusProgress.find(
    (snapshot) =>
      snapshot.corpusId === canonicalCorpus.id &&
      snapshot.speakerId === speakerId &&
      snapshot.language === language,
  );

  assert.equal(result.take?.promptId, prompt.id);
  assert.equal(result.take?.quality.verdict, "pass");
  assert.equal(result.completedSession.takes.length, 1);
  assert.equal(
    result.exportBundle?.manifestJson.format,
    "voice.capture_session",
  );
  assert.equal(result.audioSaveResult.ok, true);
  assert.equal(result.audioDownloadAvailable, true);
  assert.equal(savedAudioFileName, result.fileName);
  assert.equal(metadataSaveCount, 1);
  assert.equal(result.take?.media.sha256, await sha256Blob(result.audioBlob));
  assert.equal(result.take?.media.byteLength, result.audioBlob.size);
  assert.deepEqual(progress?.completedPrompts, [prompt.id]);
});

test("capture finalization does not credit coverage when no audio blob was captured", async () => {
  const { prompt, session, workspace } = createPlannedCapture();
  let saveRecordingCalled = false;
  let saveMetadataCalled = false;
  const result = await finalizeCaptureSession({
    activePrompt: prompt,
    completedAt,
    corpus: canonicalCorpus,
    folderName: "Voice Workspace",
    recordedAt,
    recording: createRecording(new Blob([], { type: "audio/wav" })),
    saveRecording: async () => {
      saveRecordingCalled = true;

      return {
        ok: true,
        value: { fileName: "invalid.wav", target: "browser" },
      };
    },
    saveTakeMetadata: async () => {
      saveMetadataCalled = true;

      return { ok: true, value: { target: "folder" } };
    },
    saveWorkspace: createWorkspaceSave(),
    selectedSpeaker: initialSpeakers[0],
    session,
    workspace,
  });
  const progress = result.nextWorkspace.corpusProgress.find(
    (snapshot) =>
      snapshot.corpusId === canonicalCorpus.id &&
      snapshot.speakerId === speakerId &&
      snapshot.language === language,
  );

  assert.equal(result.take, null);
  assert.equal(result.exportBundle, null);
  assert.equal(result.completedSession.takes.length, 0);
  assert.equal(result.audioSaveResult.ok, false);
  assert.equal(result.audioDownloadAvailable, false);
  assert.equal(saveRecordingCalled, false);
  assert.equal(saveMetadataCalled, false);
  assert.deepEqual(progress?.completedPrompts ?? [], []);
});

test("capture finalization rejects a take when audio cannot be persisted", async () => {
  const { prompt, session, workspace } = createPlannedCapture();
  let saveMetadataCalled = false;
  const result = await finalizeCaptureSession({
    activePrompt: prompt,
    completedAt,
    corpus: canonicalCorpus,
    folderName: "Stockage du navigateur",
    recordedAt,
    recording: createRecording(new Blob(["audio"], { type: "audio/wav" })),
    saveRecording: async () => ({
      ok: false,
      error: "folder-save-failed",
      message: "Audio prêt, mais le navigateur refuse le stockage local.",
    }),
    saveTakeMetadata: async () => {
      saveMetadataCalled = true;

      return { ok: true, value: { target: "folder" } };
    },
    saveWorkspace: createWorkspaceSave(),
    selectedSpeaker: initialSpeakers[0],
    session,
    workspace,
  });
  const progress = result.nextWorkspace.corpusProgress.find(
    (snapshot) =>
      snapshot.corpusId === canonicalCorpus.id &&
      snapshot.speakerId === speakerId &&
      snapshot.language === language,
  );

  assert.equal(result.audioDownloadAvailable, true);
  assert.equal(result.take?.quality.verdict, "reject");
  assert.equal(result.take?.quality.performance.keeper, false);
  assert.equal(result.take?.review.rating, "reject");
  assert.equal(
    result.take?.quality.gates.some(
      (gate) => gate.id === "audio_persistence" && gate.status === "fail",
    ),
    true,
  );
  assert.equal(result.exportBundle, null);
  assert.equal(saveMetadataCalled, false);
  assert.deepEqual(progress?.completedPrompts ?? [], []);
});

test("capture finalization surfaces metadata folder failures only for chosen folders", async () => {
  const { prompt, session, workspace } = createPlannedCapture();
  const withFolder = await finalizeCaptureSession({
    activePrompt: prompt,
    completedAt,
    corpus: canonicalCorpus,
    folderName: "Voice Workspace",
    recordedAt,
    recording: createRecording(new Blob(["audio"], { type: "audio/wav" })),
    saveRecording: async (fileName) => ({
      ok: true,
      value: { fileName, target: "browser" },
    }),
    saveTakeMetadata: async () => ({
      ok: false,
      error: "folder-save-failed",
      message: "Folder write failed.",
    }),
    saveWorkspace: createWorkspaceSave(),
    selectedSpeaker: initialSpeakers[0],
    session,
    workspace,
  });
  const browserFallback = await finalizeCaptureSession({
    activePrompt: prompt,
    completedAt,
    corpus: canonicalCorpus,
    folderName: "Stockage du navigateur",
    recordedAt,
    recording: createRecording(new Blob(["audio"], { type: "audio/wav" })),
    saveRecording: async (fileName) => ({
      ok: true,
      value: { fileName, target: "browser" },
    }),
    saveTakeMetadata: async () => ({
      ok: false,
      error: "folder-save-failed",
      message: "Folder write failed.",
    }),
    saveWorkspace: createWorkspaceSave(),
    selectedSpeaker: initialSpeakers[0],
    session,
    workspace,
  });

  assert.equal(withFolder.metadataSaveMessage, "Folder write failed.");
  assert.equal(browserFallback.metadataSaveMessage, null);
});

function createPlannedCapture(): {
  readonly prompt: PromptDefinition;
  readonly session: CaptureSession;
  readonly workspace: VoiceWorkspace;
} {
  const workspace = {
    ...createEmptyWorkspace({
      corpus: canonicalCorpus,
      speakers: initialSpeakers,
      now: new Date("2026-07-09T08:00:00.000Z"),
    }),
    settings: {
      ...createEmptyWorkspace({
        corpus: canonicalCorpus,
        speakers: initialSpeakers,
        now: new Date("2026-07-09T08:00:00.000Z"),
      }).settings,
      captureProfile: {
        microphoneName: "SM7B",
        audioInterface: "Apollo Solo",
        mouthToMicDistanceCm: 15,
        roomDescription: "Dry treated office",
        roomToneCaptured: true,
      },
    },
  };
  const session = planSession({
    workspace,
    corpus: canonicalCorpus,
    speakerId,
    language,
    targetMinutes: 5,
    now: new Date("2026-07-09T08:01:00.000Z"),
  });
  const prompt = canonicalCorpus.scenarios
    .flatMap((scenario) => scenario.prompts)
    .find((candidate) => candidate.id === session.plannedPromptIds[0]);

  assert.ok(prompt, "planned prompt should exist in the canonical corpus");

  return { prompt, session, workspace };
}

function createRecording(blob: Blob): FinalizedRecording {
  return {
    blob,
    extension: "wav",
    mimeType: "audio/wav",
    metrics: createMetrics(),
    capture: {
      schemaVersion: "voice.capture_provenance.v1",
      captureApi: "MediaStream",
      capturedChannelCount: 1,
      capturedSampleRateHz: 48000,
      deviceGroupId: null,
      deviceId: null,
      deviceLabel: "Test microphone",
      requestedFormat: {
        bitDepth: 24,
        channels: 1,
        sampleRateHz: 48000,
      },
      processing: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
      sourceSampleRateHz: 48000,
      targetSampleRateHz: 48000,
      resampledToTarget: false,
    },
  };
}

function createMetrics(
  patch: Partial<PcmRecordingMetrics> = {},
): PcmRecordingMetrics {
  return {
    schemaVersion: "voice.audio_metrics.v1",
    durationMs: 3200,
    sampleRateHz: 48000,
    bitDepth: 24,
    channels: 1,
    sampleCount: 153600,
    peakDbfs: -12,
    estimatedTruePeakDbfs: -12,
    rmsDbfs: -19.3,
    integratedLufs: -20,
    noiseFloorDbfs: -72,
    snrDb: 36,
    crestFactorDb: 7.3,
    dcOffset: 0,
    clippingDetected: false,
    clippingSampleCount: 0,
    clippingRate: 0,
    activeSpeechRatio: 0.8,
    silenceRatio: 0.1,
    reverbScore: 0.1,
    plosiveScore: 0.02,
    mouthNoiseScore: 0.02,
    ...patch,
  };
}

function createWorkspaceSave(): WorkspaceRepository["save"] {
  return async (workspace) => ({
    ok: true,
    value: {
      workspace,
      durability: "persistent",
    },
  });
}
