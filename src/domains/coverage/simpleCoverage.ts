import type { CorpusManifest } from "@domains/corpus";
import type { LanguageCode } from "@shared/index";
import type { SpeakerId } from "@domains/speakers";
import type { RecordedTake } from "@domains/sessions";
import type { VoiceWorkspace } from "@domains/workspace";

export type CoverageSummary = {
  readonly completedPrompts: number;
  readonly totalPrompts: number;
  readonly promptCoverage: number;
  readonly percent: number;
  readonly audioQuality: number;
  readonly asrCoverage: number;
  readonly forcedAlignmentCoverage: number;
  readonly promptPhoneticCoverage: number;
  readonly prosodyMeasurementCoverage: number;
  readonly technicalQuality: number;
  readonly transcriptAccuracy: number;
  readonly intentCoverage: number;
  readonly prosodyDiversity: number;
  readonly phoneticCoverage: number;
  readonly datasetReadiness: DatasetReadiness;
  readonly missingIntents: readonly string[];
  readonly missingPaces: readonly string[];
  readonly missingEnergies: readonly string[];
  readonly missingPhonetics: readonly string[];
  readonly nextRecommendation: string;
};

export type DatasetReadiness =
  | "Needs Calibration"
  | "MVP Candidate"
  | "Production Candidate"
  | "Premium Candidate";

export function summarizeCoverage(input: {
  readonly workspace: VoiceWorkspace;
  readonly corpus: CorpusManifest;
  readonly speakerId: SpeakerId;
  readonly language: LanguageCode;
}): CoverageSummary {
  const totalPrompts = input.corpus.scenarios
    .filter((scenario) => scenario.language === input.language)
    .reduce((total, scenario) => total + scenario.prompts.length, 0);
  const progress = input.workspace.corpusProgress.find(
    (snapshot) =>
      snapshot.corpusId === input.corpus.id &&
      snapshot.speakerId === input.speakerId &&
      snapshot.language === input.language,
  );
  const completedPromptSet = new Set(progress?.completedPrompts ?? []);
  const prompts = input.corpus.scenarios
    .filter((scenario) => scenario.language === input.language)
    .flatMap((scenario) => scenario.prompts);
  const completedPromptsData = prompts.filter((prompt) => completedPromptSet.has(prompt.id));
  const completedPrompts = completedPromptsData.length;
  const percent = totalPrompts === 0
    ? 0
    : Math.min(100, Math.round((completedPrompts / totalPrompts) * 100));
  const keeperTakes = input.workspace.capturedSessions
    .filter(
      (session) =>
        session.corpusId === input.corpus.id &&
        session.speakerId === input.speakerId &&
        session.language === input.language,
    )
    .flatMap((session) => session.takes)
    .filter((take) => take.review.rating === "keeper");
  const completedIntents = new Set(completedPromptsData.map((prompt) => prompt.intention.primary));
  const completedPaces = new Set(completedPromptsData.map((prompt) => prompt.delivery.pace));
  const completedEnergies = new Set(completedPromptsData.map((prompt) => prompt.delivery.energy));
  const completedPhonetics = new Set(
    completedPromptsData.flatMap((prompt) => prompt.phonetics.coverage),
  );
  const allIntents = new Set(prompts.map((prompt) => prompt.intention.primary));
  const allPaces = new Set(prompts.map((prompt) => prompt.delivery.pace));
  const allEnergies = new Set(prompts.map((prompt) => prompt.delivery.energy));
  const allPhonetics = new Set(prompts.flatMap((prompt) => prompt.phonetics.coverage));
  const intentCoverage =
    prompts.length === 0
      ? 0
      : Math.round((completedIntents.size / allIntents.size) * 100);
  const promptPhoneticCoverage =
    allPhonetics.size === 0
      ? 0
      : Math.round((completedPhonetics.size / allPhonetics.size) * 100);
  const audioQuality = scoreAudioQuality(keeperTakes);
  const asrTakes = keeperTakes.filter(
    (take) => take.transcript.matchEstimate?.source === "web_speech",
  );
  const asrCoverage = percentage(asrTakes.length, keeperTakes.length);
  const transcriptAccuracy = average(
    asrTakes.map((take) => take.transcript.matchEstimate?.score ?? 0),
  );
  const forcedAlignmentCoverage = percentage(
    keeperTakes.filter((take) => take.timing.forcedAlignment !== undefined)
      .length,
    keeperTakes.length,
  );
  const prosodyMeasuredTakes = keeperTakes.filter(
    (take) => take.quality.performance.prosody !== undefined,
  );
  const prosodyMeasurementCoverage = percentage(
    prosodyMeasuredTakes.length,
    keeperTakes.length,
  );
  const prosodyDiversity = average(
    prosodyMeasuredTakes.map(
      (take) => (take.quality.performance.prosodyVariation ?? 0) * 100,
    ),
  );
  const phoneticCoverage = forcedAlignmentCoverage;
  const datasetReadiness = computeReadiness({
    completedPrompts,
    audioQuality,
    asrCoverage,
    forcedAlignmentCoverage,
  });

  return {
    completedPrompts,
    totalPrompts,
    promptCoverage: percent,
    percent,
    audioQuality,
    asrCoverage,
    forcedAlignmentCoverage,
    promptPhoneticCoverage,
    prosodyMeasurementCoverage,
    technicalQuality: audioQuality,
    transcriptAccuracy,
    intentCoverage,
    prosodyDiversity,
    phoneticCoverage,
    datasetReadiness,
    missingIntents: [...allIntents].filter((intent) => !completedIntents.has(intent)),
    missingPaces: [...allPaces].filter((pace) => !completedPaces.has(pace)),
    missingEnergies: [...allEnergies].filter((energy) => !completedEnergies.has(energy)),
    missingPhonetics: [...allPhonetics].filter((target) => !completedPhonetics.has(target)),
    nextRecommendation: createNextRecommendation({
      completedPromptCount: completedPrompts,
      intentCoverage,
      prosodyDiversity,
      phoneticCoverage,
      missingPhonetics: [...allPhonetics].filter((target) => !completedPhonetics.has(target)),
      audioQuality,
      asrCoverage,
      forcedAlignmentCoverage,
    }),
  };
}

