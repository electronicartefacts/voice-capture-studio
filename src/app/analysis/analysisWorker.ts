import { segmentSpeechProbabilities } from "./speechSegments";
import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
  LocalExecutionProvider,
  LocalTranscriptionModel,
  SpeechSegment,
} from "./types";
import { normalizeWhisperWordTimings } from "./whisperWordTimings";

const VAD_FRAME_SAMPLES = 512;
const VAD_SAMPLE_RATE = 16_000;
const VAD_FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;

type WorkerScope = {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<AnalysisWorkerRequest>) => void,
  ) => void;
  postMessage: (message: AnalysisWorkerResponse) => void;
};

type Transcription = {
  readonly text: string;
  readonly chunks?: readonly {
    readonly text: string;
    readonly timestamp: readonly (number | null)[];
  }[];
};

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<Transcription | Transcription[]>;
type DisposableTranscriber = Transcriber & {
  dispose?: () => Promise<void> | void;
};

type VadSession = {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run: (
    feeds: Record<string, unknown>,
  ) => Promise<Record<string, { data: ArrayLike<number> }>>;
};

type OrtModule = {
  env: {
    wasm: {
      wasmPaths: string | { readonly mjs: string; readonly wasm: string };
      numThreads?: number;
    };
  };
  InferenceSession: {
    create: (
      model: ArrayBuffer | Uint8Array,
      options?: Record<string, unknown>,
    ) => Promise<VadSession>;
  };
  Tensor: new (
    type: string,
    data: Float32Array | BigInt64Array,
    dims: readonly number[],
  ) => unknown;
};

const workerScope = globalThis as unknown as WorkerScope;

type LoadedTranscriber = {
  readonly transcriber: DisposableTranscriber;
  readonly provider: LocalExecutionProvider;
};

const transcriberPromises = new Map<string, Promise<LoadedTranscriber>>();
let vadPromise: Promise<{ ort: OrtModule; session: VadSession }> | null = null;
let analysisQueue = Promise.resolve();

async function loadTranscriber(
  assetsBaseUrl: string,
  transcriptionModel: LocalTranscriptionModel,
  onProgress: (progressPercent: number) => void,
  forceProvider?: LocalExecutionProvider,
): Promise<LoadedTranscriber> {
  const preferredProvider =
    forceProvider ??
    (transcriptionModel === "base" && webGpuAvailable() ? "webgpu" : "wasm");
  const cacheKey = `${transcriptionModel}:${preferredProvider}`;
  let transcriberPromise = transcriberPromises.get(cacheKey);

  if (transcriberPromise === undefined) {
    transcriberPromise = (async () => {
      await disposeOtherTranscribers(cacheKey);
      return createTranscriber(
        assetsBaseUrl,
        transcriptionModel,
        preferredProvider,
        onProgress,
      );
    })();
    transcriberPromises.set(cacheKey, transcriberPromise);

    transcriberPromise.catch(() => {
      transcriberPromises.delete(cacheKey);
    });
  }

  return transcriberPromise;
}

