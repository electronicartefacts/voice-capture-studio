export function getWaveformSamplePosition(
  index: number,
  sampleCount: number,
): number {
  return index / Math.max(1, sampleCount - 1);
}
