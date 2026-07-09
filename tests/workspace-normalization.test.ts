import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCorpus } from "../src/domains/corpus";
import { initialSpeakers } from "../src/domains/speakers";
import {
  CURRENT_WORKSPACE_SCHEMA_VERSION,
  DEFAULT_CAPTURE_PROFILE,
  UnsupportedWorkspaceSchemaError,
  normalizeWorkspacePayload,
  reconcileWorkspaceProgress,
  type WorkspaceId,
} from "../src/domains/workspace";

test("workspace normalization repairs missing and invalid browser payload fields", () => {
  const now = new Date("2026-07-09T10:00:00.000Z");
  const workspace = normalizeWorkspacePayload(
    {
      schemaVersion: "not-a-version",
      workspaceId: "",
      createdAt: "",
      speakers: "not-an-array",
      corpusProgress: null,
      sessions: ["session.valid"],
      capturedSessions: undefined,
      settings: {
        preferredSessionMinutes: 999.4,
        storageMode: "remote-sync",
        captureProfile: {
          microphoneName: "",
          audioInterface: 42,
          mouthToMicDistanceCm: 2,
          roomDescription: "Dry room",
          roomToneCaptured: true,
          roomToneNoiseFloorDbfs: -68.4,
          roomTonePeakDbfs: -54.2,
          roomToneIntegratedLufs: -72.8,
          roomToneDurationMs: 3001.4,
          calibratedAt: "2026-07-09T09:59:00.000Z",
        },
      },
    },
    {
      now,
      workspaceId: "workspace.test" as WorkspaceId,
    },
  );

  assert.equal(workspace.schemaVersion, CURRENT_WORKSPACE_SCHEMA_VERSION);
  assert.equal(workspace.workspaceId, "workspace.test");
  assert.equal(workspace.createdAt, now.toISOString());
  assert.equal(workspace.updatedAt, now.toISOString());
  assert.deepEqual(workspace.speakers, []);
  assert.deepEqual(workspace.corpusProgress, []);
  assert.deepEqual(workspace.sessions, ["session.valid"]);
  assert.deepEqual(workspace.capturedSessions, []);
  assert.equal(workspace.settings.preferredSessionMinutes, 60);
  assert.equal(workspace.settings.storageMode, "browser-private-storage");
  assert.equal(
    workspace.settings.captureProfile.microphoneName,
    DEFAULT_CAPTURE_PROFILE.microphoneName,
  );
  assert.equal(
    workspace.settings.captureProfile.audioInterface,
    DEFAULT_CAPTURE_PROFILE.audioInterface,
  );
  assert.equal(workspace.settings.captureProfile.mouthToMicDistanceCm, 5);
  assert.equal(workspace.settings.captureProfile.roomDescription, "Dry room");
  assert.equal(workspace.settings.captureProfile.roomToneCaptured, true);
  assert.equal(workspace.settings.captureProfile.roomToneNoiseFloorDbfs, -68.4);
  assert.equal(workspace.settings.captureProfile.roomTonePeakDbfs, -54.2);
  assert.equal(workspace.settings.captureProfile.roomToneIntegratedLufs, -72.8);
  assert.equal(workspace.settings.captureProfile.roomToneDurationMs, 3001);
  assert.equal(
    workspace.settings.captureProfile.calibratedAt,
    "2026-07-09T09:59:00.000Z",
  );
});

test("workspace normalization can create a safe shell from a non-object payload", () => {
  const now = new Date("2026-07-09T11:00:00.000Z");
  const workspace = normalizeWorkspacePayload("corrupt", { now });

  assert.equal(workspace.workspaceId, "workspace.local.main");
  assert.equal(workspace.createdAt, now.toISOString());
  assert.equal(workspace.updatedAt, now.toISOString());
  assert.deepEqual(workspace.sessions, []);
  assert.equal(workspace.settings.preferredSessionMinutes, 5);
});

test("workspace progress reconciliation tolerates malformed browser history entries", () => {
  const speaker = initialSpeakers[0];
  const prompt = canonicalCorpus.scenarios.find(
    (scenario) => scenario.language === speaker.primaryLanguage,
  )?.prompts[0];

  assert.ok(prompt);

  const capturedKeeperSession = {
    corpusId: canonicalCorpus.id,
    speakerId: speaker.id,
    language: speaker.primaryLanguage,
    takes: [
      null,
      {
        promptId: prompt.id,
        review: { rating: "keeper" },
      },
    ],
  };
  const workspace = normalizeWorkspacePayload({
    corpusProgress: [
      null,
      {
        corpusId: canonicalCorpus.id,
        corpusVersionSeen: canonicalCorpus.version,
        speakerId: speaker.id,
        language: speaker.primaryLanguage,
        completedScenarios: "not-an-array",
        completedPrompts: [prompt.id],
      },
    ],
    capturedSessions: [null, capturedKeeperSession],
  });
  const reconciledWorkspace = reconcileWorkspaceProgress(
    workspace,
    canonicalCorpus,
  );
  const sameLengthRepairWorkspace = reconcileWorkspaceProgress(
    normalizeWorkspacePayload({
      corpusProgress: [null],
      capturedSessions: [capturedKeeperSession],
    }),
    canonicalCorpus,
  );

  assert.equal(reconciledWorkspace.corpusProgress.length, 1);
  assert.deepEqual(reconciledWorkspace.corpusProgress[0]?.completedPrompts, [
    prompt.id,
  ]);
  assert.deepEqual(
    sameLengthRepairWorkspace.corpusProgress[0]?.completedPrompts,
    [prompt.id],
  );
});

test("workspace normalization rejects future schema versions without an explicit migration", () => {
  assert.throws(
    () =>
      normalizeWorkspacePayload({
        schemaVersion: CURRENT_WORKSPACE_SCHEMA_VERSION + 1,
      }),
    (error) =>
      error instanceof UnsupportedWorkspaceSchemaError &&
      error.schemaVersion === CURRENT_WORKSPACE_SCHEMA_VERSION + 1 &&
      error.supportedSchemaVersion === CURRENT_WORKSPACE_SCHEMA_VERSION,
  );
});
