import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { createBrowserWorkspaceRepository } from "../src/app/storage/browserWorkspaceRepository";
import {
  getBrowserRecording,
  saveRecordingToBrowserStorage,
  saveRecordingsToBrowserStorage,
} from "../src/app/storage/browserRecordingStorage";
import { canonicalCorpus } from "../src/domains/corpus";
import { initialSpeakers } from "../src/domains/speakers";
import { createEmptyWorkspace } from "../src/domains/workspace";

const STORAGE_KEY = "voice-capture-studio.workspace.v1";

function resetIndexedDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("voice-capture-studio");

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

test("workspace repository saves and reopens through IndexedDB", async () => {
  await resetIndexedDb();

  const localStorage = createLocalStorageStub();

  withWindow({ localStorage });

  const workspace = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-10T08:00:00.000Z"),
  });
  const saveResult = await createBrowserWorkspaceRepository().save(workspace);

  assert.equal(saveResult.ok, true);
  if (!saveResult.ok) {
    throw new Error(saveResult.message);
  }

  assert.equal(saveResult.value.durability, "persistent");
  assert.equal(
    localStorage.getItem(STORAGE_KEY),
    null,
    "IndexedDB saves must not write the workspace to localStorage",
  );

  const reopenedResult = await createBrowserWorkspaceRepository().open(
    workspace.workspaceId,
  );

  assert.equal(reopenedResult.ok, true);
  if (!reopenedResult.ok) {
    throw new Error(reopenedResult.message);
  }

  assert.equal(reopenedResult.value.durability, "persistent");
  assert.equal(
    reopenedResult.value.workspace.workspaceId,
    workspace.workspaceId,
  );
});

test("workspace repository migrates a legacy localStorage workspace to IndexedDB", async () => {
  await resetIndexedDb();

  const workspace = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-10T08:00:00.000Z"),
  });
  const localStorage = createLocalStorageStub({
    [STORAGE_KEY]: JSON.stringify(workspace),
  });

  withWindow({ localStorage });

  const openResult = await createBrowserWorkspaceRepository().open(
    workspace.workspaceId,
  );

  assert.equal(openResult.ok, true);
  if (!openResult.ok) {
    throw new Error(openResult.message);
  }

  assert.equal(openResult.value.durability, "persistent");
  assert.equal(openResult.value.workspace.workspaceId, workspace.workspaceId);

  // The migrated copy must now open from IndexedDB even if localStorage
  // becomes unavailable.
  withWindow({
    localStorage: {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    },
  });

  const migratedResult = await createBrowserWorkspaceRepository().open(
    workspace.workspaceId,
  );

  assert.equal(migratedResult.ok, true);
  if (!migratedResult.ok) {
    throw new Error(migratedResult.message);
  }

  assert.equal(migratedResult.value.durability, "persistent");
  assert.equal(
    migratedResult.value.workspace.workspaceId,
    workspace.workspaceId,
  );
});

test("recording archive import is atomic when a file name already exists", async () => {
  await resetIndexedDb();
  await saveRecordingToBrowserStorage("existing.wav", new Blob(["existing"]));

  await assert.rejects(() =>
    saveRecordingsToBrowserStorage([
      { fileName: "new.wav", blob: new Blob(["new"]) },
      { fileName: "existing.wav", blob: new Blob(["replacement"]) },
    ]),
  );

  assert.equal(await getBrowserRecording("new.wav"), undefined);
  assert.equal(
    await getBrowserRecording("existing.wav")?.then((blob) => blob?.text()),
    "existing",
  );
});

test("workspace archive restore commits workspace and WAVs together", async () => {
  await resetIndexedDb();
  const repository = createBrowserWorkspaceRepository();
  const workspace = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-11T08:00:00.000Z"),
  });
  const blob = new Blob(["restored WAV"]);

  const result = await repository.restoreArchive({
    workspace,
    recordings: [
      {
        fileName: "restored.wav",
        blob,
        sha256: "a".repeat(64),
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(
    await getBrowserRecording("restored.wav")?.then((value) => value?.text()),
    "restored WAV",
  );
  const reopened = await createBrowserWorkspaceRepository().open(
    workspace.workspaceId,
  );
  assert.equal(reopened.ok, true);
  if (reopened.ok) {
    assert.equal(reopened.value.workspace.workspaceId, workspace.workspaceId);
  }
});

test("workspace archive restore leaves both stores untouched on a name collision", async () => {
  await resetIndexedDb();
  await saveRecordingToBrowserStorage("existing.wav", new Blob(["existing"]));
  const repository = createBrowserWorkspaceRepository();
  const workspace = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-11T08:00:00.000Z"),
  });

  await assert.rejects(
    () =>
      repository.restoreArchive({
        workspace,
        recordings: [
          {
            fileName: "new.wav",
            blob: new Blob(["new"]),
            sha256: "b".repeat(64),
          },
          {
            fileName: "existing.wav",
            blob: new Blob(["replacement"]),
            sha256: "c".repeat(64),
          },
        ],
      }),
    /restauration annulée/,
  );

  assert.equal(await getBrowserRecording("new.wav"), undefined);
  assert.equal(
    await getBrowserRecording("existing.wav")?.then((value) => value?.text()),
    "existing",
  );
  const reopened = await createBrowserWorkspaceRepository().open(
    workspace.workspaceId,
  );
  assert.equal(reopened.ok, false);
});

function createLocalStorageStub(initialValues: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(initialValues));

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function withWindow(windowValue: unknown): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowValue,
  });
}
