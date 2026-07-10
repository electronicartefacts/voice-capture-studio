import type { Result } from "@shared/index";
import {
  FOLDER_STORE_NAME,
  RECORDINGS_STORE_NAME,
  openDatabase,
  requestResult,
  transactionDone,
} from "./indexedDb";
import { sha256Blob } from "./sha256";

type DirectoryHandle = {
  readonly name: string;
  readonly removeEntry?: (name: string) => Promise<void>;
  getDirectoryHandle?: (
    name: string,
    options?: { readonly create?: boolean },
  ) => Promise<DirectoryHandle>;
  getFileHandle?: (
    name: string,
    options?: { readonly create?: boolean },
  ) => Promise<{
    createWritable: () => Promise<{
      abort?: () => Promise<void>;
      close: () => Promise<void>;
      write: (data: Blob) => Promise<void>;
    }>;
    getFile?: () => Promise<Blob>;
  }>;
  queryPermission?: (descriptor?: {
    readonly mode?: "read" | "readwrite";
  }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: {
    readonly mode?: "read" | "readwrite";
  }) => Promise<PermissionState>;
};

type WindowWithFolderPicker = Window &
  typeof globalThis & {
    showDirectoryPicker?: () => Promise<DirectoryHandle>;
  };

const FOLDER_NAME_KEY = "voice-capture-studio.folder-name.v1";
const HANDLE_KEY = "directory-handle";
const FALLBACK_FOLDER_NAME = "Stockage du navigateur";
let inMemoryDirectoryHandle: DirectoryHandle | null = null;

export type RecordingSaveTarget = "browser" | "browser-and-folder" | "folder";

export type StoredRecording = {
  readonly blob: Blob;
  readonly fileName: string;
  readonly savedAt: string;
};

export function getRememberedFolderName(): string | null {
  try {
    return window.localStorage.getItem(FOLDER_NAME_KEY);
  } catch {
    return inMemoryDirectoryHandle?.name ?? null;
  }
}

export function canChooseSystemFolder(): boolean {
  return (window as WindowWithFolderPicker).showDirectoryPicker !== undefined;
}

export async function chooseWorkspaceFolder(): Promise<
  Result<
    { readonly folderName: string },
    "folder-unavailable" | "folder-save-failed"
  >
> {
  const picker = (window as WindowWithFolderPicker).showDirectoryPicker;

  if (picker === undefined) {
    rememberFolderName(FALLBACK_FOLDER_NAME);

    return {
      ok: true,
      value: { folderName: FALLBACK_FOLDER_NAME },
    };
  }

  try {
    const handle = await picker();
    await saveDirectoryHandle(handle);
    rememberFolderName(handle.name);

    return {
      ok: true,
      value: { folderName: handle.name },
    };
  } catch (error) {
    if (isPickerCancelled(error)) {
      return {
        ok: false,
        error: "folder-unavailable",
        message: "Sélection annulée. Le stockage navigateur reste disponible.",
      };
    }

    if (isPickerUnavailableAtRuntime(error)) {
      rememberFolderName(FALLBACK_FOLDER_NAME);

      return {
        ok: true,
        value: { folderName: FALLBACK_FOLDER_NAME },
      };
    }

    return {
      ok: false,
      error: "folder-save-failed",
      message:
        error instanceof Error
          ? error.message
          : "Le dossier n'a pas pu être mémorisé.",
    };
  }
}

function isPickerCancelled(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "NotAllowedError")
  );
}

function isPickerUnavailableAtRuntime(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "SecurityError" ||
    error.message.includes("user gesture") ||
    error.message.includes("showDirectoryPicker")
  );
}

export async function saveRecordingToWorkspaceFolder(
  fileName: string,
  audioBlob: Blob,
): Promise<
  Result<
    { readonly fileName: string; readonly target: RecordingSaveTarget },
    "folder-unavailable" | "folder-save-failed"
  >
