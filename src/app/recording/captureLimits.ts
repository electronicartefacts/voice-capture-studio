/**
 * PCM capture is buffered in memory until it is finalized into a WAV. Ten
 * minutes keeps a mono 48 kHz capture within a practical mobile-memory budget
 * while still allowing an uninterrupted performance or ambience take.
 */
export const FREE_CAPTURE_MAX_DURATION_MS = 10 * 60 * 1000;

export function formatCaptureDurationLimit(durationMs: number): string {
  const totalMinutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);

  return seconds === 0
    ? `${totalMinutes} min`
    : `${totalMinutes} min ${seconds} s`;
}
