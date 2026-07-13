import type { ForcedAlignment } from "@domains/phonetics";
import type { RecordedTake } from "./types";

export function applyForcedAlignment(
  take: RecordedTake,
  alignment: ForcedAlignment,
): RecordedTake {
  assertForcedAlignmentMatchesTranscript(
    alignment,
    take.transcript.spokenText || take.transcript.originalText,
  );
  const gates = take.quality.gates.map((gate) =>
    gate.id === "phoneme_alignment"
      ? {
          ...gate,
          status: alignment.consensus?.reviewRequired
            ? ("review" as const)
            : ("pass" as const),
          message: alignment.consensus?.reviewRequired
            ? `Consensus acoustique divergent (${alignment.consensus.agreementMs} ms) : révision requise.`
            : `Alignement acoustique importé depuis ${alignment.aligner}.`,
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

export function assertForcedAlignmentMatchesTranscript(
  alignment: ForcedAlignment,
  expectedText: string,
): void {
  const expected = normalizeSpeechText(expectedText);
  const observed = normalizeSpeechText(
    alignment.words.map((word) => word.word).join(" "),
  );

  if (expected.length === 0 || observed.length === 0 || expected !== observed) {
    throw new Error(
      "Le transcript de l'alignement ne correspond pas à la prise ciblée.",
    );
  }
}

function normalizeSpeechText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