> {
  let browserStorageOk = true;

  try {
    await saveRecordingToBrowserStorage(fileName, audioBlob);
  } catch {
    browserStorageOk = false;
  }

  const handle = await readDirectoryHandle();

  if (
    handle?.getDirectoryHandle === undefined ||
    handle.getFileHandle === undefined
  ) {
    return browserStorageOk
      ? {
          ok: true,
          value: { fileName, target: "browser" },
        }
      : {
          ok: false,
          error: "folder-save-failed",
          message: "Audio prêt, mais le navigateur refuse le stockage local.",
        };
  }

  if (!(await requestReadWritePermission(handle))) {
    return browserStorageOk
      ? {
          ok: true,
          value: { fileName, target: "browser" },
        }
      : {
          ok: false,
          error: "folder-unavailable",
          message:
            "Autorise l'écriture dans le dossier pour sauvegarder l'audio.",
        };
  }

  try {
    const takesDirectory = await handle.getDirectoryHandle("takes", {
      create: true,
    });
    if (takesDirectory.getFileHandle === undefined) {
      return browserStorageOk
        ? {
            ok: true,
            value: { fileName, target: "browser" },
          }
        : {
            ok: false,
            error: "folder-save-failed",
            message: "Audio prêt, mais le navigateur refuse le stockage local.",
          };
    }

    const fileHandle = await takesDirectory.getFileHandle(fileName, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(audioBlob);
    await writable.close();

    return {
      ok: true,
      value: {
        fileName,
        target: browserStorageOk ? "browser-and-folder" : "folder",
      },
    };
  } catch {
    return browserStorageOk
      ? {
          ok: true,
          value: { fileName, target: "browser" },
        }
      : {
          ok: false,
          error: "folder-save-failed",
          message: "Audio prêt, mais le navigateur refuse le stockage local.",
        };
  }
}

export async function saveTakeMetadataToWorkspaceFolder(input: {
  readonly audioBlob?: Blob;
  readonly corpusJson: unknown;
  readonly manifestJson: Omit<VoiceCaptureSessionManifest, "artifacts">;
  readonly reportsJson: VoiceCaptureReportsJson;
  readonly sessionId: string;
  readonly speakerJson: unknown;
  readonly takeJson: unknown;
  readonly takeId: string;
  readonly transcriptText: string;
  readonly timingJson: unknown;
  readonly phonemesJson: unknown;
  readonly intentJson: unknown;
  readonly qualityJson: unknown;
  readonly observationJson: unknown;
  readonly evidenceJson: unknown;
  readonly sessionJson: unknown;
}): Promise<
  Result<
    { readonly target: "folder" },
    "folder-unavailable" | "folder-save-failed"
  >
> {
  const handle = await readDirectoryHandle();

  if (handle?.getDirectoryHandle === undefined) {
    return {
      ok: false,
      error: "folder-unavailable",
      message:
        "Aucun dossier local connecté pour écrire les métadonnées de session.",
    };
  }

  if (!(await requestReadWritePermission(handle))) {
    return {
      ok: false,
      error: "folder-unavailable",
      message:
        "Autorise l'écriture dans le dossier pour exporter les métadonnées de session.",
    };
  }

  try {
    const sessionDirectory = await ensureDirectory(
      handle,
      sanitizePathSegment(input.sessionId),
    );
    const takesDirectory = await ensureDirectory(sessionDirectory, "takes");
    const takeDirectory = await ensureDirectory(
      takesDirectory,
      sanitizePathSegment(input.takeId),
    );
    const reportsDirectory = await ensureDirectory(sessionDirectory, "reports");
    const artifacts: VoiceCaptureSessionArtifact[] = [];

    await writeTrackedBlob(
      artifacts,
      sessionDirectory,
      "session.json",
      jsonBlob(input.sessionJson),
    );
    await writeTrackedBlob(
      artifacts,
      sessionDirectory,
      "speaker.json",
      jsonBlob(input.speakerJson),
    );
    await writeTrackedBlob(
      artifacts,
      sessionDirectory,
      "corpus.json",
      jsonBlob(input.corpusJson),
    );
    if (input.audioBlob !== undefined) {
      await writeTrackedBlob(
        artifacts,
        takeDirectory,
        "audio.wav",
        input.audioBlob,
        `takes/${sanitizePathSegment(input.takeId)}/audio.wav`,
      );
    }
    await writeTrackedBlob(
      artifacts,
      takeDirectory,
      "take.json",
      jsonBlob(input.takeJson),
      `takes/${sanitizePathSegment(input.takeId)}/take.json`,
    );
    await writeTrackedBlob(
      artifacts,
      takeDirectory,
      "transcript.txt",
      textBlob(input.transcriptText),
      `takes/${sanitizePathSegment(input.takeId)}/transcript.txt`,
    );
    await writeTrackedBlob(
      artifacts,
      takeDirectory,
      "timing.json",
      jsonBlob(input.timingJson),
      `takes/${sanitizePathSegment(input.takeId)}/timing.json`,
    );
    await writeTrackedBlob(
      artifacts,
      takeDirectory,
      "phonemes.json",
      jsonBlob(input.phonemesJson),
      `takes/${sanitizePathSegment(input.takeId)}/phonemes.json`,
    );
    await writeTrackedBlob(
      artifacts,
      takeDirectory,
      "intent.json",
      jsonBlob(input.intentJson),
      `takes/${sanitizePathSegment(input.takeId)}/intent.json`,
    );
    await writeTrackedBlob(
      artifacts,
      takeDirectory,
      "quality.json",
      jsonBlob(input.qualityJson),
      `takes/${sanitizePathSegment(input.takeId)}/quality.json`,
    );
    await writeTrackedBlob(
      artifacts,
      takeDirectory,
      "observation.json",
      jsonBlob(input.observationJson),
      `takes/${sanitizePathSegment(input.takeId)}/observation.json`,
    );
    await writeTrackedBlob(
      artifacts,
      takeDirectory,
      "evidence.json",
      jsonBlob(input.evidenceJson),
      `takes/${sanitizePathSegment(input.takeId)}/evidence.json`,
    );

    await writeTrackedBlob(
      artifacts,
      reportsDirectory,
      "report.audio_quality.json",
      jsonBlob(input.reportsJson.audioQuality),
      "reports/report.audio_quality.json",
    );
    await writeTrackedBlob(
      artifacts,
      reportsDirectory,
      "report.transcript_alignment.json",
      jsonBlob(input.reportsJson.transcriptAlignment),
      "reports/report.transcript_alignment.json",
    );
    await writeTrackedBlob(
      artifacts,
      reportsDirectory,
      "report.phonetic_coverage.json",
      jsonBlob(input.reportsJson.phoneticCoverage),
      "reports/report.phonetic_coverage.json",
    );
    await writeTrackedBlob(
      artifacts,
      reportsDirectory,
      "report.intent_balance.json",
      jsonBlob(input.reportsJson.intentBalance),
      "reports/report.intent_balance.json",
    );
    await writeTrackedBlob(
      artifacts,
      reportsDirectory,
      "report.prosody_distribution.json",
      jsonBlob(input.reportsJson.prosodyDistribution),
      "reports/report.prosody_distribution.json",
    );
    await writeTrackedBlob(
      artifacts,
      reportsDirectory,
      "report.dataset_readiness.json",
      jsonBlob(input.reportsJson.datasetReadiness),
      "reports/report.dataset_readiness.json",
    );
    await writeBlob(
      sessionDirectory,
      "manifest.json",
      jsonBlob({ ...input.manifestJson, artifacts }),
    );

    return {
      ok: true,
      value: { target: "folder" },
    };
  } catch {
    return {
      ok: false,
      error: "folder-save-failed",
      message:
        "Impossible d'écrire les métadonnées de session dans ce dossier.",
    };
  }
}

export async function saveDatasetPackageToWorkspaceFolder(input: {
  readonly getAudioBlob: (fileName: string) => Promise<Blob | undefined>;
  readonly jsonFiles: readonly {
    readonly path: string;
    readonly json: unknown;
  }[];
  readonly textFiles: readonly {
    readonly path: string;
    readonly text: string;
  }[];
  readonly audioFiles: readonly {
    readonly path: string;
    readonly sourceFileName: string;
  }[];
  readonly readme: string;
}): Promise<
  Result<
    {
      readonly target: "folder";
      readonly writtenFiles: number;
      readonly missingAudioFiles: readonly string[];
    },
    "folder-unavailable" | "folder-save-failed"
  >
> {
  const handle = await readDirectoryHandle();

  if (handle?.getDirectoryHandle === undefined) {
    return {
      ok: false,
      error: "folder-unavailable",
      message: "Aucun dossier local connecté pour écrire le dataset.",
    };
  }

  if (!(await requestReadWritePermission(handle))) {
    return {
      ok: false,
      error: "folder-unavailable",
      message: "Autorise l'écriture dans le dossier pour exporter le dataset.",
    };
  }

  try {
    const datasetDirectory = await ensureDirectory(handle, "dataset");
    let writtenFiles = 0;
    const missingAudioFiles: string[] = [];

    await writeBlob(datasetDirectory, "README.md", textBlob(input.readme));
    writtenFiles++;

    for (const file of input.jsonFiles) {
      await writeNestedBlob(datasetDirectory, file.path, jsonBlob(file.json));
      writtenFiles++;
    }

    for (const file of input.textFiles) {
      await writeNestedBlob(datasetDirectory, file.path, textBlob(file.text));
      writtenFiles++;
    }

    for (const file of input.audioFiles) {
      const blob = await input.getAudioBlob(file.sourceFileName);

      if (blob === undefined) {
        missingAudioFiles.push(file.sourceFileName);
        continue;
      }

      await writeNestedBlob(datasetDirectory, file.path, blob);
      writtenFiles++;
    }

    return {
      ok: true,
      value: {
        target: "folder",
        writtenFiles,
        missingAudioFiles: Array.from(new Set(missingAudioFiles)),
      },
    };
  } catch {
    return {
      ok: false,
      error: "folder-save-failed",
      message: "Impossible d'écrire le dataset dans ce dossier.",
    };
  }
}

export async function saveVoiceCapturePackageToWorkspaceFolder(input: {
  readonly files: readonly { readonly path: string; readonly data: Blob }[];
}): Promise<
  Result<
    { readonly target: "folder"; readonly writtenFiles: number },
    "folder-unavailable" | "folder-save-failed"
  >
> {
  const handle = await readDirectoryHandle();

  if (handle?.getDirectoryHandle === undefined) {
    return {
      ok: false,
      error: "folder-unavailable",
      message: "Aucun dossier local connecté pour écrire le package v1.",
    };
  }

  if (!(await requestReadWritePermission(handle))) {
    return {
      ok: false,
      error: "folder-unavailable",
      message:
        "Autorise l'écriture dans le dossier pour exporter le package v1.",
    };
  }

  try {
    const packageDirectory = await ensureDirectory(
      handle,
      "voice-capture-package",
    );
    await writeBlob(
      packageDirectory,
      "EXPORT_INCOMPLETE",
      textBlob(
        "Package creation started; absence of EXPORT_COMPLETE means incomplete.",
      ),
    );

    for (const entry of input.files) {
      assertSafePackagePath(entry.path);
      await writeNestedBlob(packageDirectory, entry.path, entry.data);
    }

    await writeBlob(
      packageDirectory,
      "EXPORT_COMPLETE",
      textBlob("voice.capture.package.v1 complete"),
    );
    await packageDirectory.removeEntry?.("EXPORT_INCOMPLETE");

    return {
      ok: true,
      value: { target: "folder", writtenFiles: input.files.length },
    };
  } catch {
    return {
      ok: false,
      error: "folder-save-failed",
      message: "Impossible d'écrire le package v1 dans ce dossier.",
    };
  }
}

async function writeNestedBlob(
  root: DirectoryHandle,
  path: string,
  blob: Blob,
): Promise<void> {
  const segments = path.split("/").map(sanitizePathSegment);
  const fileName = segments.pop();

  if (fileName === undefined) {
    throw new Error("Invalid dataset file path.");
  }

  let directory = root;

  for (const segment of segments) {
    directory = await ensureDirectory(directory, segment);
  }

  await writeBlob(directory, fileName, blob);
}

type VoiceCaptureSessionManifest = {
  readonly exportId: string;
  readonly format: "voice.capture_session";
  readonly formatVersion: string;
  readonly workspaceId: string;
  readonly corpusId: string;
  readonly createdAt: string;
  readonly consent: unknown;
  readonly provenance: unknown;
  readonly forgePipeline: readonly string[];
  readonly reports: readonly string[];
  readonly artifacts: readonly VoiceCaptureSessionArtifact[];
};

type VoiceCaptureSessionArtifact = {
  readonly path: string;
  readonly mediaType: string;
  readonly sha256: string;
};

type VoiceCaptureReportsJson = {
  readonly audioQuality: unknown;
  readonly transcriptAlignment: unknown;
  readonly phoneticCoverage: unknown;
  readonly intentBalance: unknown;
  readonly prosodyDistribution: unknown;
  readonly datasetReadiness: unknown;
};

export async function saveRecordingToBrowserStorage(
  fileName: string,
  audioBlob: Blob,
): Promise<void> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(
      RECORDINGS_STORE_NAME,
      "readwrite",
    );
    const store = transaction.objectStore(RECORDINGS_STORE_NAME);
    const existing = await requestResult<StoredRecording | undefined>(
      store.get(fileName),
    );
    if (existing !== undefined) {
      throw new Error(
        `Recording ${fileName} already exists and will not be replaced.`,
      );
    }
    store.put(
      {
        fileName,
        blob: audioBlob,
        savedAt: new Date().toISOString(),
      },
      fileName,
    );

    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function listBrowserRecordings(): Promise<
  readonly StoredRecording[]
> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(RECORDINGS_STORE_NAME, "readonly");
    const request = transaction.objectStore(RECORDINGS_STORE_NAME).getAll();
    const recordings = await requestResult<StoredRecording[]>(request);

    await transactionDone(transaction);

    return recordings.sort((left, right) =>
      right.savedAt.localeCompare(left.savedAt),
    );
  } finally {
    database.close();
  }
}

