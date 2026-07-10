import {
  normalizeWorkspacePayload,
  type VoiceWorkspace,
} from "../../domains/workspace";
import type { IsoDateTime } from "../../shared";
import { validatePcmWavBlob } from "../audio/wavValidation";
import { createZipBlobOffThread } from "../export/zipService";
import { readStoredZipEntries } from "../export/zipReader";
import type { ZipEntryInput } from "../export/zipWriter";
import { sha256Blob } from "./sha256";

const ARCHIVE_FORMAT = "voice-capture-studio.workspace-archive";
const ARCHIVE_FORMAT_VERSION = "1.0.0";
const MANIFEST_PATH = "manifest.json";
const MAX_MANIFEST_BYTES = 20 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type WorkspaceArchiveRecording = {
  readonly fileName: string;
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
};

type WorkspaceArchiveManifest = {
  readonly archiveFormat: typeof ARCHIVE_FORMAT;
  readonly archiveFormatVersion: typeof ARCHIVE_FORMAT_VERSION;
  readonly createdAt: IsoDateTime;
  readonly workspace: VoiceWorkspace;
  readonly recordings: readonly WorkspaceArchiveRecording[];
};

export type WorkspaceArchive = {
  readonly blob: Blob;
  readonly fileName: string;
  readonly recordingCount: number;
};

export type RestoredWorkspaceArchive = {
  readonly workspace: VoiceWorkspace;
  readonly recordings: readonly {
    readonly fileName: string;
    readonly blob: Blob;
    readonly sha256: string;
  }[];
};

export async function createWorkspaceArchive(input: {
  readonly workspace: VoiceWorkspace;
  readonly getAudioBlob: (fileName: string) => Promise<Blob | undefined>;
  readonly now: Date;
}): Promise<WorkspaceArchive> {
  const takeRecords = collectTakeRecords(input.workspace);
  const fileNames = [
    ...new Set(takeRecords.map((take) => take.fileName)),
  ].sort();
  const recordings: WorkspaceArchiveRecording[] = [];
  const audioEntries = new Map<string, Blob>();

  for (const fileName of fileNames) {
    const blob = await input.getAudioBlob(fileName);
    if (blob === undefined) {
      throw new Error(
        `Audio file ${fileName} is missing; archive creation is aborted.`,
      );
    }

    await validatePcmWavBlob(blob);
    const sha256 = await sha256Blob(blob);
    const path = `audio/${sha256}.wav`;
    const matchingTakes = takeRecords.filter(
      (take) => take.fileName === fileName,
    );

    for (const take of matchingTakes) {
      const media = isRecord(take.value.media) ? take.value.media : null;
      if (
        typeof media?.sha256 === "string" &&
        media.sha256.length > 0 &&
        media.sha256 !== sha256
      ) {
        throw new Error(`Audio hash mismatch for ${fileName}.`);
      }
      if (
        typeof media?.byteLength === "number" &&
        media.byteLength !== blob.size
      ) {
        throw new Error(`Audio byte length mismatch for ${fileName}.`);
      }
    }

    recordings.push({ fileName, path, byteLength: blob.size, sha256 });
    audioEntries.set(path, blob);
  }

  const createdAt = input.now.toISOString() as IsoDateTime;
  const manifest: WorkspaceArchiveManifest = {
    archiveFormat: ARCHIVE_FORMAT,
    archiveFormatVersion: ARCHIVE_FORMAT_VERSION,
    createdAt,
    workspace: input.workspace,
    recordings,
  };
  const entries: ZipEntryInput[] = [
    {
      path: MANIFEST_PATH,
      data: new Blob([JSON.stringify(manifest, null, 2)], {
        type: "application/json",
      }),
    },
    ...[...audioEntries].map(([path, data]) => ({ path, data })),
  ];

  return {
    blob: await createZipBlobOffThread(entries),
    fileName: `voice-capture-studio.${sanitizeFileSegment(input.workspace.workspaceId)}.${sanitizeFileSegment(createdAt)}.workspace.zip`,
    recordingCount: recordings.length,
  };
}

