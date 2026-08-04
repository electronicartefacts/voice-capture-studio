import assert from "node:assert/strict";
import test from "node:test";
import {
  beginMarkedAtomicExport,
  completeMarkedAtomicExport,
  writeBlobAtomically,
} from "../src/app/storage/atomicFileWriter";
import type { WritableFileDirectory } from "../src/app/storage/atomicFileWriter";

test("atomic file writing commits only after the complete blob is written", async () => {
  const events: string[] = [];
  const blob = new Blob(["complete"]);
  const directory = createDirectory({
    abort: async () => events.push("abort"),
    close: async () => events.push("close"),
    write: async (data) => {
      assert.equal(data, blob);
      events.push("write");
    },
  });

  await writeBlobAtomically(directory, "take.wav", blob);

  assert.deepEqual(events, ["write", "close"]);
});

test("atomic file writing aborts the temporary destination when writing fails", async () => {
  const writeError = new Error("disk full");
  let abortCount = 0;
  let closeCount = 0;
  const directory = createDirectory({
    abort: async () => {
      abortCount += 1;
    },
    close: async () => {
      closeCount += 1;
    },
    write: async () => {
      throw writeError;
    },
  });

  await assert.rejects(
    writeBlobAtomically(directory, "take.wav", new Blob(["partial"])),
    writeError,
  );
  assert.equal(abortCount, 1);
  assert.equal(closeCount, 0);
});

test("cancelling an active file write aborts it and reports AbortError", async () => {
  const abortController = new AbortController();
  let rejectWrite: ((error: Error) => void) | null = null;
  let markWriteStarted: (() => void) | null = null;
  const writeStarted = new Promise<void>((resolve) => {
    markWriteStarted = resolve;
  });
  const directory = createDirectory({
    abort: async () => {
      rejectWrite?.(new Error("temporary write discarded"));
    },
    close: async () => undefined,
    write: async () => {
      markWriteStarted?.();
      await new Promise<never>((_resolve, reject) => {
        rejectWrite = reject;
      });
    },
  });
  const pendingWrite = writeBlobAtomically(
    directory,
    "take.wav",
    new Blob(["large recording"]),
    abortController.signal,
  );

  await writeStarted;
  abortController.abort(new DOMException("Export annulé.", "AbortError"));

  await assert.rejects(
    pendingWrite,
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});

test("marked exports replace stale completion only after the incomplete marker commits", async () => {
  const files = new Set(["EXPORT_COMPLETE"]);
  const events: string[] = [];
  const directory: WritableFileDirectory = {
    getFileHandle: async (name) => ({
      createWritable: async () => ({
        write: async () => events.push(`write:${name}`),
        close: async () => {
          files.add(name);
          events.push(`close:${name}`);
        },
      }),
    }),
    removeEntry: async (name) => {
      if (!files.delete(name)) {
        throw new DOMException(`${name} missing`, "NotFoundError");
      }
      events.push(`remove:${name}`);
    },
  };

  await beginMarkedAtomicExport(directory);
  assert.deepEqual([...files], ["EXPORT_INCOMPLETE"]);
  assert.deepEqual(events, [
    "write:EXPORT_INCOMPLETE",
    "close:EXPORT_INCOMPLETE",
    "remove:EXPORT_COMPLETE",
  ]);

  await completeMarkedAtomicExport(directory);
  assert.deepEqual([...files], ["EXPORT_COMPLETE"]);
  assert.deepEqual(events.slice(-3), [
    "write:EXPORT_COMPLETE",
    "close:EXPORT_COMPLETE",
    "remove:EXPORT_INCOMPLETE",
  ]);
});

function createDirectory(writable: {
  readonly abort?: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly write: (data: Blob) => Promise<void>;
}): WritableFileDirectory {
  return {
    getFileHandle: async (name, options) => {
      assert.equal(name, "take.wav");
      assert.deepEqual(options, { create: true });
      return { createWritable: async () => writable };
    },
  };
}
