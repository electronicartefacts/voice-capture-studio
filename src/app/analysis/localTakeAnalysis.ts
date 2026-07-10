import { alignTranscriptToPrompt, tokenizeSpeech } from "../shell/speech";
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

export function isLocalAnalysisSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof OfflineAudioContext !== "undefined"
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
  const worker = getAnalysisWorker();
  const id = nextRequestId;

  nextRequestId += 1;

  const { transcript, speechSegments } = await new Promise<
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
  const totalDurationMs = (audio.length / ANALYSIS_SAMPLE_RATE) * 1000;

  return {
    transcript,
    matchedWordCount: alignTranscriptToPrompt([...expectedWords], transcript),
    expectedWordCount: expectedWords.length,
    speechSegments,
    segmentSummary: summarizeSpeechSegments(speechSegments, totalDurationMs),
  };
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
  const decodeContext = new AudioContext();

  try {
    const decoded = await decodeContext.decodeAudioData(
      await blob.arrayBuffer(),
    );
    const frameCount = Math.max(
      1,
      Math.ceil(decoded.duration * ANALYSIS_SAMPLE_RATE),
    );
    const offlineContext = new OfflineAudioContext(
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
