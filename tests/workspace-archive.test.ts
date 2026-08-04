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
  const roomTone = encodeWav24(new Float32Array(960), 48_000);
  const baseWorkspace = await createWorkspaceWithRecording("take.one.wav", wav);
  const workspace: VoiceWorkspace = {
    ...baseWorkspace,
    settings: {
      ...baseWorkspace.settings,
      captureProfile: {
        ...baseWorkspace.settings.captureProfile,
        roomToneCaptured: true,
        roomToneFileName: "room-tone.one.wav",
        roomToneSha256: await sha256Blob(roomTone),
      },
    },
  };
  const archive = await createWorkspaceArchive({
    workspace,
    getAudioBlob: async (fileName) =>
      fileName === "take.one.wav"
        ? wav
        : fileName === "room-tone.one.wav"
          ? roomTone
          : undefined,
    now: new Date("2026-07-11T08:00:00.000Z"),
  });
  const restored = await readWorkspaceArchive(archive.blob);

  assert.equal(archive.recordingCount, 2);
  assert.match(archive.fileName, /\.workspace\.zip$/);
  assert.equal(restored.workspace.capturedSessions.length, 1);
  assert.deepEqual(
    restored.recordings.map((recording) => recording.fileName).sort(),
    ["room-tone.one.wav", "take.one.wav"],
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

test("workspace archive round-trips a large multi-session collection without rereading sources", async () => {
  const recordingCount = 24;
  const recordings = await Promise.all(
    Array.from({ length: recordingCount }, async (_, index) => {
      const samples = new Float32Array(4_800);
      samples[index % samples.length] = (index + 1) / 100;
      const blob = encodeWav24(samples, 48_000);
      return {
        blob,
        fileName: `session.stress.take-${index.toString().padStart(2, "0")}.wav`,
        sha256: await sha256Blob(blob),
      };
    }),
  );
  const base = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-11T07:00:00.000Z"),
  });
  const workspace: VoiceWorkspace = {
    ...base,
    capturedSessions: Array.from({ length: 4 }, (_, sessionIndex) => ({
      id: `session.stress.${sessionIndex}`,
      speakerId: initialSpeakers[0].id,
      language: "fr",
      corpusId: canonicalCorpus.id,
      scenarioIds: [],
      plannedPromptIds: [],
      startedAt: "2026-07-11T07:00:00.000Z",
      takes: recordings
        .slice(sessionIndex * 6, sessionIndex * 6 + 6)
        .map((recording) => ({
          fileName: recording.fileName,
          media: {
            byteLength: recording.blob.size,
            sha256: recording.sha256,
          },
        })),
    })) as unknown as VoiceWorkspace["capturedSessions"],
  };
  const sourceByName = new Map(
    recordings.map((recording) => [recording.fileName, recording.blob]),
  );
  const sourceReads = new Map<string, number>();
  const archive = await createWorkspaceArchive({
    workspace,
    getAudioBlob: async (fileName) => {
      sourceReads.set(fileName, (sourceReads.get(fileName) ?? 0) + 1);
      return sourceByName.get(fileName);
    },
    now: new Date("2026-07-11T08:00:00.000Z"),
  });
  const restored = await readWorkspaceArchive(archive.blob);

  assert.equal(archive.recordingCount, recordingCount);
  assert.equal(restored.workspace.capturedSessions.length, 4);
  assert.equal(restored.recordings.length, recordingCount);
  assert.equal(
    new Set(restored.recordings.map((item) => item.sha256)).size,
    24,
  );
  assert.deepEqual(
    [...sourceReads.values()],
    Array.from({ length: recordingCount }, () => 1),
  );
});

test("workspace archive rejects generated unsafe recording names at the import boundary", async () => {
  const generatedUnsafeNames = Array.from({ length: 36 }, (_, index) => {
    const token = `take-${index.toString(36)}`;
    switch (index % 4) {
      case 0:
        return `../${token}.wav`;
      case 1:
        return `folder\\${token}.wav`;
      case 2:
        return `${token}\u0000.wav`;
      default:
        return `${token}.mp3`;
    }
  });

  for (const fileName of generatedUnsafeNames) {
    const archive = await createZipBlob([
      {
        path: "manifest.json",
        data: new Blob([
          JSON.stringify({
            archiveFormat: "voice-capture-studio.workspace-archive",
            archiveFormatVersion: "1.0.0",
            workspace: {
              schemaVersion: 2,
              capturedSessions: [{ takes: [{ fileName }] }],
            },
            recordings: [],
          }),
        ]),
      },
    ]);

    await assert.rejects(
      () => readWorkspaceArchive(archive),
      /Unsafe recording file name/,
      fileName,
    );
  }
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