export async function readWorkspaceArchive(
  archive: Blob,
): Promise<RestoredWorkspaceArchive> {
  const entries = await readStoredZipEntries(archive);
  const manifestBlob = entries.get(MANIFEST_PATH);

  if (manifestBlob === undefined) {
    throw new Error("Workspace archive manifest is missing.");
  }
  if (manifestBlob.size > MAX_MANIFEST_BYTES) {
    throw new Error("Workspace archive manifest exceeds 20 MiB.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await manifestBlob.text());
  } catch {
    throw new Error("Workspace archive manifest is not valid JSON.");
  }

  if (!isRecord(payload) || payload.archiveFormat !== ARCHIVE_FORMAT) {
    throw new Error("File is not a Voice Capture Studio workspace archive.");
  }
  if (payload.archiveFormatVersion !== ARCHIVE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported workspace archive version: ${String(payload.archiveFormatVersion)}.`,
    );
  }
  if (!Array.isArray(payload.recordings)) {
    throw new Error("Workspace archive recording index is invalid.");
  }

  const workspace = normalizeWorkspacePayload(payload.workspace);
  const referencedFileNames = new Set(
    collectTakeRecords(workspace).map((take) => take.fileName),
  );
  const recordings = payload.recordings.map(parseRecordingEntry);
  const recordingByFileName = new Map<string, WorkspaceArchiveRecording>();

  for (const recording of recordings) {
    if (recordingByFileName.has(recording.fileName)) {
      throw new Error(`Duplicate recording mapping: ${recording.fileName}.`);
    }
    if (!referencedFileNames.has(recording.fileName)) {
      throw new Error(
        `Archive contains unreferenced audio: ${recording.fileName}.`,
      );
    }
    recordingByFileName.set(recording.fileName, recording);
  }

  for (const fileName of referencedFileNames) {
    if (!recordingByFileName.has(fileName)) {
      throw new Error(`Archive is missing referenced audio: ${fileName}.`);
    }
  }

  const expectedPaths = new Set([
    MANIFEST_PATH,
    ...recordings.map((item) => item.path),
  ]);
  for (const path of entries.keys()) {
    if (!expectedPaths.has(path)) {
      throw new Error(`Archive contains an unexpected entry: ${path}.`);
    }
  }

  const verifiedAudio = new Map<
    string,
    { readonly blob: Blob; readonly sha256: string }
  >();
  for (const recording of recordings) {
    if (verifiedAudio.has(recording.path)) {
      continue;
    }

    const storedBlob = entries.get(recording.path);
    if (storedBlob === undefined) {
      throw new Error(`Archive audio entry is missing: ${recording.path}.`);
    }
    const blob = new Blob([await storedBlob.arrayBuffer()], {
      type: "audio/wav",
    });
    if (blob.size !== recording.byteLength) {
      throw new Error(`Archive audio size mismatch: ${recording.fileName}.`);
    }
    await validatePcmWavBlob(blob);
    const sha256 = await sha256Blob(blob);
    if (sha256 !== recording.sha256) {
      throw new Error(`Archive audio hash mismatch: ${recording.fileName}.`);
    }
    verifiedAudio.set(recording.path, { blob, sha256 });
  }

  return {
    workspace,
    recordings: recordings.map((recording) => {
      const verified = verifiedAudio.get(recording.path);
      if (verified === undefined) {
        throw new Error(
          `Archive audio was not verified: ${recording.fileName}.`,
        );
      }
      return {
        fileName: recording.fileName,
        blob: verified.blob,
        sha256: verified.sha256,
      };
    }),
  };
}

function parseRecordingEntry(value: unknown): WorkspaceArchiveRecording {
  if (!isRecord(value)) {
    throw new Error("Workspace archive contains an invalid recording mapping.");
  }

  const { fileName, path, byteLength, sha256 } = value;
  assertSafeRecordingFileName(fileName);
  if (
    typeof path !== "string" ||
    typeof sha256 !== "string" ||
    !SHA256_PATTERN.test(sha256) ||
    path !== `audio/${sha256}.wav` ||
    typeof byteLength !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength <= 0
  ) {
    throw new Error(`Workspace archive mapping is invalid for ${fileName}.`);
  }

  return { fileName, path, byteLength, sha256 };
}

function collectTakeRecords(workspace: VoiceWorkspace): readonly {
  readonly fileName: string;
  readonly value: Record<string, unknown>;
}[] {
  const result: { fileName: string; value: Record<string, unknown> }[] = [];

  for (const session of workspace.capturedSessions as readonly unknown[]) {
    if (!isRecord(session) || !Array.isArray(session.takes)) {
      throw new Error("Workspace contains a malformed captured session.");
    }
    for (const take of session.takes) {
      if (!isRecord(take)) {
        throw new Error("Workspace contains a malformed recorded take.");
      }
      assertSafeRecordingFileName(take.fileName);
      result.push({ fileName: take.fileName, value: take });
    }
  }

  return result;
}

function assertSafeRecordingFileName(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    value.includes("/") ||
    value.includes("\\") ||
    hasControlCharacter(value) ||
    !value.toLowerCase().endsWith(".wav")
  ) {
    throw new Error(`Unsafe recording file name: ${String(value)}.`);
  }
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
