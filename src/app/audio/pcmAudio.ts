export const PCM_TARGET_SAMPLE_RATE = 48_000;
export const PCM_TARGET_BIT_DEPTH = 24;
const MIN_DBFS = -96;

export type PcmRecordingMetrics = {
  readonly schemaVersion: "voice.audio_metrics.v1";
  readonly durationMs: number;
  readonly sampleRateHz: number;
  readonly bitDepth: 24;
  readonly channels: 1;
  readonly sampleCount: number;
  readonly peakDbfs: number;
  readonly estimatedTruePeakDbfs: number;
  readonly rmsDbfs: number;
  readonly integratedLufs: number;
  readonly noiseFloorDbfs: number;
  readonly snrDb: number;
  readonly crestFactorDb: number;
  readonly dcOffset: number;
  readonly clippingDetected: boolean;
  readonly clippingSampleCount: number;
  readonly clippingRate: number;
  readonly activeSpeechRatio: number;
  readonly silenceRatio: number;
  readonly voicedFrameRatio: number;
  readonly meanPitchHz: number | null;
  readonly pitchRangeSemitones: number | null;
  readonly pitchVariationSemitones: number | null;
  readonly energyVariationDb: number;
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

/**
 * Resamples mono PCM with a short-windowed sinc low-pass filter. Linear
 * interpolation is useful for previews, but it aliases when browser input is
 * converted between common rates. Persisted recordings use this path.
 */
export function resampleBandLimited(
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
  const sourcePerTargetSample = sourceSampleRate / targetSampleRate;
  const cutoff = Math.min(1, targetSampleRate / sourceSampleRate) * 0.94;
  const radius = 16;

  for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
    const sourcePosition = targetIndex * sourcePerTargetSample;
    const firstIndex = Math.ceil(sourcePosition - radius);
    const lastIndex = Math.floor(sourcePosition + radius);
    let weightedSum = 0;
    let weightTotal = 0;

    for (
      let sourceIndex = firstIndex;
      sourceIndex <= lastIndex;
      sourceIndex += 1
    ) {
      if (sourceIndex < 0 || sourceIndex >= samples.length) {
        continue;
      }

      const distance = sourceIndex - sourcePosition;
      const windowPosition = Math.abs(distance) / radius;

      if (windowPosition >= 1) {
        continue;
      }

      const scaledDistance = distance * cutoff;
      const sinc =
        Math.abs(scaledDistance) < 0.0000001
          ? 1
          : Math.sin(Math.PI * scaledDistance) / (Math.PI * scaledDistance);
      const window = 0.5 + 0.5 * Math.cos(Math.PI * windowPosition);
      const weight = sinc * window * cutoff;

      weightedSum += normalizeSample(samples[sourceIndex]) * weight;
      weightTotal += weight;
    }

    const fallbackIndex = Math.min(
      samples.length - 1,
      Math.max(0, Math.round(sourcePosition)),
    );
    output[targetIndex] =
      Math.abs(weightTotal) < 0.0000001
        ? normalizeSample(samples[fallbackIndex] ?? 0)
        : weightedSum / weightTotal;
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
  let sum = 0;
  let clippedSamples = 0;
  let plosiveSamples = 0;
  let highDelta = 0;
  let previous = 0;

  for (const rawSample of samples) {
    const sample = normalizeSample(rawSample);
    const abs = Math.abs(sample);

    peak = Math.max(peak, abs);
    sumSquares += sample * sample;
    sum += sample;

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
  const prosody = analyzeProsody(samples, normalizedSampleRate, frameRmsDbfs);
  const noiseFloorDbfs = percentile(frameRmsDbfs, 0.1) ?? MIN_DBFS;
  const peakDbfs = amplitudeToDbfs(peak);
  const rmsDbfs = amplitudeToDbfs(rms);
  const estimatedTruePeakDbfs = amplitudeToDbfs(
    estimateInterSamplePeak(samples, peak),
  );
  const integratedLufs = computeIntegratedLufs(samples, normalizedSampleRate);
  const snrDb = clamp(round(rmsDbfs - noiseFloorDbfs, 1), 0, 96);
  const clippingDetected =
    clippedSamples > Math.max(2, samples.length * 0.00005);
  const tailScore = computeTailScore(samples, normalizedSampleRate);

  return {
    schemaVersion: "voice.audio_metrics.v1",
    durationMs,
    sampleRateHz: normalizedSampleRate,
    bitDepth: PCM_TARGET_BIT_DEPTH,
    channels: 1,
    sampleCount: samples.length,
    peakDbfs,
    estimatedTruePeakDbfs,
    rmsDbfs,
    integratedLufs,
    noiseFloorDbfs,
    snrDb,
    crestFactorDb: clamp(round(peakDbfs - rmsDbfs, 1), 0, 96),
    dcOffset: round(sum / Math.max(samples.length, 1), 6),
    clippingDetected,
    clippingSampleCount: clippedSamples,
    clippingRate: round(clippedSamples / Math.max(samples.length, 1), 6),
    activeSpeechRatio: computeFrameActivityRatio(frameRmsDbfs, -45, true),
    silenceRatio: computeFrameActivityRatio(frameRmsDbfs, -55, false),
    voicedFrameRatio: prosody.voicedFrameRatio,
    meanPitchHz: prosody.meanPitchHz,
    pitchRangeSemitones: prosody.pitchRangeSemitones,
    pitchVariationSemitones: prosody.pitchVariationSemitones,
    energyVariationDb: prosody.energyVariationDb,
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

function analyzeProsody(
  samples: Float32Array,
  sampleRate: number,
  frameRmsDbfs: readonly number[],
): {
  readonly energyVariationDb: number;
  readonly meanPitchHz: number | null;
  readonly pitchRangeSemitones: number | null;
  readonly pitchVariationSemitones: number | null;
  readonly voicedFrameRatio: number;
} {
  const frameSize = 2048;
  const hopSize = 1024;
  const pitches: number[] = [];
  const activeEnergies: number[] = [];

  for (
    let offset = 0, frameIndex = 0;
    offset < samples.length;
    offset += hopSize, frameIndex += 1
  ) {
    const end = Math.min(offset + frameSize, samples.length);
    const frame = samples.subarray(offset, end);
    const energyDbfs = frameRmsDbfs[frameIndex] ?? MIN_DBFS;

    if (energyDbfs < -45 || frame.length < 512) {
      continue;
    }

    activeEnergies.push(energyDbfs);
    const pitchHz = estimatePitchHz(frame, sampleRate);

    if (pitchHz !== null) {
      pitches.push(pitchHz);
    }
  }

  const semitones = pitches.map((pitch) => 12 * Math.log2(pitch / 100));
  const meanPitchHz = pitches.length === 0 ? null : round(mean(pitches), 1);
  const pitchRangeSemitones =
    pitches.length < 2
      ? null
      : round(Math.max(...semitones) - Math.min(...semitones), 2);
  const pitchVariationSemitones =
    semitones.length < 2 ? null : round(standardDeviation(semitones), 2);

  return {
    energyVariationDb: round(standardDeviation(activeEnergies), 2),
    meanPitchHz,
    pitchRangeSemitones,
    pitchVariationSemitones,
    voicedFrameRatio:
      activeEnergies.length === 0
        ? 0
        : round(pitches.length / activeEnergies.length, 3),
  };
}

function estimatePitchHz(
  frame: Float32Array,
  sampleRate: number,
): number | null {
  const stride = 4;
  const effectiveSampleRate = sampleRate / stride;
  const downsampledLength = Math.floor(frame.length / stride);
  const downsampled = new Float32Array(downsampledLength);
  let meanValue = 0;

  for (let index = 0; index < downsampledLength; index += 1) {
    const value = normalizeSample(frame[index * stride]);
    downsampled[index] = value;
    meanValue += value;
  }

  meanValue /= Math.max(downsampledLength, 1);

  for (let index = 0; index < downsampled.length; index += 1) {
    downsampled[index] -= meanValue;
  }

  const minLag = Math.floor(effectiveSampleRate / 350);
  const maxLag = Math.ceil(effectiveSampleRate / 70);
  let bestLag = 0;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;

    for (let index = lag; index < downsampled.length; index += 1) {
      const left = downsampled[index];
      const right = downsampled[index - lag];
      correlation += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }

    const normalizedCorrelation =
      correlation / Math.sqrt(Math.max(leftEnergy * rightEnergy, 0.0000001));

    if (normalizedCorrelation > bestCorrelation) {
      bestCorrelation = normalizedCorrelation;
      bestLag = lag;
    }
  }

  if (bestLag === 0 || bestCorrelation < 0.35) {
    return null;
  }

  return effectiveSampleRate / bestLag;
}

function estimateInterSamplePeak(
  samples: Float32Array,
  samplePeak: number,
): number {
  let peak = samplePeak;

  for (let index = 1; index < samples.length; index += 1) {
    const previous = normalizeSample(samples[index - 1]);
    const current = normalizeSample(samples[index]);
    // 4x linear interpolation is intentionally labelled "estimated": it is
    // a conservative, dependency-free guardrail rather than IEC true-peak metering.
    for (let step = 1; step < 4; step += 1) {
      peak = Math.max(
        peak,
        Math.abs(previous + ((current - previous) * step) / 4),
      );
    }
  }

  return peak;
}

function computeFrameActivityRatio(
  frameRmsDbfs: readonly number[],
  thresholdDbfs: number,
  active: boolean,
): number {
  if (frameRmsDbfs.length === 0) {
    return 0;
  }

  const matchingFrames = frameRmsDbfs.filter((value) =>
    active ? value >= thresholdDbfs : value < thresholdDbfs,
  ).length;

  return round(matchingFrames / frameRmsDbfs.length, 3);
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
  const hopSize = 1024;
  const values: number[] = [];

  for (let offset = 0; offset < samples.length; offset += hopSize) {
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

function computeIntegratedLufs(
  samples: Float32Array,
  sampleRate: number,
): number {
  if (samples.length === 0) {
    return MIN_DBFS;
  }

  // These are the BS.1770 K-weighting biquad coefficients for 48 kHz mono.
  // The recorder always exports 48 kHz; for other analysis inputs we retain a
  // finite RMS fallback rather than claiming a calibrated loudness value.
  if (sampleRate !== PCM_TARGET_SAMPLE_RATE) {
    let sumSquares = 0;

    for (const sample of samples) {
      const normalized = normalizeSample(sample);
      sumSquares += normalized * normalized;
    }

    return clamp(
      round(
        10 *
          Math.log10(
            Math.max(sumSquares / Math.max(samples.length, 1), 0.0000000001),
          ) -
          0.691,
        1,
      ),
      MIN_DBFS,
      0,
    );
  }

  const preFiltered = processBiquad(samples, {
    b0: 1.53512485958697,
    b1: -2.69169618940638,
    b2: 1.19839281085285,
    a1: -1.69065929318241,
    a2: 0.73248077421585,
  });
  const weighted = processBiquad(preFiltered, {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: -1.99004745483398,
    a2: 0.99007225036689,
  });
  const blockSize = Math.max(1, Math.round(sampleRate * 0.4));
  const hopSize = Math.max(1, Math.round(sampleRate * 0.1));
  const blockPowers: number[] = [];

  if (samples.length < blockSize) {
    blockPowers.push(meanSquare(weighted, 0, weighted.length));
  } else {
    for (
      let offset = 0;
      offset + blockSize <= weighted.length;
      offset += hopSize
    ) {
      blockPowers.push(meanSquare(weighted, offset, offset + blockSize));
    }
  }

  const absoluteGate = 10 ** ((-70 + 0.691) / 10);
  const ungatedPower = mean(
    blockPowers.filter((power) => power >= absoluteGate),
  );

  if (ungatedPower <= 0) {
    return MIN_DBFS;
  }

  const ungatedLufs = 10 * Math.log10(ungatedPower) - 0.691;
  const relativeGate = Math.max(
    absoluteGate,
    10 ** ((ungatedLufs - 10 + 0.691) / 10),
  );
  const gatedPowers = blockPowers.filter((power) => power >= relativeGate);
  const integratedPower = mean(gatedPowers);

  return clamp(
    round(10 * Math.log10(Math.max(integratedPower, 0.0000000001)) - 0.691, 1),
    MIN_DBFS,
    0,
  );
}

type BiquadCoefficients = {
  readonly a1: number;
  readonly a2: number;
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
};

function processBiquad(
  samples: Float32Array,
  coefficients: BiquadCoefficients,
): Float32Array {
  const output = new Float32Array(samples.length);
  let previousInput = 0;
  let previousInput2 = 0;
  let previousOutput = 0;
  let previousOutput2 = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const input = normalizeSample(samples[index]);
    const nextOutput =
      coefficients.b0 * input +
      coefficients.b1 * previousInput +
      coefficients.b2 * previousInput2 -
      coefficients.a1 * previousOutput -
      coefficients.a2 * previousOutput2;

    output[index] = Number.isFinite(nextOutput) ? nextOutput : 0;
    previousInput2 = previousInput;
    previousInput = input;
    previousOutput2 = previousOutput;
    previousOutput = output[index];
  }

  return output;
}

function meanSquare(samples: Float32Array, start: number, end: number): number {
  let sumSquares = 0;

  for (let index = start; index < end; index += 1) {
    const sample = normalizeSample(samples[index]);
    sumSquares += sample * sample;
  }

  return sumSquares / Math.max(1, end - start);
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

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const average = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    values.length;

  return Math.sqrt(variance);
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
