import { useEffect, useRef, type ChangeEvent, type DragEvent } from "react";
import { AudioLines, Download, FileAudio, Upload, X } from "lucide-react";
import type { ImportedMediaSegmentationResult } from "../../analysis/importedMediaSegmentation";
import { LEXICAL_SEGMENTATION_MAX_DURATION_MS } from "../../analysis/lexicalSegmentationPolicy";
import type { LocalAnalysisProgress } from "../../analysis/types";
import {
  formatLanguage,
  supportedLanguages,
  type LanguageCode,
} from "@shared/index";

export type LexicalSegmentationState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly progress: LocalAnalysisProgress }
  | {
      readonly status: "done";
      readonly result: ImportedMediaSegmentationResult;
      readonly downloadUrl: string;
    }
  | { readonly status: "error"; readonly message: string };

export function LexicalSegmentationPanel(input: {
  readonly file: File | null;
  readonly language: LanguageCode;
  readonly onCancel: () => void;
  readonly onClear: () => void;
  readonly onFile: (file: File) => void;
  readonly onLanguageChange: (language: LanguageCode) => void;
  readonly state: LexicalSegmentationState;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (input.file === null) {
      fileInputRef.current?.focus({ preventScroll: true });
    }
  }, [input.file]);

  function handleSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file !== undefined) input.onFile(file);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file !== undefined) input.onFile(file);
  }

  return (
    <section
      className="local-analysis-panel lexical-segmentation-panel"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="local-analysis-heading">
        <p className="soft-label">Découpe lexicale locale</p>
        <p>
          Importe une vidéo ou un son, parlé ou chanté. Le studio reconnaît la
          scène et choisit automatiquement une analyse rapide, vérifiée ou
          approfondie. Rien ne quitte cet appareil.
        </p>
        <details>
          <summary>Ce que l'analyse peut comparer</summary>
          <p>
            L'original reste toujours la référence. Sur un mix complexe, le
            studio ajoute une voix centrale, une séparation spectrale et un
            masque des passages instrumentaux, puis conserve seulement les mots
            soutenus par plusieurs preuves. La timeline et les WAV exportés ne
            sont jamais déplacés ni filtrés.
          </p>
        </details>
      </div>

      <input
        accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.mp4,.m4v,.mov,.webm,.ogv"
        className="sr-only"
        onChange={handleSelection}
        ref={fileInputRef}
        type="file"
      />

      <div className="simple-form">
        <label>
          <span>Langue parlée</span>
          <select
            disabled={input.state.status === "running"}
            onChange={(event) =>
              input.onLanguageChange(event.target.value as LanguageCode)
            }
            value={input.language}
          >
            {supportedLanguages.map((language) => (
              <option key={language.code} value={language.code}>
                {formatLanguage(language.code)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {input.file === null ? (
        <button
          className="folder-button"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Upload aria-hidden="true" size={18} />
          <span>Importer une vidéo ou un audio</span>
        </button>
      ) : (
        <div className="file-receipt">
          <FileAudio aria-hidden="true" size={18} />
          <div>
            <strong>{input.file.name}</strong>
            <span>{formatFileSize(input.file.size)} · source locale</span>
          </div>
          {input.state.status !== "running" && (
            <button
              aria-label="Retirer le média"
              className="quiet-button standalone"
              onClick={input.onClear}
              type="button"
            >
              <X aria-hidden="true" size={16} />
            </button>
          )}
        </div>
      )}

      {input.state.status === "running" && (
        <>
          <p className="local-analysis-progress" aria-live="polite">
            {formatProgress(input.state.progress)}
          </p>
          <button
            className="quiet-button standalone"
            onClick={input.onCancel}
            type="button"
          >
            Annuler l'analyse
          </button>
        </>
      )}

      {input.state.status === "error" && (
        <div className="local-analysis-error" role="alert">
          <p>{input.state.message}</p>
        </div>
      )}

      {input.state.status === "done" && (
        <>
          <dl>
            <div>
              <dt>Paroles à vérifier</dt>
              <dd>{input.state.result.manifest.transcription.transcript}</dd>
            </div>
            <div>
              <dt>Fiabilité</dt>
              <dd>
                {formatReliability(
                  input.state.result.manifest.transcription.quality.status,
                )}{" "}
                ·{" "}
                {Math.round(
                  input.state.result.manifest.transcription.quality
                    .speechOverlapRate * 100,
                )}
                % de soutien vocal · profil{" "}
                {formatProfile(input.state.result.manifest.processing.profile)}
                {" · "}
                {Math.round(
                  input.state.result.manifest.transcription.quality
                    .meanWordConfidence * 100,
                )}
                % de confiance croisée
              </dd>
            </div>
            <div>
              <dt>Découpe produite</dt>
              <dd>
                {input.state.result.manifest.words.length} WAV mot par mot ·
                manifeste JSON · timeline CSV ·{" "}
                {formatPasses(input.state.result)}
              </dd>
            </div>
            <div>
              <dt>Stratégie automatique</dt>
              <dd>
                {formatScene(
                  input.state.result.manifest.processing.adaptiveStrategy.scene,
                )}{" "}
                · profondeur{" "}
                {formatDepth(
                  input.state.result.manifest.processing.adaptiveStrategy.depth,
                )}{" "}
                · budget de{" "}
                {
                  input.state.result.manifest.processing.adaptiveStrategy
                    .hypothesisBudget
                }{" "}
                hypothèse
                {input.state.result.manifest.processing.adaptiveStrategy
                  .hypothesisBudget > 1
                  ? "s"
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Adaptation à l'appareil</dt>
              <dd>
                {formatRuntimeClass(
                  input.state.result.manifest.processing.adaptiveStrategy
                    .runtimeClass,
                  input.state.result.manifest.processing.adaptiveStrategy
                    .scoutRealtimeFactor,
                  input.state.result.manifest.processing.adaptiveStrategy
                    .verificationRealtimeFactor,
                )}
              </dd>
            </div>
          </dl>
          <a
            className="download-action"
            download={input.state.result.fileName}
            href={input.state.downloadUrl}
          >
            <Download aria-hidden="true" size={18} />
            <span>Télécharger l'audio segmenté</span>
          </a>
        </>
      )}

      {input.file !== null && input.state.status === "idle" && (
        <p className="action-hint">
          <AudioLines aria-hidden="true" size={16} /> Lance la découpe avec le
          bouton principal. Le premier passage charge les modèles locaux. Limite
          de {LEXICAL_SEGMENTATION_MAX_DURATION_MS / 60_000} minutes pour
          préserver la mémoire de l'appareil.
        </p>
      )}
    </section>
  );
}

function formatProgress(progress: LocalAnalysisProgress): string {
  if (progress.stage === "loading-model") {
    return progress.progressPercent === 0
      ? "Préparation des modèles locaux…"
      : `Chargement des modèles locaux… ${progress.progressPercent}%`;
  }
  return progress.stage === "transcribing"
    ? "Détection et horodatage des mots…"
    : progress.stage === "detecting-speech"
      ? "Vérification des zones vocales…"
      : progress.stage === "separating-vocals"
        ? `Séparation spectrale voix / accompagnement… ${progress.progressPercent}%`
        : progress.stage === "enhancing-vocals"
          ? "Comparaison des écoutes locale et musicale…"
          : "Contrôle de fiabilité avant export…";
}

function formatPasses(result: ImportedMediaSegmentationResult): string {
  const processing = result.manifest.processing;

  const passes = `${processing.transcriptionPasses} passage${processing.transcriptionPasses > 1 ? "s" : ""} local${processing.transcriptionPasses > 1 ? "aux" : ""}`;
  const consensus = processing.consensus;
  const maskedPasses = processing.hypotheses.filter(
    ({ activityMaskApplied }) => activityMaskApplied,
  ).length;
  const targeting =
    maskedPasses === 0
      ? ""
      : ` · ${maskedPasses} écoute${maskedPasses > 1 ? "s" : ""} ciblée${maskedPasses > 1 ? "s" : ""}`;
  const arbitration = ` · ${consensus.recoveredWordCount} récupéré${consensus.recoveredWordCount > 1 ? "s" : ""}, ${consensus.rejectedSingletonCount} isolé${consensus.rejectedSingletonCount > 1 ? "s" : ""} écarté${consensus.rejectedSingletonCount > 1 ? "s" : ""}`;
  if (processing.selectedSignal === "spectral_vocal") {
    return `${passes} · séparation spectrale retenue${targeting}${arbitration}`;
  }
  if (processing.selectedSignal === "vocal_focus") {
    return `${passes} · isolation centrale retenue${targeting}${arbitration}`;
  }
  return `${passes} · consensus sur l'original${targeting}${arbitration}`;
}

function formatScene(
  scene: ImportedMediaSegmentationResult["manifest"]["processing"]["adaptiveStrategy"]["scene"],
): string {
  if (scene === "clean_voice") return "Voix nette";
  if (scene === "constrained_voice") return "Voix sous contrainte";
  if (scene === "sung_voice") return "Voix chantée";
  if (scene === "music_mix") return "Mix musical";
  return "Scène incertaine";
}

function formatDepth(
  depth: ImportedMediaSegmentationResult["manifest"]["processing"]["adaptiveStrategy"]["depth"],
): string {
  if (depth === "fast") return "rapide";
  if (depth === "verified") return "vérifiée";
  return "approfondie";
}

function formatRuntimeClass(
  runtimeClass: ImportedMediaSegmentationResult["manifest"]["processing"]["adaptiveStrategy"]["runtimeClass"],
  scoutRealtimeFactor: number | null,
  verificationRealtimeFactor: number | null,
): string {
  const label =
    runtimeClass === "fast"
      ? "Traitement rapide"
      : runtimeClass === "moderate"
        ? "Traitement modéré"
        : runtimeClass === "constrained"
          ? "Appareil préservé"
          : "Vitesse non mesurée";

  const observations = [
    scoutRealtimeFactor === null
      ? null
      : `éclaireur ${formatRealtimeFactor(scoutRealtimeFactor)}`,
    verificationRealtimeFactor === null
      ? null
      : `renfort ${formatRealtimeFactor(verificationRealtimeFactor)}`,
  ].filter((value): value is string => value !== null);

  return observations.length === 0
    ? label
    : `${label} · ${observations.join(" · ")}`;
}

function formatRealtimeFactor(value: number): string {
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}× la durée`;
}

function formatProfile(profile: "balanced" | "compatible"): string {
  return profile === "balanced" ? "équilibré" : "compatible";
}

function formatReliability(status: "review" | "insufficient"): string {
  return status === "review"
    ? "Contrôle humain recommandé"
    : "Résultat candidat, non confirmé";
}

function formatFileSize(size: number): string {
  return size < 1_000_000
    ? `${Math.max(1, Math.round(size / 1000))} Ko`
    : `${(size / 1_000_000).toFixed(1)} Mo`;
}
