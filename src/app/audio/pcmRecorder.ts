import {
  PCM_TARGET_SAMPLE_RATE,
  PcmSampleBuffer,
  analyzePcmSamples,
  encodeWav24,
  resampleBandLimited,
  type PcmRecordingMetrics,
} from "./pcmAudio";
import type { AudioCaptureProvenance } from "@domains/sessions";
import { FREE_CAPTURE_MAX_DURATION_MS } from "../recording/captureLimits";

export type { PcmRecordingMetrics } from "./pcmAudio";

export type PcmRecordingResult = {
  readonly blob: Blob;
  readonly extension: "wav";
  readonly mimeType: "audio/wav";
  readonly metrics: PcmRecordingMetrics;
  readonly truncated: boolean;
  readonly capture: AudioCaptureProvenance;
};

export type PcmRecorder = {
  readonly stop: () => Promise<PcmRecordingResult>;
};
export type PcmRecorderOptions = {
  readonly onLevel?: (level: number) => void;
  readonly onSamples?: (samples: Float32Array) => void;
  /** Defaults to a bounded two-minute directed take. */
  readonly maxDurationMs?: number;
};

type WindowWithAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type CapturePipeline = {
  readonly node: AudioNode;
  readonly flush: () => Promise<void>;
  readonly dispose: () => void;
};

const WORKLET_PROCESSOR_NAME = "voice-capture-pcm-recorder";
const WORKLET_BATCH_SIZE = 1024;
const CAPTURE_FLUSH_TIMEOUT_MS = 500;
const DEFAULT_MAX_CAPTURE_DURATION_MS = 120_000;

// The worklet batches four 128-frame render quanta before crossing back to the
// main thread. This keeps capture off the UI thread without increasing the
// callback cadence relative to the legacy ScriptProcessor implementation.
const PCM_CAPTURE_WORKLET_SOURCE = `
class VoiceCapturePcmRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.batchSize = options.processorOptions.batchSize;
    this.batch = new Float32Array(this.batchSize);
    this.batchLength = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];

    if (input === undefined) {
      return true;
    }

    let offset = 0;

    while (offset < input.length) {
      const writable = Math.min(
        this.batchSize - this.batchLength,
        input.length - offset,
      );
      this.batch.set(input.subarray(offset, offset + writable), this.batchLength);
      this.batchLength += writable;
      offset += writable;

      if (this.batchLength === this.batchSize) {
        this.flush();
      }
    }

    return true;
  }

  flush() {
    if (this.batchLength === 0) {
      return;
    }

    const samples = this.batch.slice(0, this.batchLength);
    this.port.postMessage({ type: "samples", samples }, [samples.buffer]);
    this.batchLength = 0;
  }
}

registerProcessor("${WORKLET_PROCESSOR_NAME}", VoiceCapturePcmRecorder);
`;

