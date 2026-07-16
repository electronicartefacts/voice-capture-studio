import { useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import {
  ArrowLeft,
  Database,
  Download,
  FolderOpen,
  Mic,
  Upload,
} from "lucide-react";
import type { CorpusManifest } from "@domains/corpus";
import type { CoverageSummary } from "@domains/coverage";
import type { RuntimeDiagnostics } from "../../system/runtimeDiagnostics";
import type { InputGainMode } from "../../audio/inputGain";
import {
  INPUT_SENSITIVITY_MAX,
  INPUT_SENSITIVITY_MIN,
} from "../audioEnvironment";
import {
  clampUnit,
  formatCaptureMode,
  formatCoverageEnergy,
  formatCoverageIntent,
  formatCoveragePace,
  formatDatasetReadiness,
  formatPhoneticTarget,
  formatRuntimeStatus,
} from "../helpers";
import type {
  CaptureMode,
  DatasetExportState,
  DownloadableRecording,
} from "../types";

export function Score(input: {
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div>
      <span>{input.label}</span>
      <strong>{input.value}/100</strong>
    </div>
  );
}

export function MicrophoneControlPanel(input: {
  readonly active: boolean;
  readonly audioLevel: number;
  readonly label: string | null;
  readonly mode: InputGainMode;
  readonly onModeChange: (mode: InputGainMode) => void;
  readonly onSensitivityChange: (value: number) => void;
  readonly sensitivity: number;
}) {
  const level = clampUnit(input.audioLevel);
  const sensitivityProgress =
    ((input.sensitivity - INPUT_SENSITIVITY_MIN) /
      (INPUT_SENSITIVITY_MAX - INPUT_SENSITIVITY_MIN)) *
    100;
  const levelHint = !input.active
    ? "Active le micro depuis l'accueil : la courbe en fond d'écran devient ton repère."
    : level < 0.07
      ? "Parle : la courbe en fond d'écran doit réagir immédiatement."
      : level > 0.85
        ? "Trop fort. Recule légèrement ou baisse la sensibilité."
        : "Niveau correct. La courbe suit ta voix en temps réel.";

  return (
    <section className="microphone-panel" aria-label="Microphone actif">
      <div className="microphone-panel-header">
        <div>
          <p className="soft-label">Microphone</p>
          <strong>{input.label ?? "Micro par défaut du navigateur"}</strong>
        </div>
        <span className={`mic-status is-${input.active ? "live" : "idle"}`}>
          <Mic aria-hidden="true" size={15} />
          {input.active ? "Actif" : "En veille"}
        </span>
      </div>
      <div className="mode-dial" role="group" aria-label="Mode de sensibilité">
        <button
          aria-pressed={input.mode === "auto"}
          className={`capture-mode-option${input.mode === "auto" ? " is-active" : ""}`}
          onClick={() => input.onModeChange("auto")}
          style={{ padding: "0 14px", width: "auto" }}
          type="button"
        >
          Auto
        </button>
        <button
          aria-pressed={input.mode === "manual"}
          className={`capture-mode-option${input.mode === "manual" ? " is-active" : ""}`}
          onClick={() => input.onModeChange("manual")}
          style={{ padding: "0 14px", width: "auto" }}
          type="button"
        >
          Manuel
        </button>
      </div>
      <label className="microphone-sensitivity studio-range-control">
        <span>
          {input.mode === "auto"
            ? "Réglage manuel de secours"
            : "Gain constant"}
        </span>
        <input
          aria-label="Sensibilité logicielle du micro"
          className="studio-range"
          disabled={input.mode === "auto"}
          max={INPUT_SENSITIVITY_MAX}
          min={INPUT_SENSITIVITY_MIN}
          onChange={(event) =>
            input.onSensitivityChange(Number(event.target.value))
          }
          step={0.05}
          style={
            {
              "--range-progress": `${sensitivityProgress}%`,
            } as CSSProperties
          }
          type="range"
          value={input.sensitivity}
        />
        <strong>{Math.round(input.sensitivity * 100)}%</strong>
      </label>
      <p className="microphone-hint" aria-live="polite">
        {input.mode === "auto"
          ? "Auto mesure la voix brute, protège les pics et refuse d’amplifier le bruit de la pièce. Le WAV conserve un gain constant, sans compression."
          : levelHint}
      </p>
    </section>
  );
}

export function TechnicalPage(input: {
  readonly audioLevel: number;
  readonly captureMode: CaptureMode;
  readonly corpusId: CorpusManifest["id"] | null;
  readonly corpusVersion: CorpusManifest["version"] | null;
  readonly coverage: CoverageSummary | null;
  readonly coveragePercent: number;
  readonly datasetExportState: DatasetExportState;
  readonly diagnostics: RuntimeDiagnostics;
  readonly folderName: string | null;
  readonly inputSensitivity: number;
  readonly inputGainMode: InputGainMode;
  readonly microphoneActive: boolean;
  readonly microphoneLabel: string | null;
  readonly trainingConsentGranted: boolean;
  readonly corpusLicenseGranted: boolean;
  readonly onBack: () => void;
  readonly onClearCachedModels: () => void;
  readonly onDownloadDataset: () => void;
  readonly onDownloadWorkspaceArchive: () => Promise<number>;
  readonly onImportForcedAlignment: (file: File) => void;
  readonly onImportWorkspaceArchive: (file: File) => Promise<number>;
  readonly onInputSensitivityChange: (value: number) => void;
  readonly onInputGainModeChange: (mode: InputGainMode) => void;
  readonly onTrainingConsentChange: (granted: boolean) => void;
  readonly onCorpusLicenseChange: (granted: boolean) => void;
  readonly onWriteDatasetToFolder: () => void;
  readonly recordings: readonly DownloadableRecording[];
  readonly savedSessions: number;
  readonly storageMode: "folder-capable" | "browser-downloads";
}) {
  return (
    <section className="technical-page">
      <div className="technical-header">
        <button
          className="quiet-button standalone"
          onClick={input.onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={17} />
          <span>Retour</span>
        </button>
        <div>
          <p className="soft-label">Suivi local</p>
          <h1>Qualité et exports</h1>
        </div>
      </div>
      <MicrophoneControlPanel
        active={input.microphoneActive}
        audioLevel={input.audioLevel}
        label={input.microphoneLabel}
        mode={input.inputGainMode}
        onModeChange={input.onInputGainModeChange}
        onSensitivityChange={input.onInputSensitivityChange}
        sensitivity={input.inputSensitivity}
      />
      <div className="technical-grid">
        <article>
          <strong>Stockage</strong>
          <span>{input.folderName ?? "Non choisi"}</span>
        </article>
        <article>
          <strong>Progression</strong>
          <span>{input.coveragePercent}%</span>
        </article>
        <article>
          <strong>Sessions</strong>
          <span>{input.savedSessions}</span>
        </article>
        <article>
          <strong>Mode</strong>
          <span>{formatCaptureMode(input.captureMode)}</span>
        </article>
        <article>
          <strong>Corpus</strong>
          <span>{input.corpusId ?? "Aucun"}</span>
        </article>
        <article>
          <strong>Version des phrases</strong>
          <span>{input.corpusVersion ?? "n/a"}</span>
        </article>
        <article>
          <strong>Environnement</strong>
          <span>{formatRuntimeStatus(input.diagnostics.status)}</span>
        </article>
        <article>
          <strong>Export</strong>
          <span>
            {input.diagnostics.canExportFolder
              ? "Dossier + téléchargement"
              : "Téléchargement"}
          </span>
        </article>
      </div>
      <section className="studio-ready-panel" aria-label="Rapport Studio Ready">
        <div>
          <p className="soft-label">Studio Ready</p>
          <strong>
            {input.diagnostics.recordingInputCount === null
              ? "Entrées audio à confirmer"
              : `${input.diagnostics.recordingInputCount} entrée${input.diagnostics.recordingInputCount > 1 ? "s" : ""} audio détectée${input.diagnostics.recordingInputCount > 1 ? "s" : ""}`}
          </strong>
          <span>
            {input.diagnostics.supportsHardwareRendering
              ? "Rendu accéléré disponible."
              : "Rendu Canvas de compatibilité actif."}
          </span>
        </div>
        <ul>
          <li>
            {input.diagnostics.supportsBackgroundProcessing
              ? "Traitements locaux en arrière-plan"
              : "Traitements locaux compatibles"}
          </li>
          <li>
            {input.diagnostics.supportsLocalSpeechRecognition
              ? "Guidage de transcription disponible"
              : "Transcription optionnelle indisponible"}
          </li>
          <li>
            {input.diagnostics.supportsSpeechSynthesis
              ? "Référence vocale disponible"
              : "Référence vocale indisponible"}
          </li>
        </ul>
      </section>
      {input.coverage !== null && (
        <div className="dataset-score">
          <h2>Qualité vocale</h2>
          <div className="score-grid">
            <Score label="Prompts" value={input.coverage.promptCoverage} />
            <Score label="Audio" value={input.coverage.audioQuality} />
            <Score label="ASR" value={input.coverage.transcriptAccuracy} />
            <Score label="Intentions" value={input.coverage.intentCoverage} />
            <Score label="Prosodie" value={input.coverage.prosodyDiversity} />
            <Score
              label="Alignement"
              value={input.coverage.forcedAlignmentCoverage}
            />
          </div>
          <strong>
            {formatDatasetReadiness(input.coverage.datasetReadiness)}
          </strong>
          <p>{input.coverage.nextRecommendation}</p>
          <div className="gap-list">
            <Gap
              label="Intentions"
              values={input.coverage.missingIntents.map(formatCoverageIntent)}
            />
            <Gap
              label="Rythmes"
              values={input.coverage.missingPaces.map(formatCoveragePace)}
            />
            <Gap
              label="Énergies"
              values={input.coverage.missingEnergies.map(formatCoverageEnergy)}
            />
            <Gap
              label="Sons"
              values={input.coverage.missingPhonetics.map(formatPhoneticTarget)}
            />
          </div>
        </div>
      )}
      <p className="technical-note">
        Rien n'est envoyé en ligne. Les prises restent sur cet appareil.
      </p>
      <WorkspaceArchivePanel
        onDownload={input.onDownloadWorkspaceArchive}
        onImport={input.onImportWorkspaceArchive}
      />
      <section
        className="forced-alignment-panel"
        aria-label="Droits du dataset"
      >
        <div>
          <p className="soft-label">Droits du dataset</p>
          <strong>Attestations locales et révocables</strong>
          <label>
            <input
              checked={input.trainingConsentGranted}
              onChange={(event) =>
                input.onTrainingConsentChange(event.currentTarget.checked)
              }
              type="checkbox"
            />{" "}
            J’autorise l’ingestion Forge et l’entraînement de modèles avec cette
            voix.
          </label>
          <label>
            <input
              checked={input.corpusLicenseGranted}
              onChange={(event) =>
                input.onCorpusLicenseChange(event.currentTarget.checked)
              }
              type="checkbox"
            />{" "}
            J’atteste disposer des droits nécessaires sur ce corpus pour cet
            usage.
          </label>
          <span>
            Ces attestations restent sur cet appareil, sont exportées comme
            preuves de provenance et peuvent être révoquées ici. Ceci ne
            constitue pas un avis juridique.
          </span>
        </div>
      </section>
      <section className="forced-alignment-panel">
        <div>
          <p className="soft-label">Modèles d'analyse</p>
          <strong>Reconnaissance vocale adaptative</strong>
          <span>
            Le studio classe d'abord la scène : voix nette, chant, environnement
            contraint, mix musical ou cas incertain. Le modèle léger ouvre
            l'analyse et suffit aux prises nettes cohérentes. Sinon, un modèle
            renforcé vérifie le résultat; sur un mix court et complexe, le
            moteur peut aussi comparer l'original, la voix centrale et une
            séparation spectrale. La détection de parole et l'activité chantée
            masquent les ponts instrumentaux pendant l'inférence sans modifier
            la durée ni les WAV. Chaque résultat conserve son budget, ses
            hypothèses et la raison du choix final. WebGPU est utilisé quand il
            est fiable, avec repli automatique sur WASM. Supprime les modèles
            pour récupérer de l'espace ou forcer leur rechargement.
          </span>
        </div>
        <button
          className="folder-button compact"
          onClick={input.onClearCachedModels}
          type="button"
        >
          <Database aria-hidden="true" size={17} />
          <span>Vider le cache IA</span>
        </button>
      </section>
      <ForcedAlignmentImport onFile={input.onImportForcedAlignment} />
      {input.storageMode === "browser-downloads" && (
        <p className="coach-note">
          Sur mobile, utilise les boutons de téléchargement après chaque prise.
          Tu retrouveras les fichiers dans Downloads, Drive ou ton gestionnaire
          de fichiers.
        </p>
      )}
      <div className="dataset-export-panel">
        <div className="dataset-export-header">
          <h2>Dataset complet</h2>
          <p>
            Regroupe toutes les prises gardées en un dataset prêt pour
            l'entraînement : audio brut, transcripts, métadonnées, phonèmes et
            rapports agrégés.
          </p>
        </div>
        <div className="dataset-export-actions">
          <button
            className="download-action"
            disabled={input.datasetExportState.status === "preparing"}
            onClick={input.onDownloadDataset}
            type="button"
          >
            <Download aria-hidden="true" size={18} />
            <span>
              {input.datasetExportState.status === "preparing"
                ? "Préparation…"
                : "Télécharger le dataset (.zip)"}
            </span>
          </button>
          {input.storageMode === "folder-capable" &&
            input.folderName !== null && (
              <button
                className="quiet-button"
                disabled={input.datasetExportState.status === "preparing"}
                onClick={input.onWriteDatasetToFolder}
                type="button"
              >
                <FolderOpen aria-hidden="true" size={18} />
                <span>Écrire dans le dossier local</span>
              </button>
            )}
        </div>
        {input.datasetExportState.status === "done" && (
          <p className="dataset-export-status">
            {input.datasetExportState.keeperCount} prise(s) gardée(s) incluse(s)
            dans le package Forge v1.
            {input.datasetExportState.forgeReady
              ? " Prêt pour ingestion Forge."
              : " Ingestion Forge bloquée tant que les droits restent incomplets."}
            {input.datasetExportState.missingAudioFiles.length > 0
              ? ` ${input.datasetExportState.missingAudioFiles.length} fichier(s) audio introuvable(s) dans le stockage local.`
              : ""}
            {input.datasetExportState.blockingReasons.length > 0
              ? ` Raisons: ${input.datasetExportState.blockingReasons.join(", ")}.`
              : ""}
          </p>
        )}
        {input.datasetExportState.status === "error" && (
          <p className="dataset-export-status error">
            {input.datasetExportState.message}
          </p>
        )}
      </div>
      <div className="recordings-list">
        <div className="recordings-list-header">
          <h2>Audio disponible</h2>
          <span>{input.recordings.length} WAV</span>
        </div>
        {input.recordings.length > 0 ? (
          input.recordings.map((recording) => (
            <a
              download={recording.fileName}
              href={recording.url}
              key={recording.fileName}
            >
              <span>{recording.fileName}</span>
              <strong>Télécharger</strong>
            </a>
          ))
        ) : (
          <div className="recordings-empty">
            <Database aria-hidden="true" size={20} />
            <div>
              <strong>Aucune prise en cache</strong>
              <p>
                Termine une prise pour voir les WAV conservés par le navigateur.
                Les exports directs restent aussi disponibles sur l'écran de fin
                de prise.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function WorkspaceArchivePanel(input: {
  readonly onDownload: () => Promise<number>;
  readonly onImport: (file: File) => Promise<number>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<
    | { readonly status: "idle" | "working" }
    | { readonly status: "done" | "error"; readonly message: string }
  >({ status: "idle" });

  async function downloadArchive() {
    setState({ status: "working" });
    try {
      const recordingCount = await input.onDownload();
      setState({
        status: "done",
        message: `Archive prête : ${recordingCount} WAV vérifié${recordingCount > 1 ? "s" : ""}.`,
      });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de créer l'archive du workspace.",
      });
    }
  }

  async function importArchive(file: File) {
    setState({ status: "working" });
    try {
      const recordingCount = await input.onImport(file);
      setState({
        status: "done",
        message: `Workspace restauré avec ${recordingCount} WAV vérifié${recordingCount > 1 ? "s" : ""}.`,
      });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de restaurer cette archive.",
      });
    }
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (file !== undefined) {
      void importArchive(file);
    }
  }

  const isWorking = state.status === "working";

  return (
    <section
      className="forced-alignment-panel workspace-archive-panel"
      data-testid="workspace-archive"
    >
      <div>
        <p className="soft-label">Sauvegarde complète</p>
        <strong>Workspace et WAV vérifiés</strong>
        <span>
          Exporte ou restaure la progression avec tous les fichiers audio
          référencés. Aucun fichier existant n'est remplacé.
        </span>
        {(state.status === "done" || state.status === "error") && (
          <span
            className={state.status === "error" ? "archive-status-error" : ""}
            role={state.status === "error" ? "alert" : "status"}
          >
            {state.message}
          </span>
        )}
      </div>
      <div className="workspace-archive-actions">
        <button
          className="folder-button compact"
          disabled={isWorking}
          onClick={() => void downloadArchive()}
          type="button"
        >
          <Download aria-hidden="true" size={17} />
          <span>{isWorking ? "Vérification…" : "Exporter l'archive"}</span>
        </button>
        <button
          className="quiet-button"
          disabled={isWorking}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Upload aria-hidden="true" size={17} />
          <span>Restaurer une archive</span>
        </button>
      </div>
      <input
        accept=".zip,application/zip"
        aria-label="Archive complète du workspace à restaurer"
        className="sr-only"
        data-testid="workspace-archive-input"
        onChange={handleFileSelection}
        ref={fileInputRef}
        type="file"
      />
    </section>
  );
}

export function ForcedAlignmentImport(input: {
  readonly onFile: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (file !== undefined) {
      input.onFile(file);
    }
  }

  return (
    <section className="forced-alignment-panel">
      <div>
        <p className="soft-label">Alignement acoustique</p>
        <strong>Remplacer l'estimation texte</strong>
        <span>
          Importe un JSON MFA/WhisperX, ou un paquet contenant plusieurs
          alignements pour calculer un consensus pondéré.
        </span>
      </div>
      <button
        className="folder-button compact"
        onClick={() => fileInputRef.current?.click()}
        type="button"
      >
        <Upload aria-hidden="true" size={17} />
        <span>Importer JSON</span>
      </button>
      <input
        accept=".json,application/json"
        aria-label="Fichier JSON d'alignement acoustique à importer"
        className="sr-only"
        onChange={handleFileSelection}
        ref={fileInputRef}
        type="file"
      />
    </section>
  );
}

export function Gap(input: {
  readonly label: string;
  readonly values: readonly string[];
}) {
  return (
    <div>
      <span>{input.label}</span>
      <strong>
        {input.values.length === 0
          ? "Complet"
          : input.values.slice(0, 4).join(", ")}
      </strong>
    </div>
  );
}
