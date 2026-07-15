import { segmentSpeechProbabilities } from "./speechSegments";
import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
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

let transcriberPromise: Promise<Transcriber> | null = null;
let vadPromise: Promise<{ ort: OrtModule; session: VadSession }> | null = null;

async function loadTranscriber(
  assetsBaseUrl: string,
  onProgress: (progressPercent: number) => void,
): Promise<Transcriber> {
  if (transcriberPromise === null) {
    transcriberPromise = (async () => {
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

      const modelId = "Xenova/whisper-tiny";
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
            device: "wasm",
            // ORT's N-bit QDQ transpose optimization currently rejects the
            // bundled Whisper q8 decoder graph. The unoptimized graph is valid
            // and deterministic; inference is post-capture, so correctness wins
            // over a speculative load-time rewrite.
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

      return transcriber as unknown as Transcriber;
    })();

    transcriberPromise.catch(() => {
      transcriberPromise = null;
    });
  }

  return transcriberPromise;
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
    const transcriber = await loadTranscriber(
      request.assetsBaseUrl,
      (progressPercent) =>
        post({
          id: request.id,
          kind: "progress",
          progress: { stage: "loading-model", progressPercent },
        }),
    );

    post({
      id: request.id,
      kind: "progress",
      progress: { stage: "transcribing" },
    });

    const transcription = await transcriber(request.audio, {
      language: request.language,
      task: "transcribe",
      // Smaller chunks bound peak memory on long files and constrained
      // browsers. The overlap remains inside the pipeline implementation.
      chunk_length_s: request.processingProfile === "compatible" ? 15 : 30,
      return_timestamps: "word",
    });
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

workerScope.addEventListener("message", (event) => {
  void analyze(event.data);
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
