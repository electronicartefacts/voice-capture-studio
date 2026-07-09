export type PcmRecordingMetrics = {
  readonly durationMs: number;
  readonly sampleRateHz: number;
  readonly bitDepth: 24;
  readonly channels: 1;
  readonly peakDbfs: number;
  readonly integratedLufs: number;
  readonly noiseFloorDbfs: number;
  readonly snrDb: number;
  readonly clippingDetected: boolean;
  readonly reverbScore: number;
  readonly plosiveScore: number;
  readonly mouthNoiseScore: number;
};

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
};

const TARGET_SAMPLE_RATE = 48_000;
const TARGET_BIT_DEPTH = 24;

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

  const audioContext = new AudioContextConstructor({
    sampleRate: TARGET_SAMPLE_RATE,
  });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(1024, 1, 1);
  const silentOutput = audioContext.createGain();
  const chunks: Float32Array[] = [];
  let stopPromise: Promise<PcmRecordingResult> | null = null;

  silentOutput.gain.value = 0;
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    options.onLevel?.(computeLevel(input));
  };

  source.connect(processor);
  processor.connect(silentOutput);
  silentOutput.connect(audioContext.destination);

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return {
    async stop() {
      stopPromise ??= (async () => {
        const sourceSampleRate = audioContext.sampleRate;

        processor.disconnect();
        silentOutput.disconnect();
        source.disconnect();
        processor.onaudioprocess = null;
        await audioContext.close();

        const sourceSamples = concatenate(chunks);
        const samples =
          sourceSampleRate === TARGET_SAMPLE_RATE
            ? sourceSamples
            : resampleLinear(
                sourceSamples,
                sourceSampleRate,
                TARGET_SAMPLE_RATE,
              );
        const metrics = analyzeSamples(samples);

        return {
          blob: encodeWav24(samples, TARGET_SAMPLE_RATE),
          extension: "wav",
          mimeType: "audio/wav",
          metrics,
        };
      })();

      return stopPromise;
    },
  };
}

function computeLevel(samples: Float32Array): number {
  let sumSquares = 0;
  let peak = 0;

  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / Math.max(samples.length, 1));

  return clamp(Math.max(rms * 10, peak * 2.2), 0, 1);
}

function concatenate(chunks: readonly Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function resampleLinear(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (samples.length === 0 || sourceSampleRate === targetSampleRate) {
    return samples;
  }

  const targetLength = Math.max(
    1,
    Math.round(samples.length * (targetSampleRate / sourceSampleRate)),
  );
  const output = new Float32Array(targetLength);
  const ratio = (samples.length - 1) / Math.max(targetLength - 1, 1);

  for (let index = 0; index < targetLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const fraction = sourceIndex - leftIndex;

    output[index] =
      samples[leftIndex] * (1 - fraction) + samples[rightIndex] * fraction;
  }

  return output;
}

function analyzeSamples(samples: Float32Array): PcmRecordingMetrics {
  const durationMs = Math.round((samples.length / TARGET_SAMPLE_RATE) * 1000);
  let peak = 0;
  let sumSquares = 0;
  let clippedSamples = 0;
  let plosiveSamples = 0;
  let highDelta = 0;
  let previous = 0;

  for (const sample of samples) {
    const abs = Math.abs(sample);
    peak = Math.max(peak, abs);
    sumSquares += sample * sample;

    if (abs >= 0.999) {
      clippedSamples += 1;
    }

    if (abs >= 0.82) {
      plosiveSamples += 1;
    }

    if (Math.abs(sample - previous) >= 0.2) {
      highDelta += 1;
    }

    previous = sample;
  }

  const rms = Math.sqrt(sumSquares / Math.max(samples.length, 1));
  const frameRmsDbfs = computeFrameRmsDbfs(samples);
  const noiseFloorDbfs = percentile(frameRmsDbfs, 0.1) ?? -96;
  const peakDbfs = amplitudeToDbfs(peak);
  const rmsDbfs = amplitudeToDbfs(rms);
  const integratedLufs = clamp(round(rmsDbfs - 0.691, 1), -96, 0);
  const snrDb = clamp(round(rmsDbfs - noiseFloorDbfs, 1), 0, 96);
  const clippingDetected =
    clippedSamples > Math.max(2, samples.length * 0.00005);
  const tailScore = computeTailScore(samples);

  return {
    durationMs,
    sampleRateHz: TARGET_SAMPLE_RATE,
    bitDepth: TARGET_BIT_DEPTH,
    channels: 1,
    peakDbfs,
    integratedLufs,
    noiseFloorDbfs,
    snrDb,
    clippingDetected,
    reverbScore: tailScore,
    plosiveScore: clamp(
      round(plosiveSamples / Math.max(samples.length, 1), 3),
      0,
      1,
    ),
    mouthNoiseScore: clamp(
      round(highDelta / Math.max(samples.length, 1), 3),
      0,
      1,
    ),
  };
}

function computeFrameRmsDbfs(samples: Float32Array): number[] {
  const frameSize = 2048;
  const values: number[] = [];

  for (let offset = 0; offset < samples.length; offset += frameSize) {
    let sumSquares = 0;
    const end = Math.min(offset + frameSize, samples.length);

    for (let index = offset; index < end; index += 1) {
      sumSquares += samples[index] * samples[index];
    }

    values.push(
      amplitudeToDbfs(Math.sqrt(sumSquares / Math.max(end - offset, 1))),
    );
  }

  return values;
}

function computeTailScore(samples: Float32Array): number {
  if (samples.length < TARGET_SAMPLE_RATE) {
    return 0;
  }

  const tail = samples.slice(
    Math.max(0, samples.length - Math.round(TARGET_SAMPLE_RATE * 0.35)),
  );
  let sumSquares = 0;

  for (const sample of tail) {
    sumSquares += sample * sample;
  }

  return clamp(round(Math.sqrt(sumSquares / tail.length) / 0.08, 2), 0, 1);
}

function encodeWav24(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 3;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;

  writeAscii(view, offset, "RIFF");
  offset += 4;
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeAscii(view, offset, "WAVE");
  offset += 4;
  writeAscii(view, offset, "fmt ");
  offset += 4;
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * bytesPerSample, true);
  offset += 4;
  view.setUint16(offset, bytesPerSample, true);
  offset += 2;
  view.setUint16(offset, TARGET_BIT_DEPTH, true);
  offset += 2;
  writeAscii(view, offset, "data");
  offset += 4;
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (const sample of samples) {
    const clampedSample = clamp(sample, -1, 1);
    const intSample = Math.round(clampedSample * 0x7fffff);

    view.setUint8(offset, intSample & 0xff);
    view.setUint8(offset + 1, (intSample >> 8) & 0xff);
    view.setUint8(offset + 2, (intSample >> 16) & 0xff);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function amplitudeToDbfs(value: number): number {
  return round(20 * Math.log10(Math.max(value, 0.000015849)), 1);
}

function percentile(
  values: readonly number[],
  fraction: number,
): number | null {
  if (values.length === 0) {
    return null;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor(sortedValues.length * fraction)),
  );

  return round(sortedValues[index], 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
