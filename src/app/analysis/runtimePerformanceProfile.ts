import type { LocalAcousticScene, LocalRuntimeClass } from "./types";
import { classifyRuntimePerformance } from "./adaptiveAnalysis";

const STORAGE_KEY = "voice-capture-studio.processing-performance.v1";
const EWMA_WEIGHT = 0.35;

export type RuntimePerformanceProfile = {
  readonly schemaVersion: "voice.processing_performance.v1";
  readonly transcriptionRealtimeFactor: number | null;
  readonly separationRealtimeFactor: number | null;
  readonly transcriptionObservations: number;
  readonly separationObservations: number;
};

export type CapturedAnalysisBudget = {
  readonly runtimeClass: LocalRuntimeClass;
  readonly observedTranscriptionRealtimeFactor: number | null;
  readonly storedTranscriptionRealtimeFactor: number | null;
  readonly maximumHypotheses: 1 | 2 | 3;
  readonly allowVocalFocus: boolean;
  readonly allowSpectralSeparation: boolean;
  readonly reasons: readonly string[];
};

const EMPTY_PROFILE: RuntimePerformanceProfile = {
  schemaVersion: "voice.processing_performance.v1",
  transcriptionRealtimeFactor: null,
  separationRealtimeFactor: null,
  transcriptionObservations: 0,
  separationObservations: 0,
};

export function selectCapturedAnalysisBudget(input: {
  readonly scene: LocalAcousticScene;
  readonly durationMs: number;
  readonly observedTranscriptionRealtimeFactor?: number | null;
  readonly profile?: RuntimePerformanceProfile;
}): CapturedAnalysisBudget {
  const observed = normalizeFactor(input.observedTranscriptionRealtimeFactor);
  const stored = normalizeFactor(
    input.profile?.transcriptionRealtimeFactor ?? null,
  );
  const effective = observed ?? stored;
  const runtimeClass = classifyRuntimePerformance(effective);
  const reasons: string[] = [
    observed !== null
      ? "runtime_measured_this_take"
      : stored !== null
        ? "runtime_measured_on_this_browser"
        : "runtime_unmeasured_quality_first",
  ];

  let maximumHypotheses: 1 | 2 | 3 = 3;
  if (input.scene === "clean_voice") {
    maximumHypotheses = 1;
    reasons.push("clean_voice_fast_path");
  } else if (input.durationMs > 5 * 60_000) {
    maximumHypotheses = 2;
    reasons.push("long_take_memory_guard");
  } else if (runtimeClass === "constrained") {
    maximumHypotheses = 2;
    reasons.push("measured_runtime_guard");
  } else if (runtimeClass === "moderate" && input.durationMs > 2 * 60_000) {
    maximumHypotheses = 2;
    reasons.push("measured_runtime_duration_guard");
  } else {
    reasons.push("full_local_vocal_ensemble");
  }

  return {
    runtimeClass,
    observedTranscriptionRealtimeFactor: observed,
    storedTranscriptionRealtimeFactor: stored,
    maximumHypotheses,
    allowVocalFocus: maximumHypotheses >= 2,
    allowSpectralSeparation: maximumHypotheses >= 3,
    reasons,
  };
}

export function updateRuntimePerformanceProfile(
  profile: RuntimePerformanceProfile,
  observation: {
    readonly kind: "transcription" | "separation";
    readonly elapsedMs: number;
    readonly sourceDurationMs: number;
  },
): RuntimePerformanceProfile {
  if (
    !Number.isFinite(observation.elapsedMs) ||
    !Number.isFinite(observation.sourceDurationMs) ||
    observation.elapsedMs <= 0 ||
    observation.sourceDurationMs <= 0
  ) {
    return profile;
  }

  const factor = normalizeFactor(
    observation.elapsedMs / observation.sourceDurationMs,
  )!;
  const factorKey =
    observation.kind === "transcription"
      ? "transcriptionRealtimeFactor"
      : "separationRealtimeFactor";
  const countKey =
    observation.kind === "transcription"
      ? "transcriptionObservations"
      : "separationObservations";
  const previous = profile[factorKey];

  return {
    ...profile,
    [factorKey]: roundFactor(
      previous === null
        ? factor
        : previous * (1 - EWMA_WEIGHT) + factor * EWMA_WEIGHT,
    ),
    [countKey]: profile[countKey] + 1,
  };
}

export function readRuntimePerformanceProfile(): RuntimePerformanceProfile {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (value === null || value === undefined) return EMPTY_PROFILE;
    return normalizeProfile(
      JSON.parse(value) as Partial<RuntimePerformanceProfile>,
    );
  } catch {
    return EMPTY_PROFILE;
  }
}

export function recordRuntimePerformanceObservation(input: {
  readonly kind: "transcription" | "separation";
  readonly elapsedMs: number;
  readonly sourceDurationMs: number;
}): RuntimePerformanceProfile {
  const next = updateRuntimePerformanceProfile(
    readRuntimePerformanceProfile(),
    input,
  );
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing and embedded webviews may deny storage. Adaptation for
    // the current take still works from its direct measurement.
  }
  return next;
}

function normalizeProfile(
  value: Partial<RuntimePerformanceProfile>,
): RuntimePerformanceProfile {
  return {
    schemaVersion: "voice.processing_performance.v1",
    transcriptionRealtimeFactor: normalizeFactor(
      value.transcriptionRealtimeFactor,
    ),
    separationRealtimeFactor: normalizeFactor(value.separationRealtimeFactor),
    transcriptionObservations: normalizeCount(value.transcriptionObservations),
    separationObservations: normalizeCount(value.separationObservations),
  };
}

function normalizeFactor(value: number | null | undefined): number | null {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return null;
  }
  return roundFactor(Math.min(value, 20));
}

function normalizeCount(value: number | undefined): number {
  return Number.isInteger(value) && (value ?? -1) >= 0 ? value! : 0;
}

function roundFactor(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
