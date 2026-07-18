import { alignTranscriptToPrompt, tokenizeSpeech } from "../shell/speech";
import { alignPromptToPhonemes } from "../../domains/phonetics/textPhonemeAlignment";
import type { LanguageCode } from "../../shared";
import { summarizeSpeechSegments } from "./speechSegments";
import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
  LocalExecutionPreference,
  LocalDecodingStrategy,
  LocalProcessingProfile,
  LocalAnalysisProgress,
  LocalTakeAnalysis,
  LocalTranscriptionModel,
} from "./types";
import { createStereoVocalFocusSignal } from "./vocalFocus";
import {
  classifyCaptureAcousticScene,
  runAdaptiveTakeAnalysis,
  selectTakeAnalysisHypothesis,
  type CaptureAnalysisContext,
} from "./adaptiveAnalysis";
import { separateVocalsOffThread } from "./localSpectralVocalSeparation";
import {
  readRuntimePerformanceProfile,
  recordRuntimePerformanceObservation,
  selectCapturedAnalysisBudget,
  type CapturedAnalysisBudget,
} from "./runtimePerformanceProfile";

const ANALYSIS_SAMPLE_RATE = 16_000;

let sharedWorker: Worker | null = null;
let nextRequestId = 1;
let webGpuTranscriptionDisabled = false;
const pendingAnalysisRequests = new Map<number, (reason: Error) => void>();

type WindowWithAudioConstructors = Window & {
  webkitAudioContext?: typeof AudioContext;
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
};

export function isLocalAnalysisSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    getAudioContextConstructor() !== null &&
    getOfflineAudioContextConstructor() !== null
  );
}

/**
 * Transcribes a finished take with an adaptive Whisper Tiny/Base strategy and
 * measures speech bounds with Silero VAD, entirely on-device. Model weights
 * are served from this origin (`public/models/`), so no third-party request
 * ever leaves the app.
 */
export async function analyzeTakeAudio(input: {
  readonly audioBlob: Blob;
  readonly roomToneBlob?: Blob;
  readonly expectedText: string;
  readonly language: string;
  readonly context?: CaptureAnalysisContext;
  readonly onProgress: (progress: LocalAnalysisProgress) => void;
  readonly signal?: AbortSignal;
}): Promise<LocalTakeAnalysis> {
  throwIfAnalysisAborted(input.signal);
  const signals = await decodeAudioToVocalSignals16k(input.audioBlob);
  const noiseReference =
    input.roomToneBlob === undefined
      ? null
      : await decodeAudioToMono16k(input.roomToneBlob).catch(() => null);
  const durationMs = getAnalysisDurationMs(signals.mono);
  const existingPerformanceProfile = readRuntimePerformanceProfile();
  const measuredTranscriptionFactors: number[] = [];
  const analyzeMeasured = async (analysisInput: {
    readonly audio: Float32Array;
    readonly model: LocalTranscriptionModel;
    readonly decoding: LocalDecodingStrategy;
  }) => {
    let inferenceStartedAt: number | null = null;
    const result = await analyzeDecodedAudio({
      audio: analysisInput.audio,
      expectedText: input.expectedText,
      language: input.language,
      transcriptionModel: analysisInput.model,
      decodingStrategy: analysisInput.decoding,
      onProgress: (progress) => {
        if (progress.stage === "transcribing" && inferenceStartedAt === null) {
          inferenceStartedAt = performance.now();
        }
        input.onProgress(progress);
      },
      signal: input.signal,
    });
    if (inferenceStartedAt !== null && durationMs > 0) {
      const elapsedMs = performance.now() - inferenceStartedAt;
      const factor = elapsedMs / durationMs;
      measuredTranscriptionFactors.push(factor);
      recordRuntimePerformanceObservation({
        kind: "transcription",
        elapsedMs,
        sourceDurationMs: durationMs,
      });
    }
    return result;
  };
  throwIfAnalysisAborted(input.signal);
  const original = await runAdaptiveTakeAnalysis({
    audio: signals.mono,
    context: input.context,
    onProgress: input.onProgress,
    analyze: ({ audio, model, decoding }) =>
      analyzeMeasured({ audio, model, decoding }),
  });
  const budget = selectCapturedAnalysisBudget({
    scene: classifyCaptureAcousticScene(input.context),
    durationMs,
    observedTranscriptionRealtimeFactor:
      measuredTranscriptionFactors.length === 0
        ? null
        : Math.max(...measuredTranscriptionFactors),
    profile: existingPerformanceProfile,
  });
  return runCapturedVocalEnsemble({
    signals,
    original,
    context: input.context,
    budget,
    onProgress: input.onProgress,
    analyze: (audio) =>
      analyzeMeasured({ audio, model: "base", decoding: "greedy" }),
    separate: async () => {
      const startedAt = performance.now();
      const result = await separateVocalsOffThread({
        ...signals.spectralInput!,
        noiseReference,
        onProgress: (progressPercent) =>
          input.onProgress({ stage: "separating-vocals", progressPercent }),
        signal: input.signal,
      });
      recordRuntimePerformanceObservation({
        kind: "separation",
        elapsedMs: performance.now() - startedAt,
        sourceDurationMs: durationMs,
      });
      return result.signal;
    },
  });
}

