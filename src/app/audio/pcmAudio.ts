export const PCM_TARGET_SAMPLE_RATE = 48_000;
export const PCM_TARGET_BIT_DEPTH = 24;
const MIN_DBFS = -96;

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

export class PcmSampleBuffer {
  private samples: Float32Array;
  private usedLength = 0;

  constructor(
    options: {
      readonly initialCapacity?: number;
      readonly maxSamples?: number;
    } = {},
  ) {
    const initialCapacity = normalizeCapacity(options.initialCapacity ?? 0);

    this.samples = new Float32Array(initialCapacity);
    this.maxSamples = normalizeMaxSamples(options.maxSamples);
  }

  private readonly maxSamples: number;

  get sampleCount(): number {
    return this.usedLength;
  }

  append(samples: Float32Array): void {
    if (samples.length === 0 || this.usedLength >= this.maxSamples) {
      return;
    }

    const writableLength = Math.min(
      samples.length,
      this.maxSamples - this.usedLength,
    );

    this.ensureCapacity(this.usedLength + writableLength);
    this.samples.set(samples.subarray(0, writableLength), this.usedLength);
    this.usedLength += writableLength;
  }

  consume(): Float32Array {
    const output = this.samples.slice(0, this.usedLength);

    this.clear();

    return output;
  }

  clear(): void {
    this.samples = new Float32Array(0);
    this.usedLength = 0;
  }

  private ensureCapacity(requiredLength: number): void {
    if (requiredLength <= this.samples.length) {
      return;
    }

    let nextCapacity = Math.max(4096, this.samples.length);

    while (nextCapacity < requiredLength) {
      nextCapacity *= 2;
    }

    nextCapacity = Math.min(nextCapacity, this.maxSamples);

    if (nextCapacity < requiredLength) {
      nextCapacity = requiredLength;
    }

    const nextSamples = new Float32Array(nextCapacity);
    nextSamples.set(this.samples.subarray(0, this.usedLength));
    this.samples = nextSamples;
  }
}

export function resampleLinear(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (
    samples.length === 0 ||
    sourceSampleRate === targetSampleRate ||
    !isPositiveFiniteNumber(sourceSampleRate) ||
    !isPositiveFiniteNumber(targetSampleRate)
  ) {
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
    const leftSample = normalizeSample(samples[leftIndex]);
    const rightSample = normalizeSample(samples[rightIndex]);

    output[index] = leftSample * (1 - fraction) + rightSample * fraction;
  }

  return output;
}

export function analyzePcmSamples(
  samples: Float32Array,
  sampleRate = PCM_TARGET_SAMPLE_RATE,
): PcmRecordingMetrics {
  const normalizedSampleRate = normalizeSampleRate(sampleRate);
  const durationMs = Math.round((samples.length / normalizedSampleRate) * 1000);
  let peak = 0;
  let sumSquares = 0;
  let clippedSamples = 0;
  let plosiveSamples = 0;
  let highDelta = 0;
  let previous = 0;

  for (const rawSample of samples) {
    const sample = normalizeSample(rawSample);
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
  const noiseFloorDbfs = percentile(frameRmsDbfs, 0.1) ?? MIN_DBFS;
  const peakDbfs = amplitudeToDbfs(peak);
  const rmsDbfs = amplitudeToDbfs(rms);
  const integratedLufs = clamp(round(rmsDbfs - 0.691, 1), MIN_DBFS, 0);
  const snrDb = clamp(round(rmsDbfs - noiseFloorDbfs, 1), 0, 96);
  const clippingDetected =
    clippedSamples > Math.max(2, samples.length * 0.00005);
  const tailScore = computeTailScore(samples, normalizedSampleRate);

  return {
    durationMs,
    sampleRateHz: normalizedSampleRate,
    bitDepth: PCM_TARGET_BIT_DEPTH,
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

export function encodeWav24(
  samples: Float32Array,
  sampleRate = PCM_TARGET_SAMPLE_RATE,
): Blob {
  const normalizedSampleRate = normalizeSampleRate(sampleRate);
  const bytesPerSample = 3;
  const dataSize = samples.length * bytesPerSample;

  if (dataSize > 0xffffffff - 36) {
    throw new Error("WAV payload is too large for a RIFF container.");
  }

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
  view.setUint32(offset, normalizedSampleRate, true);
  offset += 4;
  view.setUint32(offset, normalizedSampleRate * bytesPerSample, true);
  offset += 4;
  view.setUint16(offset, bytesPerSample, true);
  offset += 2;
  view.setUint16(offset, PCM_TARGET_BIT_DEPTH, true);
  offset += 2;
  writeAscii(view, offset, "data");
  offset += 4;
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (const sample of samples) {
    const intSample = floatToSignedInt24(sample);
    const unsignedSample = intSample < 0 ? intSample + 0x1000000 : intSample;

    view.setUint8(offset, unsignedSample & 0xff);
    view.setUint8(offset + 1, (unsignedSample >> 8) & 0xff);
    view.setUint8(offset + 2, (unsignedSample >> 16) & 0xff);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function computeFrameRmsDbfs(samples: Float32Array): number[] {
  const frameSize = 2048;
  const values: number[] = [];

  for (let offset = 0; offset < samples.length; offset += frameSize) {
    let sumSquares = 0;
    const end = Math.min(offset + frameSize, samples.length);

    for (let index = offset; index < end; index += 1) {
      const sample = normalizeSample(samples[index]);
      sumSquares += sample * sample;
    }

    values.push(
      amplitudeToDbfs(Math.sqrt(sumSquares / Math.max(end - offset, 1))),
    );
  }

  return values;
}

function computeTailScore(samples: Float32Array, sampleRate: number): number {
  if (samples.length < sampleRate) {
    return 0;
  }

  const tailStart = Math.max(0, samples.length - Math.round(sampleRate * 0.35));
  let sumSquares = 0;

  for (let index = tailStart; index < samples.length; index += 1) {
    const sample = normalizeSample(samples[index]);
    sumSquares += sample * sample;
  }

  return clamp(
    round(Math.sqrt(sumSquares / (samples.length - tailStart)) / 0.08, 2),
    0,
    1,
  );
}

function floatToSignedInt24(value: number): number {
  const sample = clamp(normalizeSample(value), -1, 1);

  if (sample < 0) {
    return Math.round(sample * 0x800000);
  }

  return Math.round(sample * 0x7fffff);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function amplitudeToDbfs(value: number): number {
  return round(
    20 * Math.log10(Math.max(Math.abs(normalizeSample(value)), 0.000015849)),
    1,
  );
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

function normalizeSample(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalizeSampleRate(value: number): number {
  return isPositiveFiniteNumber(value)
    ? Math.round(value)
    : PCM_TARGET_SAMPLE_RATE;
}

function normalizeCapacity(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

function normalizeMaxSamples(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.floor(value);
}

function isPositiveFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
