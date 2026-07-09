import {
  PCM_TARGET_SAMPLE_RATE,
  PcmSampleBuffer,
  analyzePcmSamples,
  encodeWav24,
  resampleLinear,
  type PcmRecordingMetrics,
} from "./pcmAudio";

export type { PcmRecordingMetrics } from "./pcmAudio";

export type PcmRecordingResult = {
  readonly blob: Blob;
  readonly extension: "wav";
  readonly mimeType: "audio/wav";
  readonly metrics: PcmRecordingMetrics;
};

export type PcmRecorder = {
  readonly stop: () => Promise<PcmRecordingResult>;
};
export type PcmRecorderOptions = {
  readonly onLevel?: (level: number) => void;
  readonly onSamples?: (samples: Float32Array) => void;
  readonly maxDurationMs?: number;
};

type WindowWithAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

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
  const sampleBuffer = new PcmSampleBuffer({
    maxSamples:
      options.maxDurationMs === undefined
        ? undefined
        : Math.ceil((options.maxDurationMs / 1000) * PCM_TARGET_SAMPLE_RATE),
  });
  let stopPromise: Promise<PcmRecordingResult> | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let silentOutput: GainNode | null = null;

  try {
    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(1024, 1, 1);
    silentOutput = audioContext.createGain();

    silentOutput.gain.value = 0;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      sampleBuffer.append(input);
      options.onLevel?.(computeLevel(input));
      options.onSamples?.(input);
    };

    source.connect(processor);
    processor.connect(silentOutput);
    silentOutput.connect(audioContext.destination);

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
  } catch (error) {
    disconnectAudioNode(processor);
    disconnectAudioNode(silentOutput);
    disconnectAudioNode(source);
    await closeAudioContext(audioContext);
    throw error;
  }

  return {
    async stop() {
      stopPromise ??= (async () => {
        const sourceSampleRate = audioContext.sampleRate;

        if (processor !== null) {
          processor.onaudioprocess = null;
        }

        disconnectAudioNode(processor);
        disconnectAudioNode(silentOutput);
        disconnectAudioNode(source);
        processor = null;
        silentOutput = null;
        source = null;
        await closeAudioContext(audioContext);

        const sourceSamples = sampleBuffer.consume();
        const samples =
          sourceSampleRate === PCM_TARGET_SAMPLE_RATE
            ? sourceSamples
            : resampleLinear(
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
        };
      })();

      return stopPromise;
    },
  };
}

function createCompatibleAudioContext(
  AudioContextConstructor: typeof AudioContext,
): AudioContext {
  try {
    return new AudioContextConstructor({
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

function computeLevel(samples: Float32Array): number {
  let sumSquares = 0;
  let peak = 0;

  for (const rawSample of samples) {
    const sample = Number.isFinite(rawSample) ? rawSample : 0;

    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / Math.max(samples.length, 1));

  return clamp(Math.max(rms * 10, peak * 2.2), 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