export async function runCapturedVocalEnsemble(input: {
  readonly signals: Awaited<ReturnType<typeof decodeAudioToVocalSignals16k>>;
  readonly original: LocalTakeAnalysis;
  readonly context?: CaptureAnalysisContext;
  readonly budget?: CapturedAnalysisBudget;
  readonly onProgress: (progress: LocalAnalysisProgress) => void;
  readonly analyze: (audio: Float32Array) => Promise<LocalTakeAnalysis>;
  readonly separate: () => Promise<Float32Array>;
}): Promise<LocalTakeAnalysis> {
  const scene = classifyCaptureAcousticScene(input.context);
  const budget =
    input.budget ??
    selectCapturedAnalysisBudget({
      scene,
      durationMs: getAnalysisDurationMs(input.signals.mono),
    });
  const needsVocalEnsemble =
    scene !== "clean_voice" &&
    budget.allowVocalFocus &&
    input.signals.vocalFocus.length <= ANALYSIS_SAMPLE_RATE * 5 * 60;

  if (!needsVocalEnsemble) return withRuntimeBudget(input.original, budget);

  input.onProgress({ stage: "enhancing-vocals" });
  const vocalFocusAnalysis = await input.analyze(input.signals.vocalFocus);
  const hypotheses: Array<{
    readonly model: LocalTranscriptionModel;
    readonly decoding: LocalDecodingStrategy;
    readonly analysis: LocalTakeAnalysis;
  }> = [
    {
      model: input.original.strategy?.selectedModel ?? "tiny",
      decoding:
        input.original.strategy?.selectedModel === "base" ? "beam" : "greedy",
      analysis: input.original,
    },
    { model: "base", decoding: "greedy", analysis: vocalFocusAnalysis },
  ];

  if (
    input.signals.spectralInput !== null &&
    budget.allowSpectralSeparation &&
    (scene === "sung_voice" || (input.context?.snrDb ?? 99) < 16)
  ) {
    input.onProgress({ stage: "separating-vocals", progressPercent: 0 });
    const spectralAnalysis = await input.analyze(await input.separate());
    hypotheses.push({
      model: "base",
      decoding: "greedy",
      analysis: spectralAnalysis,
    });
  }

  input.onProgress({ stage: "validating-result" });
  const selection = selectTakeAnalysisHypothesis(hypotheses);
  return {
    ...selection.selected.analysis,
    strategy: {
      schemaVersion: "voice.adaptive_analysis.v1",
      scene,
      depth: hypotheses.length >= 3 ? "deep" : "verified",
      selectedModel: selection.selected.model,
      selectionReason: selection.selectionReason,
      hypotheses: hypotheses.map((hypothesis, index) => ({
        model: hypothesis.model,
        provider: hypothesis.analysis.executionProvider,
        decoding: hypothesis.decoding,
        transcript: hypothesis.analysis.transcript,
        wordCount: hypothesis.analysis.whisperWords.length,
        matchedWordCount: hypothesis.analysis.matchedWordCount,
        score: selection.scores[index],
      })),
      runtime: runtimeStrategy(budget),
    },
  };
}

function withRuntimeBudget(
  analysis: LocalTakeAnalysis,
  budget: CapturedAnalysisBudget,
): LocalTakeAnalysis {
  if (analysis.strategy === undefined) return analysis;
  return {
    ...analysis,
    strategy: {
      ...analysis.strategy,
      runtime: runtimeStrategy(budget),
    },
  };
}

function runtimeStrategy(budget: CapturedAnalysisBudget) {
  return {
    runtimeClass: budget.runtimeClass,
    observedTranscriptionRealtimeFactor:
      budget.observedTranscriptionRealtimeFactor,
    storedTranscriptionRealtimeFactor: budget.storedTranscriptionRealtimeFactor,
    hypothesisBudget: budget.maximumHypotheses,
    reasons: budget.reasons,
  } as const;
}

