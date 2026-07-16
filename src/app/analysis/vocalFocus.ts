const DEFAULT_SAMPLE_RATE = 16_000;

export type VocalFocusResult = {
  readonly signal: Float32Array;
  readonly stereoCenterUsed: boolean;
};

export function createVocalFocusSignal(
  input: Float32Array,
  sampleRate = DEFAULT_SAMPLE_RATE,
): Float32Array {
  return filterVocalBand(input, sampleRate);
}

export function createStereoVocalFocusSignal(
  left: Float32Array,
  right: Float32Array | null,
  sampleRate = DEFAULT_SAMPLE_RATE,
): VocalFocusResult {
  if (right === null || right.length !== left.length) {
    return {
      signal: filterVocalBand(left, sampleRate),
      stereoCenterUsed: false,
    };
  }

  const centered = new Float32Array(left.length);

  for (let index = 0; index < centered.length; index += 1) {
    const leftSample = finiteSample(left[index]);
    const rightSample = finiteSample(right[index]);
    const mid = (leftSample + rightSample) * 0.5;
    const side = (leftSample - rightSample) * 0.5;
    // Lead vocals are commonly coherent and centered. Subtracting a bounded
    // amount of side energy attenuates wide guitars, reverbs and synths while
    // preserving the phase and timing of the center image.
    const centeredMagnitude = Math.max(
      0,
      Math.abs(mid) - Math.abs(side) * 0.58,
    );
    centered[index] = Math.sign(mid) * centeredMagnitude;
  }

  return {
    signal: filterVocalBand(centered, sampleRate),
    stereoCenterUsed: true,
  };
}

function filterVocalBand(
  input: Float32Array,
  sampleRate: number,
): Float32Array {
  const output = new Float32Array(input.length);
  const highPassCutoffHz = 105;
  const lowPassCutoffHz = Math.min(7_200, sampleRate * 0.45);
  const timeStep = 1 / sampleRate;
  const highPassRc = 1 / (2 * Math.PI * highPassCutoffHz);
  const highPassAlpha = highPassRc / (highPassRc + timeStep);
  const lowPassRc = 1 / (2 * Math.PI * lowPassCutoffHz);
  const lowPassAlpha = timeStep / (lowPassRc + timeStep);
  const fastEnvelopeAlpha = 1 - Math.exp(-1 / (sampleRate * 0.004));
  const slowEnvelopeAlpha = 1 - Math.exp(-1 / (sampleRate * 0.09));
  let previousInput = 0;
  let highPassed = 0;
  let lowPassed = 0;
  let fastEnvelope = 0;
  let slowEnvelope = 0;
  let peak = 0;

  for (let index = 0; index < input.length; index += 1) {
    const sample = finiteSample(input[index]);
    highPassed = highPassAlpha * (highPassed + sample - previousInput);
    previousInput = sample;
    lowPassed += lowPassAlpha * (highPassed - lowPassed);

    const magnitude = Math.abs(lowPassed);
    fastEnvelope += fastEnvelopeAlpha * (magnitude - fastEnvelope);
    slowEnvelope += slowEnvelopeAlpha * (magnitude - slowEnvelope);
    const transientRatio = Math.max(
      0,
      (fastEnvelope - slowEnvelope * 1.45) / (slowEnvelope + 0.004),
    );
    // Drum attacks are short and broadband. A soft, bounded attenuation makes
    // consonants survive while reducing the transients that confuse ASR.
    const transientGain = 1 / (1 + transientRatio * 0.42);
    const focused = lowPassed * Math.max(0.42, transientGain);

    output[index] = focused;
    peak = Math.max(peak, Math.abs(focused));
  }

  if (peak >= 0.006) {
    const gain = Math.min(5, 0.9 / peak);
    for (let index = 0; index < output.length; index += 1) {
      output[index] = Math.max(-1, Math.min(1, output[index] * gain));
    }
  }

  return output;
}

function finiteSample(sample: number): number {
  return Number.isFinite(sample) ? sample : 0;
}
