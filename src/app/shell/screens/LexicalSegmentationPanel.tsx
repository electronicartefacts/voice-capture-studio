import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type SyntheticEvent,
} from "react";
import { AudioLines, Download, FileAudio, Play, Upload, X } from "lucide-react";
import type {
  ImportedMediaSegmentationResult,
  WordAudioSegment,
} from "../../analysis/importedMediaSegmentation";
import { LEXICAL_SEGMENTATION_MAX_DURATION_MS } from "../../analysis/lexicalSegmentationPolicy";
import type { LocalAnalysisProgress } from "../../analysis/types";
import {
  formatLanguage,
  supportedLanguages,
  type LanguageCode,
} from "@shared/index";
import "./lexical-segmentation.css";

const WORD_REVIEW_PAGE_SIZE = 40;

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
          {input.file !== null && (
            <LexicalWordReview
              file={input.file}
              key={`${input.file.name}:${input.file.lastModified}`}
              words={input.state.result.manifest.words}
            />
          )}
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

function LexicalWordReview(input: {
  readonly file: File;
  readonly words: readonly WordAudioSegment[];
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewRequestRef = useRef(0);
  const [page, setPage] = useState(0);
  const [previewEndSeconds, setPreviewEndSeconds] = useState<number | null>(
    null,
  );
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [status, setStatus] = useState(
    "Choisis un mot pour l'écouter dans son contexte.",
  );
  const pageCount = Math.max(
    1,
    Math.ceil(input.words.length / WORD_REVIEW_PAGE_SIZE),
  );
  const visibleWords = input.words.slice(
    page * WORD_REVIEW_PAGE_SIZE,
    (page + 1) * WORD_REVIEW_PAGE_SIZE,
  );

  useEffect(
    () => () => {
      if (sourceUrl !== null) URL.revokeObjectURL(sourceUrl);
    },
    [sourceUrl],
  );

  function handleToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open && sourceUrl === null) {
      setSourceUrl(URL.createObjectURL(input.file));
    } else if (!event.currentTarget.open) {
      previewRequestRef.current += 1;
      audioRef.current?.pause();
      setPreviewEndSeconds(null);
      setSourceUrl(null);
      setStatus("Choisis un mot pour l'écouter dans son contexte.");
    }
  }

  function changePage(nextPage: number) {
    previewRequestRef.current += 1;
    audioRef.current?.pause();
    setPreviewEndSeconds(null);
    setPage(Math.max(0, Math.min(pageCount - 1, nextPage)));
  }

  function previewWord(word: WordAudioSegment) {
    const audio = audioRef.current;
    if (audio === null) return;

    previewRequestRef.current += 1;
    const requestId = previewRequestRef.current;
    const startSeconds = word.clipStartMs / 1_000;
    const endSeconds = word.clipEndMs / 1_000;
    const startPlayback = () => {
      if (previewRequestRef.current !== requestId) return;

      audio.pause();
      audio.currentTime = startSeconds;
      setPreviewEndSeconds(endSeconds);
      setStatus(`Lecture de « ${word.word} » avec son contexte.`);
      void audio.play().catch(() => {
        setPreviewEndSeconds(null);
        setStatus(
          "L'aperçu du média n'est pas lisible ici. Les WAV restent disponibles dans le ZIP.",
        );
      });
    };

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      startPlayback();
    } else {
      setStatus("Préparation de l'aperçu local…");
      audio.addEventListener("loadedmetadata", startPlayback, { once: true });
      audio.load();
    }
  }

  function stopAtPreviewBoundary() {
    const audio = audioRef.current;
    if (
      audio !== null &&
      previewEndSeconds !== null &&
      audio.currentTime >= previewEndSeconds
    ) {
      audio.pause();
      setPreviewEndSeconds(null);
    }
  }

  return (
    <details className="lexical-word-review" onToggle={handleToggle}>
      <summary>
        Vérifier et écouter les {input.words.length} mots détectés
      </summary>
      {sourceUrl !== null && (
        <div className="lexical-word-review-content">
          <p aria-live="polite" className="action-hint">
            {status}
          </p>
          <audio
            aria-label="Aperçu du média original"
            controls
            onEnded={() => setPreviewEndSeconds(null)}
            onTimeUpdate={stopAtPreviewBoundary}
            preload="metadata"
            ref={audioRef}
            src={sourceUrl}
          >
            Ce navigateur ne peut pas lire l'aperçu du média.
          </audio>
          <div className="lexical-word-grid">
            {visibleWords.map((word) => (
              <button
                aria-label={`Écouter ${word.word}, de ${formatTimestamp(word.startMs)} à ${formatTimestamp(word.endMs)}`}
                className="lexical-word-preview"
                key={`${word.index}:${word.startMs}:${word.word}`}
                onClick={() => previewWord(word)}
                type="button"
              >
                <Play aria-hidden="true" size={15} />
                <span>
                  <strong>{word.word}</strong>
                  <small>
                    {formatTimestamp(word.startMs)}–
                    {formatTimestamp(word.endMs)} · {formatEvidence(word)}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {pageCount > 1 && (
            <nav className="lexical-word-pages" aria-label="Pages de mots">
              <button
                className="quiet-button standalone"
                disabled={page === 0}
                onClick={() => changePage(page - 1)}
                type="button"
              >
                Précédents
              </button>
              <span>
                Page {page + 1} sur {pageCount}
              </span>
              <button
                className="quiet-button standalone"
                disabled={page + 1 >= pageCount}
                onClick={() => changePage(page + 1)}
                type="button"
              >
                Suivants
              </button>
            </nav>
          )}
        </div>
      )}
    </details>
  );
}

function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, milliseconds) / 1_000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}

function formatEvidence(word: WordAudioSegment): string {
  if (word.evidence === "multi_pass_consensus") {
    return `${word.consensusVotes} écoutes concordantes`;
  }
  if (word.evidence === "speech_vad") return "zone vocale confirmée";
  return "candidat à contrôler";
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