async function createTranscriber(
  assetsBaseUrl: string,
  transcriptionModel: LocalTranscriptionModel,
  provider: LocalExecutionProvider,
  onProgress: (progressPercent: number) => void,
): Promise<LoadedTranscriber> {
  const {
    env,
    AutoModelForSpeechSeq2Seq,
    AutomaticSpeechRecognitionPipeline,
    WhisperFeatureExtractor,
    WhisperProcessor,
    WhisperTokenizer,
  } = await import("@huggingface/transformers");

  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = true;
  env.localModelPath = `${assetsBaseUrl}models/`;

  if (env.backends.onnx?.wasm !== undefined) {
    env.backends.onnx.wasm.wasmPaths = createWasmPaths(assetsBaseUrl);
  }

  const fileProgress = new Map<string, { loaded: number; total: number }>();
  const reportProgress = () => {
    let loaded = 0;
    let total = 0;

    for (const file of fileProgress.values()) {
      loaded += file.loaded;
      total += file.total;
    }

    if (total > 0) {
      onProgress(Math.min(100, Math.round((loaded / total) * 100)));
    }
  };

  const modelId =
    transcriptionModel === "base"
      ? "Xenova/whisper-base"
      : "Xenova/whisper-tiny";
  const progress_callback = (event: {
    status: string;
    file?: string;
    loaded?: number;
    total?: number;
  }) => {
    if (
      event.status === "progress" &&
      event.file !== undefined &&
      event.total !== undefined
    ) {
      fileProgress.set(event.file, {
        loaded: event.loaded ?? 0,
        total: event.total,
      });
      reportProgress();
    }
  };
  const modelBaseUrl = `${assetsBaseUrl}models/${modelId}/`;
  const [model, tokenizerJson, tokenizerConfig, preprocessorConfig] =
    await Promise.all([
      AutoModelForSpeechSeq2Seq.from_pretrained(modelId, {
        dtype: "q8",
        device: provider,
        // The q8 decoder graph needs this setting on WASM. Keeping it for
        // WebGPU also makes provider fallback deterministic across engines.
        session_options: { graphOptimizationLevel: "disabled" },
        progress_callback,
      }),
      fetchJson(`${modelBaseUrl}tokenizer.json`),
      fetchJson(`${modelBaseUrl}tokenizer_config.json`),
      fetchJson(`${modelBaseUrl}preprocessor_config.json`),
    ]);
  const tokenizer = new WhisperTokenizer(tokenizerJson, tokenizerConfig);
  const featureExtractor = new WhisperFeatureExtractor(preprocessorConfig);
  const processor = new WhisperProcessor(
    {},
    { tokenizer, feature_extractor: featureExtractor },
    "",
  );
  const transcriber = new AutomaticSpeechRecognitionPipeline({
    task: "automatic-speech-recognition",
    model,
    processor,
    tokenizer,
  });

  return {
    transcriber: transcriber as unknown as DisposableTranscriber,
    provider,
  };
}

async function disposeOtherTranscribers(keep: string): Promise<void> {
  for (const [key, promise] of transcriberPromises) {
    if (key === keep) continue;

    transcriberPromises.delete(key);
    try {
      const { transcriber } = await promise;
      await transcriber.dispose?.();
    } catch {
      // A failed model load has no live session to release.
    }
  }
}

function webGpuAvailable(): boolean {
  return "gpu" in (globalThis.navigator ?? {});
}

async function loadVad(
  assetsBaseUrl: string,
): Promise<{ ort: OrtModule; session: VadSession }> {
  if (vadPromise === null) {
    vadPromise = (async () => {
      // Same ort build variant as transformers.js so both share one WASM
      // runtime download from public/ort/.
      const ort =
        (await import("onnxruntime-web/webgpu")) as unknown as OrtModule;

      ort.env.wasm.wasmPaths = createWasmPaths(assetsBaseUrl);

      const response = await fetch(
        `${assetsBaseUrl}models/silero/silero_vad.onnx`,
      );

      if (!response.ok) {
        throw new Error("Le modèle de détection de parole est indisponible.");
      }

      const session = await ort.InferenceSession.create(
        await response.arrayBuffer(),
        { executionProviders: ["wasm"] },
      );

      return { ort, session };
    })();

    vadPromise.catch(() => {
      vadPromise = null;
    });
  }

  return vadPromise;
}

async function detectSpeechSegments(
  assetsBaseUrl: string,
  audio: Float32Array,
): Promise<readonly SpeechSegment[]> {
  const { ort, session } = await loadVad(assetsBaseUrl);
  const frameCount = Math.floor(audio.length / VAD_FRAME_SAMPLES);
  const probabilities: number[] = [];
  let state = new Float32Array(2 * 1 * 128);
  const sampleRateTensor = new ort.Tensor(
    "int64",
    BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]),
    [1],
  );

  for (let frame = 0; frame < frameCount; frame += 1) {
    const chunk = audio.subarray(
      frame * VAD_FRAME_SAMPLES,
      (frame + 1) * VAD_FRAME_SAMPLES,
    );
    const feeds: Record<string, unknown> = {
      input: new ort.Tensor("float32", Float32Array.from(chunk), [
        1,
        VAD_FRAME_SAMPLES,
      ]),
      state: new ort.Tensor("float32", state, [2, 1, 128]),
      sr: sampleRateTensor,
    };
    const outputs = await session.run(feeds);
    const probability = Number(outputs.output?.data[0] ?? 0);
    const nextState = outputs.stateN?.data;

    if (nextState !== undefined) {
      state = Float32Array.from(nextState as ArrayLike<number>);
    }

    probabilities.push(probability);
  }

  return segmentSpeechProbabilities(probabilities, VAD_FRAME_MS);
}