export async function analyzeDecodedAudio(input: {
  readonly audio: Float32Array;
  readonly expectedText: string;
  readonly language: string;
  readonly processingProfile?: LocalProcessingProfile;
  readonly transcriptionModel?: LocalTranscriptionModel;
  readonly decodingStrategy?: LocalDecodingStrategy;
  readonly executionPreference?: LocalExecutionPreference;
  readonly onProgress: (progress: LocalAnalysisProgress) => void;
  readonly signal?: AbortSignal;
}): Promise<LocalTakeAnalysis> {
  throwIfAnalysisAborted(input.signal);
  const audio = input.audio;
  // `postMessage` transfers the backing buffer to the worker below. Keep the
  // duration while this side still owns the samples, otherwise the detached
  // typed array reports a zero length after inference completes.
  const totalDurationMs = getAnalysisDurationMs(audio);
  const worker = getAnalysisWorker();
  const id = nextRequestId;
  const transcriptionModel = input.transcriptionModel ?? "tiny";
  const executionPreference =
    input.executionPreference ??
    (webGpuTranscriptionDisabled ? "wasm" : "auto");
  const wasmFallbackAudio =
    transcriptionModel === "base" &&
    executionPreference === "auto" &&
    "gpu" in navigator
      ? audio.slice()
      : null;

  nextRequestId += 1;

  let workerResult: Extract<AnalysisWorkerResponse, { kind: "result" }>;
  try {
    workerResult = await new Promise<
      Extract<AnalysisWorkerResponse, { kind: "result" }>
    >((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        input.signal?.removeEventListener("abort", onAbort);
        pendingAnalysisRequests.delete(id);
      };
      const fail = (reason: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(reason);
      };
      const onMessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
        if (event.data.id !== id) {
          return;
        }

        if (event.data.kind === "progress") {
          input.onProgress(event.data.progress);
          return;
        }

        settled = true;
        cleanup();

        if (event.data.kind === "result") {
          resolve(event.data);
        } else {
          reject(new Error(event.data.message));
        }
      };

      const onError = () => {
        terminateLocalAnalysisWorker(
          new Error("Le worker d'analyse locale a échoué."),
          worker,
        );
      };
      const onAbort = () =>
        terminateLocalAnalysisWorker(
          getAnalysisAbortReason(input.signal),
          worker,
        );

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError, { once: true });
      input.signal?.addEventListener("abort", onAbort, { once: true });
      pendingAnalysisRequests.set(id, fail);

      if (input.signal?.aborted) {
        onAbort();
        return;
      }

      const request: AnalysisWorkerRequest = {
        id,
        audio,
        sampleRate: ANALYSIS_SAMPLE_RATE,
        language: input.language,
        processingProfile: input.processingProfile ?? "balanced",
        transcriptionModel,
        decodingStrategy: input.decodingStrategy ?? "greedy",
        executionPreference,
        assetsBaseUrl: getAssetsBaseUrl(),
      };

      worker.postMessage(request, [audio.buffer]);
    });
  } catch (error) {
    if (
      wasmFallbackAudio !== null &&
      error instanceof Error &&
      error.message.startsWith("WEBGPU_RETRY_WASM:")
    ) {
      webGpuTranscriptionDisabled = true;
      terminateLocalAnalysisWorker(error, worker);
      return analyzeDecodedAudio({
        ...input,
        audio: wasmFallbackAudio,
        executionPreference: "wasm",
      });
    }
    throw error;
  }
  const { transcript, speechSegments, whisperWords, executionProvider } =
    workerResult;

  const expectedWords = tokenizeSpeech(input.expectedText);
  const estimatedAlignment = alignPromptToPhonemes({
    activitySegments: speechSegments,
    durationMs: totalDurationMs,
    language: input.language as LanguageCode,
    text: input.expectedText,
  });
  const { compareLocalWordAlignments } =
    await import("./localAlignmentComparison");

  return {
    transcript,
    matchedWordCount: alignTranscriptToPrompt([...expectedWords], transcript),
    expectedWordCount: expectedWords.length,
    speechSegments,
    whisperWords,
    executionProvider,
    alignmentComparison: compareLocalWordAlignments({
      estimatedWords: estimatedAlignment.words,
      whisperWords,
    }),
    segmentSummary: summarizeSpeechSegments(speechSegments, totalDurationMs),
  };
}

export function cancelLocalAnalysis(): void {
  terminateLocalAnalysisWorker(createAnalysisAbortError());
}

export function isLocalAnalysisAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function getAnalysisDurationMs(audio: Float32Array): number {
  return (audio.length / ANALYSIS_SAMPLE_RATE) * 1000;
}