export async function createPcmRecorder(
  stream: MediaStream,
  options: PcmRecorderOptions = {},
): Promise<PcmRecorder> {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as WindowWithAudioContext).webkitAudioContext;

  if (AudioContextConstructor === undefined) {
    throw new Error("AudioContext is not available in this browser.");
  }

  const audioContext = createCompatibleAudioContext(AudioContextConstructor);
  const captureSettings = readCaptureProvenance(
    stream,
    audioContext.sampleRate,
  );
  const maxDurationMs = normalizeCaptureDuration(options.maxDurationMs);
  const sampleBuffer = new PcmSampleBuffer({
    maxSamples: Math.ceil((maxDurationMs / 1000) * audioContext.sampleRate),
  });
  let stopPromise: Promise<PcmRecordingResult> | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let capture: CapturePipeline | null = null;
  let silentOutput: GainNode | null = null;

  try {
    source = audioContext.createMediaStreamSource(stream);
    capture = await createCapturePipeline(audioContext, sampleBuffer, options);
    silentOutput = audioContext.createGain();

    silentOutput.gain.value = 0;
    source.connect(capture.node);
    capture.node.connect(silentOutput);
    silentOutput.connect(audioContext.destination);

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
  } catch (error) {
    capture?.dispose();
    disconnectAudioNode(capture?.node ?? null);
    disconnectAudioNode(silentOutput);
    disconnectAudioNode(source);
    await closeAudioContext(audioContext);
    throw error;
  }

  return {
    async stop() {
      stopPromise ??= (async () => {
        const sourceSampleRate = audioContext.sampleRate;
        const activeCapture = capture;
        const activeSilentOutput = silentOutput;
        const activeSource = source;

        try {
          await flushWithTimeout(activeCapture?.flush);
        } finally {
          activeCapture?.dispose();
          disconnectAudioNode(activeCapture?.node ?? null);
          disconnectAudioNode(activeSilentOutput);
          disconnectAudioNode(activeSource);
          capture = null;
          silentOutput = null;
          source = null;
          await closeAudioContext(audioContext);
        }

        const truncated = sampleBuffer.limitReached;
        const sourceSamples = sampleBuffer.consume();
        const samples =
          sourceSampleRate === PCM_TARGET_SAMPLE_RATE
            ? sourceSamples
            : resampleBandLimited(
                sourceSamples,
                sourceSampleRate,
                PCM_TARGET_SAMPLE_RATE,
              );
        const metrics = analyzePcmSamples(samples, PCM_TARGET_SAMPLE_RATE);

        return {
          blob: encodeWav24(samples, PCM_TARGET_SAMPLE_RATE),
          extension: "wav",
          mimeType: "audio/wav",
          metrics,
          truncated,
          capture: {
            ...captureSettings,
            resampledToTarget: sourceSampleRate !== PCM_TARGET_SAMPLE_RATE,
          },
        };
      })();

      return stopPromise;
    },
  };
}

function readCaptureProvenance(
  stream: MediaStream,
  sourceSampleRateHz: number,
): AudioCaptureProvenance {
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings();

  return {
    schemaVersion: "voice.capture_provenance.v1",
    captureApi: "MediaStream",
    capturedChannelCount: numberOrNull(settings?.channelCount),
    capturedSampleRateHz: numberOrNull(settings?.sampleRate),
    deviceGroupId: nonEmptyStringOrNull(settings?.groupId),
    deviceId: nonEmptyStringOrNull(settings?.deviceId),
    deviceLabel: nonEmptyStringOrNull(track?.label),
    requestedFormat: {
      bitDepth: 24,
      channels: 1,
      sampleRateHz: PCM_TARGET_SAMPLE_RATE,
    },
    processing: {
      autoGainControl: booleanOrNull(settings?.autoGainControl),
      echoCancellation: booleanOrNull(settings?.echoCancellation),
      noiseSuppression: booleanOrNull(settings?.noiseSuppression),
    },
    sourceSampleRateHz,
    targetSampleRateHz: PCM_TARGET_SAMPLE_RATE,
    resampledToTarget: sourceSampleRateHz !== PCM_TARGET_SAMPLE_RATE,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function nonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

async function createCapturePipeline(
  audioContext: AudioContext,
  sampleBuffer: PcmSampleBuffer,
  options: PcmRecorderOptions,
): Promise<CapturePipeline> {
  const appendSamples = (samples: Float32Array) => {
    sampleBuffer.append(samples);
    options.onLevel?.(computeLevel(samples));
    options.onSamples?.(samples);
  };

  if (
    audioContext.audioWorklet !== undefined &&
    typeof AudioWorkletNode !== "undefined"
  ) {
    try {
      return await createAudioWorkletCapturePipeline(
        audioContext,
        appendSamples,
      );
    } catch {
      // Safari and embedded web views can expose AudioWorklet but reject a
      // dynamically loaded module. Keep recording available via the legacy
      // node instead of failing the user's capture session.
    }
  }

  return createScriptProcessorCapturePipeline(audioContext, appendSamples);
}

async function createAudioWorkletCapturePipeline(
  audioContext: AudioContext,
  appendSamples: (samples: Float32Array) => void,
): Promise<CapturePipeline> {
  const moduleUrl = URL.createObjectURL(
    new Blob([PCM_CAPTURE_WORKLET_SOURCE], { type: "text/javascript" }),
  );

  try {
    await audioContext.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }

  const node = new AudioWorkletNode(audioContext, WORKLET_PROCESSOR_NAME, {
    channelCount: 1,
    channelCountMode: "explicit",
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { batchSize: WORKLET_BATCH_SIZE },
  });
  let disposed = false;
  let resolveFlush: (() => void) | null = null;

  node.port.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data;

    if (isSampleMessage(message)) {
      appendSamples(message.samples);
      return;
    }

    if (isFlushedMessage(message)) {
      resolveFlush?.();
      resolveFlush = null;
    }
  };

  return {
    node,
    flush: () => {
      if (disposed) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        resolveFlush = resolve;
        node.port.postMessage({ type: "flush" });
      });
    },
    dispose: () => {
      disposed = true;
      resolveFlush?.();
      resolveFlush = null;
      node.port.onmessage = null;
    },
  };
}

