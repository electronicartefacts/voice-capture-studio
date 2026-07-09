import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserWorkspaceRepository } from "../src/app/storage/browserWorkspaceRepository";
import { canonicalCorpus } from "../src/domains/corpus";
import { initialSpeakers } from "../src/domains/speakers";
import { createEmptyWorkspace } from "../src/domains/workspace";

test("browser workspace repository reports persistent durability when localStorage accepts writes", async () => {
  withWindow({
    localStorage: createLocalStorageStub(),
  });

  const workspace = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-09T08:00:00.000Z"),
  });
  const repository = createBrowserWorkspaceRepository();
  const saveResult = await repository.save(workspace);

  assert.equal(saveResult.ok, true);
  if (!saveResult.ok) {
    throw new Error(saveResult.message);
  }

  assert.equal(saveResult.value.durability, "persistent");
  assert.equal(saveResult.value.workspace.workspaceId, workspace.workspaceId);

  const sameInstanceOpenResult = await repository.open(workspace.workspaceId);

  assert.equal(sameInstanceOpenResult.ok, true);
  if (!sameInstanceOpenResult.ok) {
    throw new Error(sameInstanceOpenResult.message);
  }

  assert.equal(sameInstanceOpenResult.value.durability, "persistent");

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

test("browser workspace repository refuses future workspace schemas", async () => {
  const localStorage = createLocalStorageStub({
    "voice-capture-studio.workspace.v1": JSON.stringify({
      schemaVersion: 999,
      workspaceId: "workspace.local.main",
    }),
  });

  withWindow({ localStorage });

  const repository = createBrowserWorkspaceRepository();
  const result = await repository.open(
    "workspace.local.main" as Parameters<typeof repository.open>[0],
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("future workspace schema should not open");
  }

  assert.equal(result.error, "workspace-unsupported-schema");
  assert.match(result.message, /plus récent que le format pris en charge/);
});

test("browser workspace repository reports memory-only durability when localStorage rejects writes", async () => {
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

  const workspace = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-09T08:00:00.000Z"),
  });
  const repository = createBrowserWorkspaceRepository();
  const saveResult = await repository.save(workspace);

  assert.equal(saveResult.ok, true);
  if (!saveResult.ok) {
    throw new Error(saveResult.message);
  }

  assert.equal(saveResult.value.durability, "memory-only");

  const reopenedResult = await repository.open(workspace.workspaceId);

  assert.equal(reopenedResult.ok, true);
  if (!reopenedResult.ok) {
    throw new Error(reopenedResult.message);
  }

  assert.equal(reopenedResult.value.durability, "memory-only");
  assert.equal(
    reopenedResult.value.workspace.workspaceId,
    workspace.workspaceId,
  );
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
