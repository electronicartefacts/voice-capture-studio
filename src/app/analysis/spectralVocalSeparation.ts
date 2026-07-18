import { createVocalFocusSignal } from "./vocalFocus";

const FRAME_SIZE = 512;
const HOP_SIZE = 128;
const DEFAULT_SAMPLE_RATE = 16_000;

export type SpectralVocalSeparationResult = {
  readonly signal: Float32Array;
  readonly centerEnergyRatio: number;
  readonly residualEnergyRatio: number;
  readonly noiseReferenceUsed: boolean;
  readonly noiseReferenceFrameCount: number;
};

/**
 * Browser-safe two-source approximation. It combines a frequency-domain
 * mid/side mask with a slowly learned accompaniment floor. Unlike the cheap
 * time-domain focus, it can attenuate instruments only in the bins where they
 * compete with the voice, and it still produces a useful residual for mono.
 */
export function separateVocalsSpectrally(input: {
  readonly left: Float32Array;
  readonly right: Float32Array | null;
  readonly noiseReference?: Float32Array | null;
  readonly sampleRate?: number;
  readonly onProgress?: (progressPercent: number) => void;
}): SpectralVocalSeparationResult {
  const sampleRate = input.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const length = input.left.length;

  if (length === 0 || (input.right !== null && input.right.length !== length)) {
    return {
      signal: createVocalFocusSignal(input.left, sampleRate),
      centerEnergyRatio: input.right === null ? 1 : 0,
      residualEnergyRatio: 0,
      noiseReferenceUsed: false,
      noiseReferenceFrameCount: 0,
    };
  }

  const output = new Float32Array(length);
  const normalization = new Float32Array(length);
  const window = createSqrtHannWindow(FRAME_SIZE);
  const background = new Float32Array(FRAME_SIZE / 2 + 1);
  const reference = estimateReferenceNoiseSpectrum(input.noiseReference);
  if (reference !== null) background.set(reference.magnitudes);
  const frameCount = Math.max(
    1,
    Math.ceil((length - FRAME_SIZE) / HOP_SIZE) + 1,
  );
  let centerEnergy = 0;
  let mixtureEnergy = 0;
  let residualEnergy = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * HOP_SIZE;
    const leftReal = new Float64Array(FRAME_SIZE);
    const leftImaginary = new Float64Array(FRAME_SIZE);
    const rightReal = new Float64Array(FRAME_SIZE);
    const rightImaginary = new Float64Array(FRAME_SIZE);

    for (let index = 0; index < FRAME_SIZE; index += 1) {
      const sourceIndex = offset + index;
      const left = finiteSample(input.left[sourceIndex] ?? 0);
      const right = finiteSample(input.right?.[sourceIndex] ?? left);
      leftReal[index] = left * window[index];
      rightReal[index] = right * window[index];
    }

    transformFft(leftReal, leftImaginary, false);
    transformFft(rightReal, rightImaginary, false);

    const vocalReal = new Float64Array(FRAME_SIZE);
    const vocalImaginary = new Float64Array(FRAME_SIZE);

    for (let bin = 0; bin <= FRAME_SIZE / 2; bin += 1) {
      const midReal = (leftReal[bin] + rightReal[bin]) * 0.5;
      const midImaginary = (leftImaginary[bin] + rightImaginary[bin]) * 0.5;
      const sideReal = (leftReal[bin] - rightReal[bin]) * 0.5;
      const sideImaginary = (leftImaginary[bin] - rightImaginary[bin]) * 0.5;
      const midMagnitude = Math.hypot(midReal, midImaginary);
      const sideMagnitude = Math.hypot(sideReal, sideImaginary);
      const centerRatio = midMagnitude / (midMagnitude + sideMagnitude + 1e-8);
      const previousFloor = background[bin];
      const floorAlpha =
        previousFloor === 0 || midMagnitude < previousFloor ? 0.18 : 0.004;
      const nextFloor =
        previousFloor + floorAlpha * (midMagnitude - previousFloor);
      background[bin] = nextFloor;
      const referenceFloor = reference?.magnitudes[bin] ?? 0;
      const noiseEstimate = Math.max(nextFloor * 0.72, referenceFloor * 0.92);
      const residualRatio = clampUnit(
        (midMagnitude - noiseEstimate) / (midMagnitude + 1e-8),
      );
      const frequencyHz = (bin * sampleRate) / FRAME_SIZE;
      const bandWeight = vocalBandWeight(frequencyHz, sampleRate);
      const spatialWeight = input.right === null ? 0.38 : centerRatio ** 1.7;
      const separationMask = clampUnit(
        bandWeight * (0.08 + spatialWeight * 0.58 + residualRatio * 0.54),
      );

      vocalReal[bin] = midReal * separationMask;
      vocalImaginary[bin] = midImaginary * separationMask;
      if (bin > 0 && bin < FRAME_SIZE / 2) {
        const mirror = FRAME_SIZE - bin;
        vocalReal[mirror] = vocalReal[bin];
        vocalImaginary[mirror] = -vocalImaginary[bin];
      }

      const binEnergy = midMagnitude * midMagnitude;
      mixtureEnergy += binEnergy;
      centerEnergy += binEnergy * centerRatio;
      residualEnergy += binEnergy * residualRatio;
    }

    transformFft(vocalReal, vocalImaginary, true);

    for (let index = 0; index < FRAME_SIZE; index += 1) {
      const targetIndex = offset + index;
      if (targetIndex >= output.length) break;
      const windowGain = window[index];
      output[targetIndex] += vocalReal[index] * windowGain;
      normalization[targetIndex] += windowGain * windowGain;
    }

    if (frame % 16 === 0 || frame === frameCount - 1) {
      input.onProgress?.(Math.round(((frame + 1) / frameCount) * 100));
    }
  }

  for (let index = 0; index < output.length; index += 1) {
    if (normalization[index] > 1e-5) output[index] /= normalization[index];
  }

  return {
    signal: createVocalFocusSignal(output, sampleRate),
    centerEnergyRatio: roundRate(centerEnergy / Math.max(mixtureEnergy, 1e-8)),
    residualEnergyRatio: roundRate(
      residualEnergy / Math.max(mixtureEnergy, 1e-8),
    ),
    noiseReferenceUsed: reference !== null,
    noiseReferenceFrameCount: reference?.frameCount ?? 0,
  };
}

