import { Clapperboard, Headphones, Mic } from "lucide-react";
import { canonicalCorpus, type PromptDefinition } from "@domains/corpus";
import type { CoverageSummary } from "@domains/coverage";
import type { RecordedTake } from "@domains/sessions";
import type { WorkspaceOpenError } from "@domains/workspace";
import type { PcmRecordingMetrics } from "../audio/pcmRecorder";
import type {
  RuntimeCheck,
  RuntimeDiagnostics,
} from "../system/runtimeDiagnostics";
import type { CaptureMode, RoomToneCalibration } from "./types";

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function formatMeterScale(value: number): string {
  return Math.max(0.035, clampUnit(value)).toFixed(3);
}
export function createModeMessage(mode: CaptureMode): string {
  if (mode === "training") {
    return "Mode dataset : le corpus intégré reste actif pour entraîner et comparer les prises.";
  }

  if (mode === "dubbing") {
    return "Mode doublage : ajoute un script local, puis enregistre les répliques une par une.";
  }

  return "Mode master : ajoute un texte local et, si besoin, une piste de retour au casque.";
}

export function createSessionPreparationMessage(mode: CaptureMode): string {
  if (mode === "mastering") {
    return "Lis la consigne. Au lancement, reste silencieux pendant la calibration, puis le retour casque démarre avec la prise.";
  }

  if (mode === "dubbing") {
    return "Lis la réplique. Au lancement, reste silencieux pendant la calibration de salle.";
  }

  return "Lis la consigne. Au lancement, reste silencieux pendant la calibration de salle.";
}

export function createRuntimeHomeMessage(
  diagnostics: RuntimeDiagnostics,
): string {
  if (diagnostics.status === "blocked") {
    return diagnostics.primaryAction;
  }

  if (diagnostics.status === "limited") {
    return `Mode local limité. ${diagnostics.primaryAction}`;
  }

  return "Prêt. La prochaine phrase cible les zones encore peu couvertes.";
}

export function isSupportedTextFile(file: File): boolean {
  const extension = file.name.toLowerCase().split(".").at(-1) ?? "";

  return (
    file.type.startsWith("text/") ||
    ["txt", "md", "markdown", "srt", "vtt"].includes(extension)
  );
}

export function isSupportedAudioFile(file: File): boolean {
  const extension = file.name.toLowerCase().split(".").at(-1) ?? "";

  return (
    file.type.startsWith("audio/") ||
    ["wav", "mp3", "m4a", "aac", "ogg", "flac"].includes(extension)
  );
}

export function createMemoryOnlyWorkspaceMessage(): string {
  return "Session temporaire: les données restent dans cet onglet. Télécharge les exports avant de fermer.";
}

export function canCreateWorkspaceAfterOpenFailure(
  error: WorkspaceOpenError,
): boolean {
  return (
    error === "workspace-not-found" || error === "workspace-storage-unavailable"
  );
}

export function isDefaultHomeMessage(message: string): boolean {
  return (
    message ===
      "Sélectionne une voix, confirme l'environnement, puis lance une session courte." ||
    message.startsWith("Prêt.") ||
    message.startsWith("Mode local limité.")
  );
}

export function formatRuntimeStatus(
  status: RuntimeDiagnostics["status"] | RuntimeCheck["status"],
): string {
  if (status === "ready") {
    return "Prêt";
  }

  if (status === "limited") {
    return "Limité";
  }

  return "À corriger";
}

export function formatSaveTarget(
  target: "browser" | "browser-and-folder" | "folder",
): string {
  if (target === "browser-and-folder") {
    return "Navigateur + dossier";
  }

  if (target === "folder") {
    return "Dossier local";
  }

  return "Stockage navigateur";
}

export function formatCaptureMode(mode: CaptureMode): string {
  if (mode === "training") {
    return "Dataset ML";
  }

  if (mode === "dubbing") {
    return "Doublage";
  }

  return "Master audio";
}

export function explainPromptChoice(
  prompt: PromptDefinition,
  coverage: CoverageSummary,
): string {
  const reasons = [
    coverage.missingIntents.includes(prompt.intention.primary)
      ? `intention à couvrir : ${prompt.intention.label}`
      : null,
    coverage.missingPaces.includes(prompt.delivery.pace)
      ? `rythme à ajouter : ${formatPace(prompt.delivery.pace)}`
      : null,
    coverage.missingEnergies.includes(prompt.delivery.energy)
      ? `énergie à ajouter : ${formatEnergy(prompt.delivery.energy)}`
      : null,
    prompt.phonetics.coverage.some((target) =>
      coverage.missingPhonetics.includes(target),
    )
      ? `sons à couvrir : ${prompt.phonetics.coverage
          .filter((target) => coverage.missingPhonetics.includes(target))
          .slice(0, 2)
          .map(formatPhoneticTarget)
          .join(", ")}`
      : null,
  ].filter((reason): reason is string => reason !== null);

  if (coverage.completedPrompts === 0) {
    return "On commence par une base propre avant les variantes expressives.";
  }

  if (reasons.length === 0) {
    return "Cette phrase sert à obtenir une prise comparable.";
  }

  return `Cette phrase complète le profil vocal : ${reasons.join(", ")}.`;
}

