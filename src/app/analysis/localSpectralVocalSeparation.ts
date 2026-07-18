import type { SpectralVocalSeparationResult } from "./spectralVocalSeparation";

export async function separateVocalsOffThread(input: {
  readonly left: Float32Array;
  readonly right: Float32Array | null;
  readonly noiseReference?: Float32Array | null;
  readonly onProgress: (progressPercent: number) => void;
  readonly signal?: AbortSignal;
}): Promise<SpectralVocalSeparationResult> {
  throwIfAborted(input.signal);
  const worker = new Worker(
    new URL("./spectralVocalWorker.ts", import.meta.url),
    {
      type: "module",
    },
  );
  const left = input.left.slice();
  const right = input.right?.slice() ?? null;
  const noiseReference = input.noiseReference?.slice() ?? null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      worker.terminate();
      input.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = () => finish(() => reject(getAbortReason(input.signal)));

    worker.addEventListener("error", () =>
      finish(() =>
        reject(new Error("Le worker de séparation vocale a échoué.")),
      ),
    );
    worker.addEventListener("message", (event: MessageEvent) => {
      const message = event.data as
        | { readonly kind: "progress"; readonly progressPercent: number }
        | ({ readonly kind: "result" } & SpectralVocalSeparationResult)
        | { readonly kind: "error"; readonly message: string };

      if (message.kind === "progress") {
        input.onProgress(message.progressPercent);
      } else if (message.kind === "result") {
        finish(() =>
          resolve({
            signal: message.signal,
            centerEnergyRatio: message.centerEnergyRatio,
            residualEnergyRatio: message.residualEnergyRatio,
            noiseReferenceUsed: message.noiseReferenceUsed === true,
            noiseReferenceFrameCount: message.noiseReferenceFrameCount ?? 0,
          }),
        );
      } else {
        finish(() => reject(new Error(message.message)));
      }
    });

    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) {
      onAbort();
      return;
    }
    const transfer: Transferable[] = [left.buffer];
    if (right !== null) transfer.push(right.buffer);
    if (noiseReference !== null) transfer.push(noiseReference.buffer);
    worker.postMessage({ left, right, noiseReference }, transfer);
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw getAbortReason(signal);
}

function getAbortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Analyse locale annulée.", "AbortError");
}
