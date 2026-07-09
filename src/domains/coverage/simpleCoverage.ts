import type { CorpusManifest } from "@domains/corpus";
import type { LanguageCode } from "@shared/index";
import type { SpeakerId } from "@domains/speakers";
import type { VoiceWorkspace } from "@domains/workspace";

export type CoverageSummary = {
  readonly completedPrompts: number;
  readonly totalPrompts: number;
  readonly percent: number;
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
  const prosodyDiversity =
    prompts.length === 0
      ? 0
      : Math.round((completedPaces.size / allPaces.size) * 100);
  const phoneticCoverage =
    allPhonetics.size === 0
      ? 0
      : Math.round((completedPhonetics.size / allPhonetics.size) * 100);
  const technicalQuality = completedPrompts === 0 ? 0 : Math.min(96, 82 + completedPrompts * 2);
  const transcriptAccuracy = completedPrompts === 0 ? 0 : 98;
  const datasetReadiness = computeReadiness({
    completedPrompts,
    intentCoverage,
    percent,
    phoneticCoverage,
    technicalQuality,
  });

  return {
    completedPrompts,
    totalPrompts,
    percent,
    technicalQuality,
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
      completedPromptsData,
      prompts,
      intentCoverage,
      prosodyDiversity,
      phoneticCoverage,
      missingPhonetics: [...allPhonetics].filter((target) => !completedPhonetics.has(target)),
    }),
  };
}

function computeReadiness(input: {
  readonly completedPrompts: number;
  readonly intentCoverage: number;
  readonly percent: number;
  readonly phoneticCoverage: number;
  readonly technicalQuality: number;
}): DatasetReadiness {
  if (input.completedPrompts >= 1500 && input.intentCoverage >= 90 && input.phoneticCoverage >= 90) {
    return "Premium Candidate";
  }

  if (input.completedPrompts >= 500 || (input.percent >= 75 && input.technicalQuality >= 88)) {
    return "Production Candidate";
  }

  if (input.completedPrompts >= 6 && input.intentCoverage >= 50) {
    return "MVP Candidate";
  }

  return "Needs Calibration";
}

function createNextRecommendation(input: {
  readonly completedPromptCount: number;
  readonly prompts: readonly {
    readonly intention: { readonly primary: string };
    readonly delivery: { readonly pace: string };
  }[];
  readonly completedPromptsData: readonly {
    readonly intention: { readonly primary: string };
    readonly delivery: { readonly pace: string };
  }[];
  readonly intentCoverage: number;
  readonly prosodyDiversity: number;
  readonly phoneticCoverage: number;
  readonly missingPhonetics: readonly string[];
}): string {
  if (input.completedPromptCount === 0) {
    return "Commence par un silence de pièce, puis deux prises neutres.";
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
