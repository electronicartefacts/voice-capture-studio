import { createZipBlob, type ZipEntryInput } from "./zipWriter";
import type { ZipWorkerRequest, ZipWorkerResponse } from "./zipWorker";

let nextRequestId = 1;

/**
 * Builds the ZIP in a Web Worker so CRC32 over large WAV payloads never
 * blocks the UI. Environments without module worker support (or where the
 * worker fails to boot) fall back to the inline implementation.
 */
export async function createZipBlobOffThread(
  entries: readonly ZipEntryInput[],
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfZipAborted(signal);

  if (typeof Worker === "undefined") {
    const archive = createZipBlob(entries);
    throwIfZipAborted(signal);
    return archive;
  }

  let worker: Worker;

  try {
    worker = new Worker(new URL("./zipWorker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return createZipBlob(entries);
  }

  try {
    return await runZipWorker(worker, entries, signal);
  } catch (error) {
    if (isZipAbort(error) || signal?.aborted) throw getZipAbortReason(signal);
    const archive = createZipBlob(entries);
    throwIfZipAborted(signal);
    return archive;
  } finally {
    worker.terminate();
  }
}

function runZipWorker(
  worker: Worker,
  entries: readonly ZipEntryInput[],
  signal?: AbortSignal,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = nextRequestId;
    nextRequestId += 1;

    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onMessage = (event: MessageEvent<ZipWorkerResponse>) => {
      if (event.data.id !== id) {
        return;
      }

      cleanup();

      if (event.data.ok) {
        resolve(event.data.blob);
      } else {
        reject(new Error(event.data.message));
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error("Le worker d'archive ZIP a échoué."));
    };
    const onAbort = () => {
      cleanup();
      reject(getZipAbortReason(signal));
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });

    if (signal?.aborted) {
      onAbort();
      return;
    }

    const request: ZipWorkerRequest = { id, entries };

    worker.postMessage(request);
  });
}

function throwIfZipAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw getZipAbortReason(signal);
}

function getZipAbortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Création de l'archive annulée.", "AbortError");
}

function isZipAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
