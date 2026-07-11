const REVIEW_TARGET_LUFS = -18;
const REVIEW_TRUE_PEAK_CEILING_DBFS = -1;
const REVIEW_MAX_GAIN = 4;

export function computeReviewPlaybackGain(input: {
  readonly integratedLufs: number;
  readonly estimatedTruePeakDbfs: number;
}): number {
  if (
    !Number.isFinite(input.integratedLufs) ||
    !Number.isFinite(input.estimatedTruePeakDbfs)
  ) {
    return 1;
  }

  const loudnessGain = decibelsToLinear(
    REVIEW_TARGET_LUFS - input.integratedLufs,
  );
  const peakSafeGain = decibelsToLinear(
    REVIEW_TRUE_PEAK_CEILING_DBFS - input.estimatedTruePeakDbfs,
  );

  return Math.max(1, Math.min(REVIEW_MAX_GAIN, loudnessGain, peakSafeGain));
}

function decibelsToLinear(decibels: number): number {
  return 10 ** (decibels / 20);
}
