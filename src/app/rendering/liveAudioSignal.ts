const DISPLAY_SAMPLES = 260;

type LiveAudioSignal = {
  readonly samples: Float32Array;
  updatedAt: number;
  level: number;
};

// This typed-array bus keeps sample-rate updates outside React. The UI receives
// only the semantic level, while the renderer consumes fresh audio directly.
export const liveAudioSignal: LiveAudioSignal = {
  samples: new Float32Array(DISPLAY_SAMPLES),
  updatedAt: 0,
  level: 0,
};

export function pushLiveWaveform(samples: Float32Array, gain: number): void {
  pushLiveWaveformFromSource((index) => samples[index], samples.length, gain);
}

export function pushLiveWaveformFromSource(
  readSample: (index: number) => number,
  sourceLength: number,
  gain: number,
): void {
  const target = liveAudioSignal.samples;
  const bucketSize = sourceLength / target.length;

  for (let index = 0; index < target.length; index += 1) {
    const start = Math.floor(index * bucketSize);
    const end = Math.min(
      sourceLength,
      Math.max(start + 1, Math.floor((index + 1) * bucketSize)),
    );
    let peak = 0;

    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      const value = readSample(sourceIndex);

      if (Math.abs(value) > Math.abs(peak)) peak = value;
    }

    target[index] = softLimit(peak * gain, 0.9, 3.6);
  }

  liveAudioSignal.updatedAt = performance.now();
}

export function setLiveAudioLevel(level: number): void {
  liveAudioSignal.level = Math.min(1, Math.max(0, level));
}

export function getLiveAudioLevel(): number {
  return liveAudioSignal.level;
}

export function getWaveformDisplayGain(
  baseGain: number,
  level: number,
  isCompactSurface: boolean,
): number {
  if (!isCompactSurface) return baseGain;

  // Phone microphones, especially through Safari, can expose a much quieter
  // time-domain signal than desktop inputs. Lift quiet speech more strongly,
  // then ease the boost as the level rises so loud voices keep their shape.
  const boundedLevel = Math.min(1, Math.max(0, level));
  const compactBoost = 1.7 + (1 - boundedLevel) * 0.65;

  return baseGain * compactBoost;
}

function softLimit(value: number, threshold: number, ratio: number): number {
  const absoluteValue = Math.abs(value);

  return absoluteValue <= threshold
    ? value
    : Math.sign(value) * (threshold + (absoluteValue - threshold) / ratio);
}
