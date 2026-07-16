import { segmentSpeechProbabilities } from "./speechSegments";
import type { SpeechSegment } from "./types";

const FRAME_SAMPLES = 512;
const FRAME_MS = 32;

export function detectFocusedVocalActivity(
  signal: Float32Array,
): readonly SpeechSegment[] {
  const frameCount = Math.floor(signal.length / FRAME_SAMPLES);
  if (frameCount === 0) return [];
  const levels = new Float32Array(frameCount);
  let peak = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    let energy = 0;
    const start = frame * FRAME_SAMPLES;
    for (let offset = 0; offset < FRAME_SAMPLES; offset += 1) {
      const sample = Number.isFinite(signal[start + offset])
        ? signal[start + offset]
        : 0;
      energy += sample * sample;
    }
    const rms = Math.sqrt(energy / FRAME_SAMPLES);
    levels[frame] = rms;
    peak = Math.max(peak, rms);
  }

  if (peak < 0.002) return [];
  const sorted = [...levels].sort((left, right) => left - right);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const threshold = Math.max(0.0025, noiseFloor * 2.4, peak * 0.075);
  const probabilities = [...levels].map((level) =>
    Math.min(1, Math.max(0, (level - threshold * 0.55) / (threshold * 0.9))),
  );

  return segmentSpeechProbabilities(probabilities, FRAME_MS);
}