async function analyze(request: AnalysisWorkerRequest): Promise<void> {
  const post = (message: AnalysisWorkerResponse) =>
    workerScope.postMessage(message);

  try {
    let loadedTranscriber: LoadedTranscriber;
    try {
      loadedTranscriber = await loadTranscriber(
        request.assetsBaseUrl,
        request.transcriptionModel,
        (progressPercent) =>
          post({
            id: request.id,
            kind: "progress",
            progress: { stage: "loading-model", progressPercent },
          }),
        request.executionPreference === "wasm" ? "wasm" : undefined,
      );
    } catch (error) {
      if (request.executionPreference === "auto" && webGpuAvailable()) {
        throw webGpuFallbackError(error);
      }
      throw error;
    }

    post({
      id: request.id,
      kind: "progress",
      progress: { stage: "transcribing" },
    });

    const transcriberOptions = {
      language: request.language,
      task: "transcribe",
      // Smaller chunks bound peak memory on long files and constrained
      // browsers. The overlap remains inside the pipeline implementation.
      chunk_length_s: request.processingProfile === "compatible" ? 15 : 30,
      stride_length_s: request.processingProfile === "compatible" ? 3 : 5,
      force_full_sequences: false,
      return_timestamps: "word",
      // A small beam improves ambiguous sung syllables without multiplying
      // browser work as aggressively as desktop ASR defaults (often 5 beams).
      // Compatible/mobile paths and the tiny scout remain greedy.
      ...(request.decodingStrategy === "beam"
        ? { num_beams: 2, early_stopping: true }
        : {}),
    };
    let transcription: Transcription | Transcription[];
    try {
      transcription = await loadedTranscriber.transcriber(
        request.audio,
        transcriberOptions,
      );
    } catch (error) {
      if (loadedTranscriber.provider !== "webgpu") throw error;
      throw webGpuFallbackError(error);
    }
    const result = Array.isArray(transcription)
      ? transcription[0]
      : transcription;
    const transcript = result.text.trim();
    const whisperWords = normalizeWhisperWordTimings(
      result.chunks ?? [],
      (request.audio.length / request.sampleRate) * 1000,
    );

    post({
      id: request.id,
      kind: "progress",
      progress: { stage: "detecting-speech" },
    });

    const speechSegments = await detectSpeechSegments(
      request.assetsBaseUrl,
      request.audio,
    );

    post({
      id: request.id,
      kind: "result",
      transcript,
      speechSegments,
      whisperWords,
      executionProvider: loadedTranscriber.provider,
    });
  } catch (error) {
    post({
      id: request.id,
      kind: "error",
      message:
        error instanceof Error
          ? error.message
          : "L'analyse locale a échoué dans le worker.",
    });
  }
}

function webGpuFallbackError(error: unknown): Error {
  const detail =
    error instanceof Error ? error.message : "backend indisponible";
  return new Error(`WEBGPU_RETRY_WASM:${detail}`);
}

workerScope.addEventListener("message", (event) => {
  analysisQueue = analysisQueue.then(
    () => analyze(event.data),
    () => analyze(event.data),
  );
});

function createWasmPaths(assetsBaseUrl: string): {
  readonly mjs: string;
  readonly wasm: string;
} {
  return {
    mjs: `${assetsBaseUrl}ort/ort-wasm-simd-threaded.mjs`,
    wasm: `${assetsBaseUrl}ort/ort-wasm-simd-threaded.wasm`,
  };
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Local model asset is unavailable: ${url}`);
  }

  return (await response.json()) as Record<string, unknown>;
}