export async function getBrowserRecording(
  fileName: string,
): Promise<Blob | undefined> {
  let database: IDBDatabase;

  try {
    database = await openDatabase();
  } catch {
    return undefined;
  }

  try {
    const transaction = database.transaction(RECORDINGS_STORE_NAME, "readonly");
    const request = transaction
      .objectStore(RECORDINGS_STORE_NAME)
      .get(fileName);
    const recording = await requestResult<StoredRecording | undefined>(request);

    await transactionDone(transaction);

    return recording?.blob;
  } finally {
    database.close();
  }
}

export async function getWorkspaceRecording(
  fileName: string,
): Promise<Blob | undefined> {
  const browserRecording = await getBrowserRecording(fileName);

  if (browserRecording !== undefined) {
    return browserRecording;
  }

  const handle = await readDirectoryHandle();

  if (
    handle?.getDirectoryHandle === undefined ||
    handle.getFileHandle === undefined ||
    !(await requestPermission(handle, "read"))
  ) {
    return undefined;
  }

  try {
    const takesDirectory = await handle.getDirectoryHandle("takes");

    if (takesDirectory.getFileHandle === undefined) {
      return undefined;
    }

    const fileHandle = await takesDirectory.getFileHandle(fileName);

    return await fileHandle.getFile?.();
  } catch {
    return undefined;
  }
}

