import type {
  LocalProcessingProfile,
  SpeechSegment,
  WhisperWordTiming,
} from "./types";

export type LexicalSegmentationQuality = {
  readonly status: "review" | "insufficient";
  readonly reviewRequired: true;
  readonly acceptedWordCount: number;
  readonly rejectedWordCount: number;
  readonly timingAcceptanceRate: number;
  readonly speechOverlapRate: number;
  readonly wordsPerSpeechMinute: number;
  readonly warnings: readonly string[];
};

export type SupportedWordTiming = WhisperWordTiming & {
  readonly acousticSupport: number;
};

const MIN_WORD_DURATION_MS = 60;
const MAX_WORD_DURATION_MS = 4_000;
const MIN_WORD_SPEECH_OVERLAP = 0.35;

/**
 * Chooses a conservative local profile from capabilities shared by every
 * browser engine. WebGPU is deliberately not required: the shipped models run
 * on WASM today, while future separators may use the recorded capability.
 */
export function selectLexicalProcessingProfile(input: {
  readonly durationMs: number;
  readonly webGpuAvailable: boolean;
  readonly wasmThreadsAvailable: boolean;
}): LocalProcessingProfile {
  if (
    input.durationMs > 10 * 60_000 ||
    (!input.webGpuAvailable && !input.wasmThreadsAvailable)
  ) {
    return "compatible";
  }

  return "balanced";
}

export function assessLexicalSegmentation(input: {
  readonly timings: readonly WhisperWordTiming[];
  readonly speechSegments: readonly SpeechSegment[];
}): {
  readonly acceptedTimings: readonly SupportedWordTiming[];
  readonly quality: LexicalSegmentationQuality;
} {
  const acceptedTimings: SupportedWordTiming[] = [];

  for (const timing of input.timings) {
    const durationMs = timing.endMs - timing.startMs;
    const acousticSupport = calculateSpeechOverlap(
      timing,
      input.speechSegments,
    );

    if (
      durationMs < MIN_WORD_DURATION_MS ||
      durationMs > MAX_WORD_DURATION_MS ||
      acousticSupport < MIN_WORD_SPEECH_OVERLAP ||
      !containsLexicalContent(timing.word)
    ) {
      continue;
    }

    acceptedTimings.push({ ...timing, acousticSupport });
  }

  const speechDurationMs = input.speechSegments.reduce(
    (sum, segment) => sum + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  const timingAcceptanceRate = ratio(
    acceptedTimings.length,
    input.timings.length,
  );
  const speechOverlapRate =
    acceptedTimings.length === 0
      ? 0
      : acceptedTimings.reduce(
          (sum, timing) => sum + timing.acousticSupport,
          0,
        ) / acceptedTimings.length;
  const wordsPerSpeechMinute =
    speechDurationMs === 0
      ? 0
      : acceptedTimings.length / (speechDurationMs / 60_000);
  const warnings: string[] = [];

  if (input.speechSegments.length === 0) {
    warnings.push("Aucune activité vocale indépendante n'a été confirmée.");
  }
  if (timingAcceptanceRate < 0.7) {
    warnings.push(
      "Une partie importante des mots proposés n'est pas soutenue par le signal vocal.",
    );
  }
  if (speechOverlapRate < 0.65) {
    warnings.push("Les limites temporelles restent acoustiquement fragiles.");
  }
  if (wordsPerSpeechMinute > 320) {
    warnings.push("La densité de mots détectés est anormalement élevée.");
  }

  const insufficient =
    input.speechSegments.length === 0 ||
    acceptedTimings.length === 0 ||
    timingAcceptanceRate < 0.5 ||
    speechOverlapRate < 0.5 ||
    wordsPerSpeechMinute > 360;

  return {
    acceptedTimings,
    quality: {
      status: insufficient ? "insufficient" : "review",
      reviewRequired: true,
      acceptedWordCount: acceptedTimings.length,
      rejectedWordCount: input.timings.length - acceptedTimings.length,
      timingAcceptanceRate: roundRate(timingAcceptanceRate),
      speechOverlapRate: roundRate(speechOverlapRate),
      wordsPerSpeechMinute: Math.round(wordsPerSpeechMinute),
      warnings,
    },
  };
}

function calculateSpeechOverlap(
  timing: WhisperWordTiming,
  segments: readonly SpeechSegment[],
): number {
  const durationMs = timing.endMs - timing.startMs;

  if (durationMs <= 0) return 0;

  const overlapMs = segments.reduce((sum, segment) => {
    const overlapStart = Math.max(timing.startMs, segment.startMs);
    const overlapEnd = Math.min(timing.endMs, segment.endMs);
    return sum + Math.max(0, overlapEnd - overlapStart);
  }, 0);

  return Math.min(1, overlapMs / durationMs);
}

function containsLexicalContent(word: string): boolean {
  return /[\p{L}\p{N}]/u.test(word);
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : value / total;
}

function roundRate(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