function createScriptProcessorCapturePipeline(
  audioContext: AudioContext,
  appendSamples: (samples: Float32Array) => void,
): CapturePipeline {
  const node = audioContext.createScriptProcessor(WORKLET_BATCH_SIZE, 1, 1);

  node.onaudioprocess = (event) => {
    appendSamples(event.inputBuffer.getChannelData(0));
  };

  return {
    node,
    flush: () => Promise.resolve(),
    dispose: () => {
      node.onaudioprocess = null;
    },
  };
}

function isSampleMessage(
  value: unknown,
): value is { readonly type: "samples"; readonly samples: Float32Array } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "samples" &&
    "samples" in value &&
    value.samples instanceof Float32Array
  );
}

function isFlushedMessage(
  value: unknown,
): value is { readonly type: "flushed" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "flushed"
  );
}

function createCompatibleAudioContext(
  AudioContextConstructor: typeof AudioContext,
): AudioContext {
  try {
    return new AudioContextConstructor({
      latencyHint: "interactive",
      sampleRate: PCM_TARGET_SAMPLE_RATE,
    });
  } catch {
    return new AudioContextConstructor();
  }
}

function disconnectAudioNode(node: AudioNode | null): void {
  try {
    node?.disconnect();
  } catch {
    // Browser implementations can throw if a node is already disconnected.
  }
}

async function closeAudioContext(audioContext: AudioContext): Promise<void> {
  try {
    if (audioContext.state !== "closed") {
      await audioContext.close();
    }
  } catch {
    // A failed close should not discard an otherwise valid recording.
  }
}

async function flushWithTimeout(
  flush: (() => Promise<void>) | undefined,
): Promise<void> {
  if (flush === undefined) {
    return;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      flush(),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, CAPTURE_FLUSH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function computeLevel(samples: Float32Array): number {
  let sumSquares = 0;
  let peak = 0;

  for (const rawSample of samples) {
    const sample = Number.isFinite(rawSample) ? rawSample : 0;

    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / Math.max(samples.length, 1));
  const rmsDbfs = 20 * Math.log10(Math.max(rms, 0.000001));
  const peakDbfs = 20 * Math.log10(Math.max(peak, 0.000001));
  const rmsMeter = (rmsDbfs + 60) / 45;
  const peakMeter = (peakDbfs + 36) / 36;

  return clamp(Math.max(rmsMeter, peakMeter * 0.78), 0, 1);
}

function normalizeCaptureDuration(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_CAPTURE_DURATION_MS;
  }

  return Math.min(value, FREE_CAPTURE_MAX_DURATION_MS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
