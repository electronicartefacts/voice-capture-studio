import type { CorpusManifest, PromptDefinition } from "../../domains/corpus";
import type { CoverageSummary } from "../../domains/coverage";
import type { CaptureSession, RecordedTake } from "../../domains/sessions";
import type { SpeakerProfile } from "../../domains/speakers";
import type { VoiceWorkspace } from "../../domains/workspace";

export type CaptureSessionExportBundle = {
  readonly corpusJson: {
    readonly id: string;
    readonly version: string;
    readonly language: string;
    readonly plannedPromptIds: readonly string[];
    readonly promptCount: number;
  };
  readonly manifestJson: {
    readonly exportId: string;
    readonly format: "voice.capture_session";
    readonly formatVersion: "0.2.0";
    readonly workspaceId: string;
    readonly corpusId: string;
    readonly createdAt: string;
    readonly consent: {
      readonly speakerConsent: true;
      readonly consentCapturedAt: string;
      readonly permittedUses: readonly [
        "training",
        "fine_tuning",
        "evaluation",
        "private_archive",
      ];
    };
    readonly provenance: {
      readonly captureTool: "Voice Capture Studio";
      readonly captureToolVersion: "0.1.0";
      readonly captureProfile: VoiceWorkspace["settings"]["captureProfile"];
      readonly audioPolicy: {
        readonly requiredFormat: "wav_pcm_mono_48khz";
        readonly destructiveNoiseReductionAllowed: false;
        readonly compressedFormatsAllowed: false;
      };
    };
    readonly forgePipeline: readonly string[];
    readonly reports: readonly string[];
  };
  readonly reportsJson: VoiceCaptureReportsJson;
  readonly speakerJson: {
    readonly id: string;
    readonly displayName: string;
    readonly primaryLanguage: string;
    readonly supportedLanguages: readonly string[];
    readonly captureProfile: VoiceWorkspace["settings"]["captureProfile"];
  };
};

export type VoiceCaptureReportsJson = ReturnType<
  typeof createVoiceCaptureReports
>;

export function createCaptureSessionExportBundle(input: {
  readonly corpus: CorpusManifest;
  readonly coverage: CoverageSummary;
  readonly now?: Date;
  readonly session: CaptureSession;
  readonly speaker: SpeakerProfile | undefined;
  readonly workspace: VoiceWorkspace;
}): CaptureSessionExportBundle {
  const prompts = input.session.plannedPromptIds
    .map((promptId) => findCorpusPrompt(input.corpus, promptId))
    .filter((prompt): prompt is PromptDefinition => prompt !== undefined);
  const now = (input.now ?? new Date()).toISOString();

  return {
    corpusJson: {
      id: input.corpus.id,
      version: input.corpus.version,
      language: input.session.language,
      plannedPromptIds: input.session.plannedPromptIds,
      promptCount: input.session.plannedPromptIds.length,
    },
    manifestJson: {
      exportId: `export.${now}`,
      format: "voice.capture_session",
      formatVersion: "0.2.0",
      workspaceId: input.workspace.workspaceId,
      corpusId: input.corpus.id,
      createdAt: now,
      consent: {
        speakerConsent: true,
        consentCapturedAt: now,
        permittedUses: [
          "training",
          "fine_tuning",
          "evaluation",
          "private_archive",
        ],
      },
      provenance: {
        captureTool: "Voice Capture Studio",
        captureToolVersion: "0.1.0",
        captureProfile: input.workspace.settings.captureProfile,
        audioPolicy: {
          requiredFormat: "wav_pcm_mono_48khz",
          destructiveNoiseReductionAllowed: false,
          compressedFormatsAllowed: false,
        },
      },
      forgePipeline: [
        "voice_capture_archive",
        "validate_audio_quality",
        "normalize_metadata",
        "forced_alignment",
        "phonetic_coverage_report",
        "prosody_analysis",
        "intent_balance_report",
        "dataset_score",
        "voice_archive",
      ],
      reports: [
        "report.audio_quality",
        "report.transcript_alignment",
        "report.phonetic_coverage",
        "report.intent_balance",
        "report.prosody_distribution",
        "report.dataset_readiness",
      ],
    },
    reportsJson: createVoiceCaptureReports({
      coverage: input.coverage,
      prompts,
      takes: input.session.takes,
    }),
    speakerJson: {
      id: input.speaker?.id ?? input.session.speakerId,
      displayName: input.speaker?.displayName ?? input.session.speakerId,
      primaryLanguage: input.speaker?.primaryLanguage ?? input.session.language,
      supportedLanguages: input.speaker?.supportedLanguages ?? [
        input.session.language,
      ],
      captureProfile: input.workspace.settings.captureProfile,
    },
  };
}