async function saveDirectoryHandle(handle: DirectoryHandle): Promise<void> {
  inMemoryDirectoryHandle = handle;
  let database: IDBDatabase;

  try {
    database = await openDatabase();
  } catch {
    return;
  }

  try {
    const transaction = database.transaction(FOLDER_STORE_NAME, "readwrite");
    transaction.objectStore(FOLDER_STORE_NAME).put(handle, HANDLE_KEY);

    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function ensureDirectory(
  parent: DirectoryHandle,
  name: string,
): Promise<DirectoryHandle> {
  if (parent.getDirectoryHandle === undefined) {
    throw new Error("Directory handles are not supported.");
  }

  return parent.getDirectoryHandle(name, { create: true });
}

async function writeBlob(
  directory: DirectoryHandle,
  fileName: string,
  blob: Blob,
): Promise<void> {
  if (directory.getFileHandle === undefined) {
    throw new Error("File handles are not supported.");
  }

  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();

  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
}

async function requestReadWritePermission(
  handle: DirectoryHandle,
): Promise<boolean> {
  return requestPermission(handle, "readwrite");
}

async function requestPermission(
  handle: DirectoryHandle,
  mode: "read" | "readwrite",
): Promise<boolean> {
  const descriptor = { mode };

  try {
    if (
      handle.queryPermission === undefined ||
      handle.requestPermission === undefined
    ) {
      return true;
    }

    if ((await handle.queryPermission(descriptor)) === "granted") {
      return true;
    }

    return (await handle.requestPermission(descriptor)) === "granted";
  } catch {
    return false;
  }
}

async function writeTrackedBlob(
  artifacts: VoiceCaptureSessionArtifact[],
  directory: DirectoryHandle,
  fileName: string,
  blob: Blob,
  path = fileName,
): Promise<void> {
  await writeBlob(directory, fileName, blob);
  artifacts.push({
    path,
    mediaType: blob.type || "application/octet-stream",
    sha256: await sha256Blob(blob),
  });
}

function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
}

function textBlob(value: string): Blob {
  return new Blob([value], { type: "text/plain;charset=utf-8" });
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function assertSafePackagePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    hasControlCharacter(path)
  ) {
    throw new Error(`Unsafe package path: ${path}`);
  }

  if (
    path
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe package path: ${path}`);
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

async function readDirectoryHandle(): Promise<DirectoryHandle | null> {
  if (inMemoryDirectoryHandle !== null) {
    return inMemoryDirectoryHandle;
  }

  let database: IDBDatabase;

  try {
    database = await openDatabase();
  } catch {
    return null;
  }

  try {
    const transaction = database.transaction(FOLDER_STORE_NAME, "readonly");
    const request = transaction.objectStore(FOLDER_STORE_NAME).get(HANDLE_KEY);
    const handle = await requestResult<DirectoryHandle | undefined>(request);

    await transactionDone(transaction);

    return handle ?? null;
  } finally {
    database.close();
  }
}

function rememberFolderName(folderName: string): void {
  try {
    window.localStorage.setItem(FOLDER_NAME_KEY, folderName);
  } catch {
    // Memory-only mode still works for the current tab.
  }
}
