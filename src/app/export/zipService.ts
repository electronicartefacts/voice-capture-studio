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
): Promise<Blob> {
  if (typeof Worker === "undefined") {
    return createZipBlob(entries);
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
    return await runZipWorker(worker, entries);
  } catch {
    return createZipBlob(entries);
  } finally {
    worker.terminate();
  }
}

function runZipWorker(
  worker: Worker,
  entries: readonly ZipEntryInput[],
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = nextRequestId;
    nextRequestId += 1;

    worker.addEventListener(
      "message",
      (event: MessageEvent<ZipWorkerResponse>) => {
        if (event.data.id !== id) {
          return;
        }

        if (event.data.ok) {
          resolve(event.data.blob);
        } else {
          reject(new Error(event.data.message));
        }
      },
    );
    worker.addEventListener("error", () => {
      reject(new Error("Le worker d'archive ZIP a échoué."));
    });

    const request: ZipWorkerRequest = { id, entries };

    worker.postMessage(request);
  });
}
