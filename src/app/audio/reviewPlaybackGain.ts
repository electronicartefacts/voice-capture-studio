const REVIEW_TARGET_LUFS = -14;
const REVIEW_MAX_GAIN = 8;

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
  return Math.max(1, Math.min(REVIEW_MAX_GAIN, loudnessGain));
}

function decibelsToLinear(decibels: number): number {
  return 10 ** (decibels / 20);
}
