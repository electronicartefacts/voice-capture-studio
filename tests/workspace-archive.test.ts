import assert from "node:assert/strict";
import test from "node:test";
import { encodeWav24 } from "../src/app/audio/pcmAudio";
import { createZipBlob } from "../src/app/export/zipWriter";
import { sha256Blob } from "../src/app/storage/sha256";
import {
  createWorkspaceArchive,
  readWorkspaceArchive,
} from "../src/app/storage/workspaceArchive";
import { canonicalCorpus } from "../src/domains/corpus";
import { initialSpeakers } from "../src/domains/speakers";
import {
  createEmptyWorkspace,
  type VoiceWorkspace,
} from "../src/domains/workspace";

test("workspace archive round-trips progression and every referenced WAV", async () => {
  const wav = encodeWav24(new Float32Array(480), 48_000);
  const workspace = await createWorkspaceWithRecording("take.one.wav", wav);
  const archive = await createWorkspaceArchive({
    workspace,
    getAudioBlob: async (fileName) =>
      fileName === "take.one.wav" ? wav : undefined,
    now: new Date("2026-07-11T08:00:00.000Z"),
  });
  const restored = await readWorkspaceArchive(archive.blob);

  assert.equal(archive.recordingCount, 1);
  assert.match(archive.fileName, /\.workspace\.zip$/);
  assert.equal(restored.workspace.capturedSessions.length, 1);
  assert.equal(restored.recordings[0].fileName, "take.one.wav");
  assert.equal(
    await sha256Blob(restored.recordings[0].blob),
    await sha256Blob(wav),
  );
});

test("workspace archive creation refuses incomplete audio history", async () => {
  const wav = encodeWav24(new Float32Array(48), 48_000);
  const workspace = await createWorkspaceWithRecording("missing.wav", wav);

  await assert.rejects(
    () =>
      createWorkspaceArchive({
        workspace,
        getAudioBlob: async () => undefined,
        now: new Date("2026-07-11T08:00:00.000Z"),
      }),
    /missing; archive creation is aborted/,
  );
});

test("workspace archive import rejects unsupported manifest versions", async () => {
  const archive = await createZipBlob([
    {
      path: "manifest.json",
      data: new Blob([
        JSON.stringify({
          archiveFormat: "voice-capture-studio.workspace-archive",
          archiveFormatVersion: "2.0.0",
          workspace: {},
          recordings: [],
        }),
      ]),
    },
  ]);

  await assert.rejects(
    () => readWorkspaceArchive(archive),
    /Unsupported workspace archive version/,
  );
});

async function createWorkspaceWithRecording(
  fileName: string,
  wav: Blob,
): Promise<VoiceWorkspace> {
  const base = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-11T07:00:00.000Z"),
  });
  const sha256 = await sha256Blob(wav);

  return {
    ...base,
    capturedSessions: [
      {
        id: "session.archive",
        speakerId: initialSpeakers[0].id,
        language: "fr",
        corpusId: canonicalCorpus.id,
        scenarioIds: [],
        plannedPromptIds: [],
        startedAt: "2026-07-11T07:00:00.000Z",
        takes: [
          {
            fileName,
            media: { byteLength: wav.size, sha256 },
          },
        ],
      },
    ] as unknown as VoiceWorkspace["capturedSessions"],
  };
}