function estimateReferenceNoiseSpectrum(
  signal: Float32Array | null | undefined,
): { readonly magnitudes: Float32Array; readonly frameCount: number } | null {
  if (signal === null || signal === undefined || signal.length < FRAME_SIZE) {
    return null;
  }

  const magnitudes = new Float32Array(FRAME_SIZE / 2 + 1);
  const window = createSqrtHannWindow(FRAME_SIZE);
  const referenceHopSize = FRAME_SIZE / 2;
  const frameCount = Math.max(
    1,
    Math.floor((signal.length - FRAME_SIZE) / referenceHopSize) + 1,
  );

  for (let frame = 0; frame < frameCount; frame += 1) {
    const real = new Float64Array(FRAME_SIZE);
    const imaginary = new Float64Array(FRAME_SIZE);
    const offset = frame * referenceHopSize;
    for (let index = 0; index < FRAME_SIZE; index += 1) {
      real[index] = finiteSample(signal[offset + index] ?? 0) * window[index];
    }
    transformFft(real, imaginary, false);
    for (let bin = 0; bin <= FRAME_SIZE / 2; bin += 1) {
      magnitudes[bin] += Math.hypot(real[bin], imaginary[bin]) / frameCount;
    }
  }

  return { magnitudes, frameCount };
}

function transformFft(
  real: Float64Array,
  imaginary: Float64Array,
  inverse: boolean,
) {
  const length = real.length;

  for (let index = 1, reversed = 0; index < length; index += 1) {
    let bit = length >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [
        imaginary[reversed],
        imaginary[index],
      ];
    }
  }

  for (let size = 2; size <= length; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);

    for (let start = 0; start < length; start += size) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      const half = size >> 1;

      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const oddReal =
          real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary =
          real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        const evenReal = real[even];
        const evenImaginary = imaginary[even];
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
        const nextTwiddleReal =
          twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary =
          twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < length; index += 1) {
      real[index] /= length;
      imaginary[index] /= length;
    }
  }
}

function createSqrtHannWindow(length: number): Float64Array {
  return Float64Array.from({ length }, (_, index) =>
    Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (length - 1))),
  );
}

function vocalBandWeight(frequencyHz: number, sampleRate: number): number {
  if (frequencyHz <= 70 || frequencyHz >= sampleRate * 0.49) return 0;
  if (frequencyHz < 130) return (frequencyHz - 70) / 60;
  if (frequencyHz <= 6_800) return 1;
  return clampUnit((sampleRate * 0.49 - frequencyHz) / 1_040);
}

function finiteSample(sample: number): number {
  return Number.isFinite(sample) ? sample : 0;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function roundRate(value: number): number {
  return Math.round(clampUnit(value) * 1_000) / 1_000;
}
