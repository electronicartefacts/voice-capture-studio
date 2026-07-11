import type { PcmRecordingMetrics } from "./pcmAudio";

export type InputGainMode = "auto" | "manual";

export type InputGainPlan = {
  readonly mode: InputGainMode;
  readonly factor: number;
  readonly gainDb: number;
  readonly targetLufs: number;
  readonly truePeakCeilingDbfs: number;
  readonly noiseFloorCeilingDbfs: number;
  readonly limitedBy:
    | "target"
    | "true_peak"
    | "noise_floor"
    | "maximum"
    | "manual"
    | "clipping"
    | "insufficient_signal";
};

const TARGET_LUFS = -20;
const TRUE_PEAK_CEILING_DBFS = -3;
const NOISE_FLOOR_CEILING_DBFS = -42;
const MAX_AUTO_GAIN_DB = 12;
const MIN_VOICE_ACTIVITY = 0.04;

export function planInputGain(input: {
  readonly manualFactor: number;
  readonly metrics: PcmRecordingMetrics;
  readonly mode: InputGainMode;
}): InputGainPlan {
  const base = {
    mode: input.mode,
    noiseFloorCeilingDbfs: NOISE_FLOOR_CEILING_DBFS,
    targetLufs: TARGET_LUFS,
    truePeakCeilingDbfs: TRUE_PEAK_CEILING_DBFS,
  } as const;

  if (input.metrics.clippingDetected) {
    return createPlan(base, 1, "clipping");
  }

  if (
    input.metrics.activeSpeechRatio < MIN_VOICE_ACTIVITY ||
    input.metrics.peakDbfs <= -72
  ) {
    return createPlan(base, 1, "insufficient_signal");
  }

  const peakSafeGainDb =
    TRUE_PEAK_CEILING_DBFS - input.metrics.estimatedTruePeakDbfs;

  if (input.mode === "manual") {
    const requestedGainDb = linearToDecibels(clamp(input.manualFactor, 0.5, 3));
    const gainDb = Math.min(requestedGainDb, peakSafeGainDb);

    return createPlan(
      base,
      decibelsToLinear(gainDb),
      gainDb < requestedGainDb - 0.01 ? "true_peak" : "manual",
    );
  }

  const targetGainDb = TARGET_LUFS - input.metrics.integratedLufs;
  const noiseSafeGainDb =
    NOISE_FLOOR_CEILING_DBFS - input.metrics.noiseFloorDbfs;
  const gainDb = Math.max(
    0,
    Math.min(MAX_AUTO_GAIN_DB, targetGainDb, peakSafeGainDb, noiseSafeGainDb),
  );
  const limitingCandidates = [
    [targetGainDb, "target"],
    [peakSafeGainDb, "true_peak"],
    [noiseSafeGainDb, "noise_floor"],
    [MAX_AUTO_GAIN_DB, "maximum"],
  ] as const;
  const limitedBy =
    limitingCandidates.reduce((lowest, candidate) =>
      candidate[0] < lowest[0] ? candidate : lowest,
    )[1] ?? "target";

  return createPlan(base, decibelsToLinear(gainDb), limitedBy);
}

export function applyInputGain(
  samples: Float32Array,
  factor: number,
): Float32Array {
  if (Math.abs(factor - 1) < 0.000001) {
    return samples;
  }

  const output = new Float32Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    output[index] = clamp(samples[index] * factor, -1, 1);
  }

  return output;
}

function createPlan(
  base: Pick<
    InputGainPlan,
    "mode" | "noiseFloorCeilingDbfs" | "targetLufs" | "truePeakCeilingDbfs"
  >,
  factor: number,
  limitedBy: InputGainPlan["limitedBy"],
): InputGainPlan {
  return {
    ...base,
    factor,
    gainDb: linearToDecibels(factor),
    limitedBy,
  };
}

function decibelsToLinear(decibels: number): number {
  return 10 ** (decibels / 20);
}

function linearToDecibels(factor: number): number {
  return 20 * Math.log10(Math.max(Number.EPSILON, factor));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