function computeReadiness(input: {
  readonly completedPrompts: number;
  readonly audioQuality: number;
  readonly asrCoverage: number;
  readonly forcedAlignmentCoverage: number;
}): DatasetReadiness {
  if (
    input.completedPrompts >= 1500 &&
    input.audioQuality >= 90 &&
    input.asrCoverage >= 90 &&
    input.forcedAlignmentCoverage >= 90
  ) {
    return "Premium Candidate";
  }

  if (
    input.completedPrompts >= 500 &&
    input.audioQuality >= 85 &&
    input.asrCoverage >= 90 &&
    input.forcedAlignmentCoverage >= 80
  ) {
    return "Production Candidate";
  }

  if (
    input.completedPrompts >= 6 &&
    input.audioQuality >= 80 &&
    input.asrCoverage >= 80
  ) {
    return "MVP Candidate";
  }

  return "Needs Calibration";
}

function createNextRecommendation(input: {
  readonly completedPromptCount: number;
  readonly intentCoverage: number;
  readonly prosodyDiversity: number;
  readonly phoneticCoverage: number;
  readonly missingPhonetics: readonly string[];
  readonly audioQuality: number;
  readonly asrCoverage: number;
  readonly forcedAlignmentCoverage: number;
}): string {
  if (input.completedPromptCount === 0) {
    return "Commence par un silence de pièce, puis deux prises neutres.";
  }

  if (input.audioQuality < 80) {
    return "Nettoie d'abord les prises audio avant d'augmenter la couverture du corpus.";
  }

  if (input.asrCoverage < 100) {
    return "Active la reconnaissance vocale et vérifie le texte avant de garder la prise.";
  }

  if (input.forcedAlignmentCoverage < 100) {
    return "Importe un alignement forcé acoustique avant de conclure sur les phonèmes.";
  }

  if (input.intentCoverage < 70) {
    return "Ajoute une intention manquante avant de refaire du neutre.";
  }

  if (input.prosodyDiversity < 70) {
    return "Varie le rythme et les pauses sur les prochaines prises.";
  }

  if (input.phoneticCoverage < 70 && input.missingPhonetics.length > 0) {
    return `Ajoute une phrase ciblant ${input.missingPhonetics[0]}.`;
  }

  return "Continue avec des prises comparables. Garde seulement les meilleures.";
}

const AUDIO_GATE_IDS = new Set([
  "clipping",
  "noise_floor",
  "signal_level",
  "snr",
  "duration",
  "audio_persistence",
  "headroom",
  "dc_offset",
  "speech_activity",
  "plosives",
  "mouth_noise",
  "reverb",
]);

function scoreAudioQuality(takes: readonly RecordedTake[]): number {
  if (takes.length === 0) {
    return 0;
  }

  return Math.round(
    average(
      takes.map((take) => {
        const gates = take.quality.gates.filter((gate) =>
          AUDIO_GATE_IDS.has(gate.id),
        );

        if (gates.length === 0) {
          return take.quality.verdict === "pass" ? 100 : 50;
        }

        const score = gates.reduce(
          (total, gate) =>
            total + (gate.status === "pass" ? 1 : gate.status === "review" ? 0.5 : 0),
          0,
        );

        return (score / gates.length) * 100;
      }),
    ),
  );
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(
    (values.reduce((total, value) => total + value, 0) / values.length) * 100,
  ) / 100;
}

function percentage(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}
