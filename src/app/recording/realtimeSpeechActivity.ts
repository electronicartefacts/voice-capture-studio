export type RealtimeSpeechActivitySnapshot = {
  readonly active: boolean;
  readonly hasDetectedSpeech: boolean;
  readonly lastSpeechAtMs: number;
  readonly noiseFloorDbfs: number;
  readonly signalDbfs: number;
  readonly speechDurationMs: number;
  readonly startThresholdDbfs: number;
  readonly trailingSilenceMs: number;
};

export type RealtimeSpeechActivityDetector = {
  readonly process: (
    samples: Float32Array,
    sampleRateHz: number,
    capturedAtMs: number,
  ) => RealtimeSpeechActivitySnapshot;
  readonly snapshot: (capturedAtMs: number) => RealtimeSpeechActivitySnapshot;
};

const MIN_DBFS = -96;
const DEFAULT_NOISE_FLOOR_DBFS = -60;
const START_MARGIN_DB = 10;
const END_HYSTERESIS_DB = 4;
const ATTACK_MS = 48;
const RELEASE_MS = 260;

/**
 * Low-cost endpoint detector for the live recorder. It consumes the same PCM
 * batches that are already copied out of the AudioWorklet, so it does not open
 * a second audio graph or compete with WAV capture. A calibrated room floor is
 * preferred, then slowly adapted while the detector is confidently idle.
 */
export function createRealtimeSpeechActivityDetector(
  input: {
    readonly noiseFloorDbfs?: number | null;
  } = {},
): RealtimeSpeechActivityDetector {
  let active = false;
  let attackDurationMs = 0;
  let hasDetectedSpeech = false;
  let lastSpeechAtMs = 0;
  let noiseFloorDbfs = normalizeNoiseFloor(input.noiseFloorDbfs);
  let signalDbfs = MIN_DBFS;
  let speechDurationMs = 0;

  const readSnapshot = (capturedAtMs: number) => {
    const startThresholdDbfs = computeStartThreshold(noiseFloorDbfs);

    return {
      active,
      hasDetectedSpeech,
      lastSpeechAtMs,
      noiseFloorDbfs: round(noiseFloorDbfs),
      signalDbfs: round(signalDbfs),
      speechDurationMs: Math.round(speechDurationMs),
      startThresholdDbfs: round(startThresholdDbfs),
      trailingSilenceMs: hasDetectedSpeech
        ? Math.max(0, Math.round(capturedAtMs - lastSpeechAtMs))
        : 0,
    };
  };

  return {
    process(samples, sampleRateHz, capturedAtMs) {
      const frameDurationMs =
        (samples.length / Math.max(1, normalizeSampleRate(sampleRateHz))) *
        1000;
      signalDbfs = measureSpeechSignalDbfs(samples);
      const startThresholdDbfs = computeStartThreshold(noiseFloorDbfs);
      const continueThresholdDbfs = startThresholdDbfs - END_HYSTERESIS_DB;

      if (!active) {
        if (signalDbfs >= startThresholdDbfs) {
          attackDurationMs += frameDurationMs;

          if (attackDurationMs >= ATTACK_MS) {
            active = true;
            hasDetectedSpeech = true;
            lastSpeechAtMs = capturedAtMs;
            speechDurationMs += attackDurationMs;
            attackDurationMs = 0;
          }
        } else {
          attackDurationMs = 0;
          // Only follow plausible background levels. This resists a fan or a
          // transient raising the floor until speech can no longer reopen.
          if (signalDbfs < startThresholdDbfs - 2) {
            const adaptation = signalDbfs > noiseFloorDbfs ? 0.008 : 0.035;

            noiseFloorDbfs += (signalDbfs - noiseFloorDbfs) * adaptation;
            noiseFloorDbfs = clamp(noiseFloorDbfs, -78, -28);
          }
        }
      } else if (signalDbfs >= continueThresholdDbfs) {
        lastSpeechAtMs = capturedAtMs;
        speechDurationMs += frameDurationMs;
      } else if (capturedAtMs - lastSpeechAtMs >= RELEASE_MS) {
        active = false;
        attackDurationMs = 0;
      }

      return readSnapshot(capturedAtMs);
    },
    snapshot: readSnapshot,
  };
}

function measureSpeechSignalDbfs(samples: Float32Array): number {
  let peak = 0;
  let sumSquares = 0;

  for (const rawSample of samples) {
    const sample = Number.isFinite(rawSample) ? clamp(rawSample, -1, 1) : 0;

    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, samples.length));
  const rmsDbfs = amplitudeToDbfs(rms);
  const peakDbfs = amplitudeToDbfs(peak);

  // Peak support retains quiet consonant/plosive edges without letting a
  // single sample dominate the sustained RMS decision.
  return Math.max(rmsDbfs, peakDbfs - 13);
}

function amplitudeToDbfs(value: number): number {
  return Math.max(MIN_DBFS, 20 * Math.log10(Math.max(value, 0.000001)));
}

function computeStartThreshold(noiseFloorDbfs: number): number {
  return clamp(noiseFloorDbfs + START_MARGIN_DB, -50, -27);
}

function normalizeNoiseFloor(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, -78, -28)
    : DEFAULT_NOISE_FLOOR_DBFS;
}

function normalizeSampleRate(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 48_000;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