export function createTakeCoachNote(
  take: RecordedTake,
  nextRecommendation: string | null,
): string {
  const failedGate = take.quality.gates.find((gate) => gate.status === "fail");
  const reviewGate = take.quality.gates.find(
    (gate) => gate.status === "review",
  );

  if (failedGate !== undefined) {
    return `${failedGate.message} Reprends cette phrase avant de continuer.`;
  }

  if (reviewGate !== undefined && reviewGate.id !== "transcript_match") {
    return `${reviewGate.message} Garde-la en réserve, mais refais une prise plus propre.`;
  }

  if (reviewGate?.id === "transcript_match") {
    return "Le texte n'a pas été vérifié par l'ASR. Active la reconnaissance vocale ou importe une transcription avant de garder cette prise.";
  }

  return nextRecommendation ?? "Prise utilisable. Passe à la phrase suivante.";
}

export function formatPace(pace: PromptDefinition["delivery"]["pace"]): string {
  const labels: Record<PromptDefinition["delivery"]["pace"], string> = {
    slow: "lent",
    medium_slow: "plutôt lent",
    natural: "naturel",
    medium_fast: "plutôt rapide",
    fast: "rapide",
  };

  return labels[pace];
}

export function formatEnergy(
  energy: PromptDefinition["delivery"]["energy"],
): string {
  const labels: Record<PromptDefinition["delivery"]["energy"], string> = {
    low: "basse",
    medium_low: "modérée basse",
    medium: "moyenne",
    medium_high: "modérée haute",
    high: "haute",
  };

  return labels[energy];
}

export function formatCoveragePace(pace: string): string {
  if (isPromptPace(pace)) {
    return formatPace(pace);
  }

  return pace;
}

export function formatCoverageEnergy(energy: string): string {
  if (isPromptEnergy(energy)) {
    return formatEnergy(energy);
  }

  return energy;
}

export function formatCoverageIntent(intent: string): string {
  const prompt = canonicalCorpus.scenarios
    .flatMap((scenario) => scenario.prompts)
    .find((candidate) => candidate.intention.primary === intent);

  return prompt?.intention.label ?? intent.replace(/_/g, " ");
}

export function formatPhoneticTarget(target: string): string {
  return target
    .replace(/^fr_/, "FR ")
    .replace(/^en_/, "EN ")
    .replace(/_/g, " ");
}

export function isPromptPace(
  value: string,
): value is PromptDefinition["delivery"]["pace"] {
  return ["slow", "medium_slow", "natural", "medium_fast", "fast"].includes(
    value,
  );
}

export function isPromptEnergy(
  value: string,
): value is PromptDefinition["delivery"]["energy"] {
  return ["low", "medium_low", "medium", "medium_high", "high"].includes(value);
}

export function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

export function createRoomToneCalibration(
  metrics: PcmRecordingMetrics,
): RoomToneCalibration {
  return {
    durationMs: metrics.durationMs,
    peakDbfs: metrics.peakDbfs,
    noiseFloorDbfs: metrics.noiseFloorDbfs,
    integratedLufs: metrics.integratedLufs,
  };
}

export function formatDurationSeconds(durationMs: number): string {
  return `${Math.max(0, durationMs / 1000).toFixed(1)} s`;
}

export function formatDatasetReadiness(
  readiness: CoverageSummary["datasetReadiness"] | undefined,
): string {
  const labels: Record<CoverageSummary["datasetReadiness"], string> = {
    "Needs Calibration": "Calibration requise",
    "MVP Candidate": "Première base exploitable",
    "Production Candidate": "Production candidate",
    "Premium Candidate": "Qualité premium",
  };

  return readiness === undefined ? "Calibration requise" : labels[readiness];
}

export const captureModeOptions: readonly {
  readonly mode: CaptureMode;
  readonly icon: typeof Mic;
  readonly title: string;
  readonly pill: string;
  readonly kicker: string;
  readonly headline: string;
  readonly workbenchTitle: string;
  readonly summary: string;
}[] = [
  {
    mode: "training",
    icon: Mic,
    title: "Dataset ML",
    pill: "Corpus intégré",
    kicker: "Laboratoire dataset",
    headline: "Une voix stable, captée comme une matière vivante.",
    workbenchTitle: "Console dataset",
    summary:
      "Phrases calibrées, progression phonétique et exports d'entraînement.",
  },
  {
    mode: "dubbing",
    icon: Clapperboard,
    title: "Doublage",
    pill: "Script local",
    kicker: "Laboratoire doublage",
    headline: "Une surface d'écoute pour habiter chaque réplique.",
    workbenchTitle: "Console doublage",
    summary: "Texte collé ou fichier découpé en répliques enregistrables.",
  },
  {
    mode: "mastering",
    icon: Headphones,
    title: "Master audio",
    pill: "Retour casque",
    kicker: "Laboratoire master",
    headline: "Une prise voix centrée dans son environnement sonore.",
    workbenchTitle: "Console master",
    summary: "Texte local, piste de référence et capture voix séparée.",
  },
];

export function getCaptureModeContent(mode: CaptureMode) {
  return (
    captureModeOptions.find((option) => option.mode === mode) ??
    captureModeOptions[0]
  );
}
