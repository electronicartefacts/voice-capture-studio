import type { ForcedAlignment } from "@domains/phonetics";
import type { RecordedTake } from "./types";

export function applyForcedAlignment(
  take: RecordedTake,
  alignment: ForcedAlignment,
): RecordedTake {
  const gates = take.quality.gates.map((gate) =>
    gate.id === "phoneme_alignment"
      ? {
          ...gate,
          status: "pass" as const,
          message: `Alignement acoustique importé depuis ${alignment.aligner}.`,
        }
      : gate,
  );
  const verdict = gates.some((gate) => gate.status === "fail")
    ? "reject"
    : gates.some((gate) => gate.status === "review")
      ? "review"
      : "pass";
  const wordPhonemeLinkRate =
    alignment.words.length === 0
      ? 0
      : Math.round(
          (alignment.words.filter((word) => word.endMs > word.startMs).length /
            alignment.words.length) *
            100,
        ) / 100;
  const phonemeInventoryCount = new Set(
    alignment.phonemes.map((phoneme) => phoneme.phoneme),
  ).size;

  return {
    ...take,
    timing: {
      ...take.timing,
      forcedAlignment: alignment,
    },
    quality: {
      ...take.quality,
      performance: {
        ...take.quality.performance,
        alignmentConfidence: alignment.confidence,
        phonemeInventoryCount,
        wordPhonemeLinkRate,
        keeper: verdict === "pass",
      },
      gates,
      verdict,
    },
    review: {
      ...take.review,
      rating:
        verdict === "pass"
          ? "keeper"
          : verdict === "reject"
            ? "reject"
            : "maybe",
      bestTake: verdict === "pass",
    },
  };
}
