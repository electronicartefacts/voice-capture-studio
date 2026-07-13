export type MlCaptureEndpointInput = {
  readonly finalAlignmentConfirmedAtMs: number | null;
  readonly nowMs: number;
  readonly expressiveEnding: boolean;
  readonly speechActive: boolean;
  readonly trailingSilenceMs: number;
};

export function isConfirmedMlEndpointReady(
  input: MlCaptureEndpointInput,
): boolean {
  if (input.finalAlignmentConfirmedAtMs === null) return false;

  const elapsedSinceConfirmationMs = Math.max(
    0,
    input.nowMs - input.finalAlignmentConfirmedAtMs,
  );
  const minimumSettleMs = input.expressiveEnding ? 640 : 520;
  const vadFailsafeMs = input.expressiveEnding ? 1_900 : 1_550;

  if (elapsedSinceConfirmationMs < minimumSettleMs) return false;
  if (!input.speechActive && input.trailingSilenceMs >= minimumSettleMs) {
    return true;
  }

  return elapsedSinceConfirmationMs >= vadFailsafeMs;
}
