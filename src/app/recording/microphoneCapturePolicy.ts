export const AMBIENT_MEASUREMENT_CONSTRAINTS: MediaTrackConstraints = {
  autoGainControl: false,
  channelCount: { ideal: 1 },
  echoCancellation: false,
  noiseSuppression: false,
  sampleRate: { ideal: 48_000 },
  sampleSize: { ideal: 24 },
};

export type AmbientNoiseProfile = {
  readonly schemaVersion: "voice.ambient_preflight.v1";
  readonly observedDurationMs: number;
  readonly sampleWindows: number;
  readonly rmsDbfs: number;
  readonly peakDbfs: number;
};

export function createAmbientNoiseProfile(
  rmsWindows: readonly number[],
  observedDurationMs: number,
): AmbientNoiseProfile | null {
  const finite = rmsWindows.filter(
    (value) => Number.isFinite(value) && value >= 0,
  );
  if (finite.length === 0) return null;
  const meanEnergy =
    finite.reduce((sum, value) => sum + value * value, 0) / finite.length;
  return {
    schemaVersion: "voice.ambient_preflight.v1",
    observedDurationMs: Math.max(0, Math.round(observedDurationMs)),
    sampleWindows: finite.length,
    rmsDbfs: amplitudeToDbfs(Math.sqrt(meanEnergy)),
    peakDbfs: amplitudeToDbfs(Math.max(...finite)),
  };
}

/**
 * The monitor must stay raw so room tone remains measurable. The recording
 * stream has a different job: reject loudspeaker and stationary background
 * spill before it is baked into the canonical WAV. `ideal` constraints keep
 * older Safari/WebViews usable when one of the processors is unavailable.
 */
export function createVoiceCaptureConstraints(): MediaTrackConstraints {
  return {
    autoGainControl: false,
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    sampleRate: { ideal: 48_000 },
    sampleSize: { ideal: 24 },
    // Chromium exposes voiceIsolation experimentally. Keeping it progressive
    // avoids making this non-standard capability a capture prerequisite.
    voiceIsolation: { ideal: true },
  } as MediaTrackConstraints;
}

export function microphoneProcessingSummary(settings: MediaTrackSettings): {
  readonly echoCancellation: boolean | null;
  readonly noiseSuppression: boolean | null;
  readonly voiceIsolation: boolean | null;
} {
  const extended = settings as MediaTrackSettings & {
    readonly voiceIsolation?: boolean;
  };
  return {
    echoCancellation: booleanOrNull(settings.echoCancellation),
    noiseSuppression: booleanOrNull(settings.noiseSuppression),
    voiceIsolation: booleanOrNull(extended.voiceIsolation),
  };
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function amplitudeToDbfs(value: number): number {
  if (value <= 0) return -96;
  return Math.round(Math.max(-96, 20 * Math.log10(value)) * 10) / 10;
}
