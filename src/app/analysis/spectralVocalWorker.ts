import { separateVocalsSpectrally } from "./spectralVocalSeparation";

type Request = {
  readonly left: Float32Array;
  readonly right: Float32Array | null;
  readonly noiseReference: Float32Array | null;
};

type WorkerScope = {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<Request>) => void,
  ) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const workerScope = globalThis as unknown as WorkerScope;

workerScope.addEventListener("message", (event) => {
  try {
    const result = separateVocalsSpectrally({
      left: event.data.left,
      right: event.data.right,
      noiseReference: event.data.noiseReference,
      onProgress: (progressPercent) =>
        workerScope.postMessage({ kind: "progress", progressPercent }),
    });

    workerScope.postMessage({ kind: "result", ...result }, [
      result.signal.buffer,
    ]);
  } catch (error) {
    workerScope.postMessage({
      kind: "error",
      message:
        error instanceof Error
          ? error.message
          : "La séparation vocale locale a échoué.",
    });
  }
});