export function createVoiceCaptureReports(input: {
  readonly coverage: CoverageSummary;
  readonly prompts: readonly PromptDefinition[];
  readonly takes: readonly RecordedTake[];
}) {
  const keeperTakes = input.takes.filter(
    (take) => take.review.rating === "keeper",
  );
  const latestTake = input.takes.at(-1);
  const totalDurationMs = input.takes.reduce(
    (total, take) => total + take.durationMs,
    0,
  );
  const promptById = new Map(
    input.prompts.map((prompt) => [prompt.id, prompt]),
  );
  const keeperPromptInstances = keeperTakes
    .map((take) => promptById.get(take.promptId))
    .filter((prompt): prompt is PromptDefinition => prompt !== undefined);
  const intentCounts = countBy(
    keeperPromptInstances,
    (prompt) => prompt.intention.primary,
  );
  const paceCounts = countBy(
    keeperPromptInstances,
    (prompt) => prompt.delivery.pace,
  );
  const emotionLabels = Array.from(
    new Set(
      keeperPromptInstances.flatMap(
        (prompt) => prompt.intention.emotion.labels,
      ),
    ),
  );
  const phonetic = estimatePhoneticCoverage(
    keeperPromptInstances.map((prompt) => prompt.text).join(" "),
  );
  const coveredPhoneticTargets = Array.from(
    new Set(
      keeperPromptInstances.flatMap((prompt) => prompt.phonetics.coverage),
    ),
  );
  const phoneticFocus = Array.from(
    new Set(keeperPromptInstances.flatMap((prompt) => prompt.phonetics.focus)),
  );

  return {
    audioQuality: {
      schemaVersion: "report.audio_quality.v1",
      takeCount: input.takes.length,
      keeperTakeCount: keeperTakes.length,
      totalDurationMs,
      latestTechnical: latestTake?.quality.technical ?? null,
      failedGates: input.takes.flatMap((take) =>
        take.quality.gates
          .filter((gate) => gate.status === "fail")
          .map((gate) => ({
            takeId: take.id,
            gate: gate.id,
            message: gate.message,
          })),
      ),
    },
    transcriptAlignment: {
      schemaVersion: "report.transcript_alignment.v1",
      alignmentMode: "browser_estimated_word_timing",
      forcedAlignmentRequired: true,
      averageTranscriptMatch: average(
        input.takes.map((take) => take.quality.performance.transcriptMatch),
      ),
      takesNeedingHumanReview: input.takes
        .filter((take) =>
          take.quality.gates.some(
            (gate) => gate.id === "transcript_match" && gate.status !== "pass",
          ),
        )
        .map((take) => take.id),
    },
    phoneticCoverage: {
      schemaVersion: "report.phonetic_coverage.v1",
      targetedCoverage: input.coverage.phoneticCoverage,
      coveredTargets: coveredPhoneticTargets,
      missingTargets: input.coverage.missingPhonetics,
      focusSamples: phoneticFocus,
      languageAgnosticLetterCoverage: phonetic.letterCoverage,
      vowelCoverage: phonetic.vowelCoverage,
      rareCharacterHits: phonetic.rareCharacterHits,
      recommendation:
        input.coverage.phoneticCoverage < 70
          ? "Ajoute des phrases couvrant les cibles phonétiques manquantes."
          : "Base phonétique ciblée correcte. Un alignement avancé pourra affiner le détail.",
    },
    intentBalance: {
      schemaVersion: "report.intent_balance.v1",
      intentCounts,
      emotionLabels,
      underrepresentedIntents: Object.entries(intentCounts)
        .filter(([, count]) => count < 2)
        .map(([intent]) => intent),
    },
    prosodyDistribution: {
      schemaVersion: "report.prosody_distribution.v1",
      paceCounts,
      energyCounts: countBy(
        keeperPromptInstances,
        (prompt) => prompt.delivery.energy,
      ),
      projectionCounts: countBy(
        keeperPromptInstances,
        (prompt) => prompt.delivery.projection,
      ),
      recommendation:
        Object.keys(paceCounts).length < 3
          ? "Ajoute des prises lentes, naturelles et rapides."
          : "Bonne variété de rythme pour démarrer.",
    },
    datasetReadiness: {
      schemaVersion: "report.dataset_readiness.v1",
      technicalQuality: input.coverage.technicalQuality,
      transcriptAccuracy: input.coverage.transcriptAccuracy,
      intentCoverage: input.coverage.intentCoverage,
      prosodyDiversity: input.coverage.prosodyDiversity,
      phoneticCoverage: input.coverage.phoneticCoverage,
      verdict: input.coverage.datasetReadiness,
      gaps: {
        missingIntents: input.coverage.missingIntents,
        missingPaces: input.coverage.missingPaces,
        missingEnergies: input.coverage.missingEnergies,
        missingPhonetics: input.coverage.missingPhonetics,
      },
      nextRecommendation: input.coverage.nextRecommendation,
    },
  };
}

function findCorpusPrompt(
  corpus: CorpusManifest,
  promptId: CaptureSession["plannedPromptIds"][number],
) {
  return corpus.scenarios
    .flatMap((scenario) => scenario.prompts)
    .find((prompt) => prompt.id === promptId);
}

function estimatePhoneticCoverage(text: string) {
  const normalizedText = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");
  const vowels = "aeiouy".split("");
  const uniqueLetters = new Set(
    normalizedText.replace(/[^a-z]/g, "").split(""),
  );

  return {
    letterCoverage: Math.round(
      (letters.filter((letter) => uniqueLetters.has(letter)).length /
        letters.length) *
        100,
    ),
    vowelCoverage: Math.round(
      (vowels.filter((letter) => uniqueLetters.has(letter)).length /
        vowels.length) *
        100,
    ),
    rareCharacterHits: ["q", "w", "x", "z"].filter((letter) =>
      uniqueLetters.has(letter),
    ),
  };
}

function countBy<TValue>(
  values: readonly TValue[],
  getKey: (value: TValue) => string,
): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = getKey(value);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    Math.round(
      (values.reduce((total, value) => total + value, 0) / values.length) * 100,
    ) / 100
  );
}
