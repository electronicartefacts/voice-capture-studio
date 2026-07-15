import type { PcmRecordingMetrics } from "../audio/pcmRecorder";
import type { CaptureAudioMode } from "./audioModePolicy";

export type VocalPerformanceAssessment = {
  readonly kind: "spoken" | "sung" | "undetermined";
  readonly source: "mode_intent" | "audio_signal";
  readonly confidence: number;
  readonly pitchRangeSemitones: number | null;
  readonly pitchVariationSemitones: number | null;
  readonly voicedFrameRatio: number;
};

export function assessVocalPerformance(input: {
  readonly captureMode: CaptureAudioMode;
  readonly metrics: Pick<
    PcmRecordingMetrics,
    "pitchRangeSemitones" | "pitchVariationSemitones" | "voicedFrameRatio"
  >;
  readonly sungIntent?: boolean;
}): VocalPerformanceAssessment {
  const evidence = {
    pitchRangeSemitones: input.metrics.pitchRangeSemitones,
    pitchVariationSemitones: input.metrics.pitchVariationSemitones,
    voicedFrameRatio: input.metrics.voicedFrameRatio,
  };

  if (input.captureMode === "mastering" || input.sungIntent === true) {
    return {
      kind: "sung",
      source: "mode_intent",
      confidence: 1,
      ...evidence,
    };
  }

  const pitchRange = input.metrics.pitchRangeSemitones;
  const pitchVariation = input.metrics.pitchVariationSemitones;
  const sungSignal =
    pitchRange !== null &&
    pitchVariation !== null &&
    pitchRange >= 7 &&
    pitchVariation >= 2.2 &&
    input.metrics.voicedFrameRatio >= 0.2;

  if (sungSignal) {
    return {
      kind: "sung",
      source: "audio_signal",
      confidence: 0.72,
      ...evidence,
    };
  }

  if (
    pitchRange !== null &&
    pitchVariation !== null &&
    input.metrics.voicedFrameRatio >= 0.12
  ) {
    return {
      kind: "spoken",
      source: "audio_signal",
      confidence: 0.66,
      ...evidence,
    };
  }

  return {
    kind: "undetermined",
    source: "audio_signal",
    confidence: 0.35,
    ...evidence,
  };
}

export function describeVocalActivity(
  assessment: VocalPerformanceAssessment,
): string {
  if (assessment.kind === "sung") return "chantée";
  if (assessment.kind === "spoken") return "parlée";
  return "vocale";
}
