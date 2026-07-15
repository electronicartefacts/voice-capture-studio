import { useEffect, useRef, type ChangeEvent, type DragEvent } from "react";
import { AudioLines, Download, FileAudio, Upload, X } from "lucide-react";
import type { ImportedMediaSegmentationResult } from "../../analysis/importedMediaSegmentation";
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
          Importe une vidéo ou un son. Seule la piste audio est décodée, puis
          Whisper détecte chaque mot et prépare les extraits WAV avec leurs
          repères temporels. Rien ne quitte cet appareil.
        </p>
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
        <p aria-live="polite" className="local-analysis-progress">
          {formatProgress(input.state.progress)}
        </p>
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
              <dt>Transcription</dt>
              <dd>{input.state.result.manifest.transcription.transcript}</dd>
            </div>
            <div>
              <dt>Découpe produite</dt>
              <dd>
                {input.state.result.manifest.words.length} WAV mot par mot ·
                manifeste JSON · timeline CSV
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
          bouton principal. Le premier passage charge les modèles locaux.
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
    : "Vérification des zones de parole…";
}

function formatFileSize(size: number): string {
  return size < 1_000_000
    ? `${Math.max(1, Math.round(size / 1000))} Ko`
    : `${(size / 1_000_000).toFixed(1)} Mo`;
}