function getAnalysisWorker(): Worker {
  if (sharedWorker === null) {
    // The worker stays alive between takes so whisper only loads once per tab.
    sharedWorker = new Worker(new URL("./analysisWorker.ts", import.meta.url), {
      type: "module",
    });
  }

  return sharedWorker;
}

function terminateLocalAnalysisWorker(reason: Error, worker = sharedWorker) {
  if (worker === null || sharedWorker !== worker) return;

  sharedWorker = null;
  worker.terminate();
  const cancellations = [...pendingAnalysisRequests.values()];
  pendingAnalysisRequests.clear();

  for (const cancel of cancellations) cancel(reason);
}

function throwIfAnalysisAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw getAnalysisAbortReason(signal);
}

function getAnalysisAbortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : createAnalysisAbortError();
}

function createAnalysisAbortError(): DOMException {
  return new DOMException("Analyse locale annulée.", "AbortError");
}

function getAssetsBaseUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

export async function decodeAudioToMono16k(blob: Blob): Promise<Float32Array> {
  const signals = await decodeAudioSignals16k(blob, false);
  return signals.mono;
}

export async function decodeAudioToVocalSignals16k(blob: Blob): Promise<{
  readonly mono: Float32Array;
  readonly vocalFocus: Float32Array;
  readonly stereoCenterUsed: boolean;
  readonly spectralInput: {
    readonly left: Float32Array;
    readonly right: Float32Array | null;
  } | null;
}> {
  return decodeAudioSignals16k(blob, true);
}

async function decodeAudioSignals16k(
  blob: Blob,
  includeVocalFocus: boolean,
): Promise<{
  readonly mono: Float32Array;
  readonly vocalFocus: Float32Array;
  readonly stereoCenterUsed: boolean;
  readonly spectralInput: {
    readonly left: Float32Array;
    readonly right: Float32Array | null;
  } | null;
}> {
  const AudioContextConstructor = getAudioContextConstructor();
  const OfflineAudioContextConstructor = getOfflineAudioContextConstructor();

  if (
    AudioContextConstructor === null ||
    OfflineAudioContextConstructor === null
  ) {
    throw new Error(
      "L'analyse audio locale n'est pas disponible dans ce navigateur.",
    );
  }

  const decodeContext = new AudioContextConstructor();

  try {
    const decoded = await decodeContext.decodeAudioData(
      await blob.arrayBuffer(),
    );
    const frameCount = Math.max(
      1,
      Math.ceil(decoded.duration * ANALYSIS_SAMPLE_RATE),
    );
    const renderedChannelCount = includeVocalFocus
      ? Math.min(2, decoded.numberOfChannels)
      : 1;
    const offlineContext = new OfflineAudioContextConstructor(
      renderedChannelCount,
      frameCount,
      ANALYSIS_SAMPLE_RATE,
    );
    const source = offlineContext.createBufferSource();

    source.buffer = decoded;
    source.connect(offlineContext.destination);
    source.start();

    const rendered = await offlineContext.startRendering();

    const left = rendered.getChannelData(0);
    const right =
      rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : null;
    const mono = new Float32Array(rendered.length);

    for (let index = 0; index < mono.length; index += 1) {
      mono[index] =
        right === null ? left[index] : (left[index] + right[index]) * 0.5;
    }

    if (!includeVocalFocus) {
      return {
        mono,
        vocalFocus: mono,
        stereoCenterUsed: false,
        spectralInput: null,
      };
    }

    const focused = createStereoVocalFocusSignal(left, right);
    return {
      mono,
      vocalFocus: focused.signal,
      stereoCenterUsed: focused.stereoCenterUsed,
      spectralInput:
        rendered.duration <= 5 * 60
          ? {
              left: Float32Array.from(left),
              right: right === null ? null : Float32Array.from(right),
            }
          : null,
    };
  } finally {
    if (decodeContext.state !== "closed") {
      await decodeContext.close().catch(() => undefined);
    }
  }
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof AudioContext !== "undefined") {
    return AudioContext;
  }

  return typeof window !== "undefined"
    ? ((window as WindowWithAudioConstructors).webkitAudioContext ?? null)
    : null;
}

function getOfflineAudioContextConstructor():
  typeof OfflineAudioContext | null {
  if (typeof OfflineAudioContext !== "undefined") {
    return OfflineAudioContext;
  }

  return typeof window !== "undefined"
    ? ((window as WindowWithAudioConstructors).webkitOfflineAudioContext ??
        null)
    : null;
}
