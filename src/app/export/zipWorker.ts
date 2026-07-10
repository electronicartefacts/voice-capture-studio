import { createZipBlob, type ZipEntryInput } from "./zipWriter";

export type ZipWorkerRequest = {
  readonly id: number;
  readonly entries: readonly ZipEntryInput[];
};

export type ZipWorkerResponse =
  | { readonly id: number; readonly ok: true; readonly blob: Blob }
  | { readonly id: number; readonly ok: false; readonly message: string };

type WorkerScope = {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<ZipWorkerRequest>) => void,
  ) => void;
  postMessage: (message: ZipWorkerResponse) => void;
};

const workerScope = globalThis as unknown as WorkerScope;

workerScope.addEventListener("message", (event) => {
  const { id, entries } = event.data;

  void createZipBlob(entries)
    .then((blob) => workerScope.postMessage({ id, ok: true, blob }))
    .catch((error: unknown) =>
      workerScope.postMessage({
        id,
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "L'archive ZIP n'a pas pu être générée.",
      }),
    );
});
