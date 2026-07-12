import { alignTranscriptToPrompt, tokenizeSpeech } from "../shell/speech";
import { alignPromptToPhonemes } from "../../domains/phonetics/textPhonemeAlignment";
import type { LanguageCode } from "../../shared";
import { summarizeSpeechSegments } from "./speechSegments";
import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
  LocalAnalysisProgress,
  LocalTakeAnalysis,
} from "./types";

const ANALYSIS_SAMPLE_RATE = 16_000;

let sharedWorker: Worker | null = null;
let nextRequestId = 1;

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
 * Transcribes a finished take with whisper-tiny and measures speech bounds
 * with Silero VAD, entirely on-device. Model weights are served from this
 * origin (`public/models/`), so no third-party request ever leaves the app.
 */
export async function analyzeTakeAudio(input: {
  readonly audioBlob: Blob;
  readonly expectedText: string;
  readonly language: string;
  readonly onProgress: (progress: LocalAnalysisProgress) => void;
}): Promise<LocalTakeAnalysis> {
  const audio = await decodeToMono16k(input.audioBlob);
  // `postMessage` transfers the backing buffer to the worker below. Keep the
  // duration while this side still owns the samples, otherwise the detached
  // typed array reports a zero length after inference completes.
  const totalDurationMs = getAnalysisDurationMs(audio);
  const worker = getAnalysisWorker();
  const id = nextRequestId;

  nextRequestId += 1;

  const { transcript, speechSegments, whisperWords } = await new Promise<
    Extract<AnalysisWorkerResponse, { kind: "result" }>
  >((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    const onMessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
      if (event.data.id !== id) {
        return;
      }

      if (event.data.kind === "progress") {
        input.onProgress(event.data.progress);
        return;
      }

      cleanup();

      if (event.data.kind === "result") {
        resolve(event.data);
      } else {
        reject(new Error(event.data.message));
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error("Le worker d'analyse locale a échoué."));
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError, { once: true });

    const request: AnalysisWorkerRequest = {
      id,
      audio,
      sampleRate: ANALYSIS_SAMPLE_RATE,
      language: input.language,
      assetsBaseUrl: getAssetsBaseUrl(),
    };

    worker.postMessage(request, [audio.buffer]);
  });

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
    alignmentComparison: compareLocalWordAlignments({
      estimatedWords: estimatedAlignment.words,
      whisperWords,
    }),
    segmentSummary: summarizeSpeechSegments(speechSegments, totalDurationMs),
  };
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

function getAssetsBaseUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
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
    const offlineContext = new OfflineAudioContextConstructor(
      1,
      frameCount,
      ANALYSIS_SAMPLE_RATE,
    );
    const source = offlineContext.createBufferSource();

    source.buffer = decoded;
    source.connect(offlineContext.destination);
    source.start();

    const rendered = await offlineContext.startRendering();

    return rendered.getChannelData(0).slice();
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
