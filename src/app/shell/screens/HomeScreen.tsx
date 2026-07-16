import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type RefObject,
} from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Download,
  FileText,
  FolderOpen,
  HardDrive,
  Music,
  SlidersHorizontal,
  Timer,
  Trash2,
  Upload,
  UserPlus,
  Volume2,
} from "lucide-react";
import type { LocalCorpusMode, LocalTextCorpusSummary } from "@domains/corpus";
import type { CoverageSummary } from "@domains/coverage";
import type { SpeakerId, SpeakerProfile } from "@domains/speakers";
import {
  DEFAULT_CAPTURE_PROFILE,
  type CaptureProfile,
  type WorkspaceDurability,
} from "@domains/workspace";
import {
  formatLanguage,
  supportedLanguages,
  type LanguageCode,
} from "@shared/index";
import type {
  RuntimeCheck,
  RuntimeDiagnostics,
} from "../../system/runtimeDiagnostics";
import {
  captureModeOptions,
  formatDatasetReadiness,
  formatDurationSeconds,
  formatPercent,
  formatRuntimeStatus,
  getCaptureModeContent,
} from "../helpers";
import {
  normalizeSpeakerLanguages,
  type CreateSpeakerInput,
} from "../speakerProfiles";
import type { BackingTrack, CaptureMode } from "../types";
import type { DubbingMediaSource } from "../types";
import type { LexicalSegmentationState } from "./LexicalSegmentationPanel";
import {
  formatCaptureDurationLimit,
  FREE_CAPTURE_MAX_DURATION_MS,
} from "../../recording/captureLimits";
import {
  beginLoadingWave,
  finishLoadingWave,
} from "../../rendering/loadingWaveSignal";

const LexicalSegmentationPanel = lazy(() =>
  import("./LexicalSegmentationPanel").then((module) => ({
    default: module.LexicalSegmentationPanel,
  })),
);
const DubbingMediaPanel = lazy(() =>
  import("./DubbingMediaPanel").then((module) => ({
    default: module.DubbingMediaPanel,
  })),
);

export function HomeScreen(input: {
  readonly backingAudioRef: RefObject<HTMLAudioElement | null>;
  readonly backingTrack: BackingTrack | null;
  readonly backingTrackLoop: boolean;
  readonly backingTrackVolume: number;
  readonly captureProfile: CaptureProfile | undefined;
  readonly captureMode: CaptureMode;
  readonly continuousLyricsEnabled: boolean;
  readonly coverage: CoverageSummary | null;
  readonly customCorpusSourceName: string | null;
  readonly customCorpusText: string;
  readonly diagnostics: RuntimeDiagnostics;
  readonly dubbingCueSeconds: number;
  readonly dubbingMedia: DubbingMediaSource | null;
  readonly dubbingMediaMuted: boolean;
  readonly folderName: string | null;
  readonly language: LanguageCode;
  readonly localCorpusSummary: LocalTextCorpusSummary | null;
  readonly lexicalSegmentationFile: File | null;
  readonly lexicalSegmentationState: LexicalSegmentationState;
  readonly message: string;
  readonly isDirectCaptureStarting: boolean;
  readonly onBackingTrackChange: (file: File) => void;
  readonly onBackingTrackClear: () => void;
  readonly onBackingTrackLoopChange: (loop: boolean) => void;
  readonly onBackingTrackVolumeChange: (volume: number) => void;
  readonly onContinuousLyricsChange: (enabled: boolean) => void;
  readonly onChooseFolder: () => void;
  readonly onCustomCorpusFile: (file: File) => void;
  readonly onCustomCorpusTextChange: (text: string) => void;
  readonly onDubbingCueSecondsChange: (seconds: number) => void;
  readonly onDubbingMediaClear: () => void;
  readonly onDubbingMediaMutedChange: (muted: boolean) => void;
  readonly onDubbingVideoChange: (file: File) => void;
  readonly onDubbingYouTubeUrl: (url: string) => void;
  readonly onLanguageChange: (language: LanguageCode) => void;
  readonly onLexicalSegmentationCancel: () => void;
  readonly onLexicalSegmentationClear: () => void;
  readonly onLexicalSegmentationFile: (file: File) => void;
  readonly onProfileChange: (profile: CaptureProfile) => void;
  readonly onRefreshDiagnostics: () => void;
  readonly onSpeakerChange: (speakerId: SpeakerId) => void;
  readonly onSpeakerCreate: (speaker: CreateSpeakerInput) => Promise<boolean>;
  readonly onStart: () => void;
  readonly savedSessions: number;
  readonly speakers: readonly SpeakerProfile[];
  readonly selectedSpeaker: SpeakerProfile | undefined;
  readonly selectedSpeakerId: SpeakerId;
  readonly workspaceBackupFileName: string | null;
  readonly workspaceBackupUrl: string | null;
  readonly workspaceDurability: WorkspaceDurability | null;
}) {
  const modeContent = getCaptureModeContent(input.captureMode);
  const exportStorageRef = useRef<HTMLElement>(null);
  const localCorpusReady =
    input.captureMode === "lexical-segmentation" ||
    input.captureMode === "free" ||
    input.captureMode === "training" ||
    input.localCorpusSummary !== null;
  const recordingReady =
    input.captureMode === "lexical-segmentation"
      ? input.lexicalSegmentationFile !== null
      : input.diagnostics.canRecord && localCorpusReady;
  const folderSelected = input.folderName !== null;
  const setupLabel =
    input.captureMode === "lexical-segmentation"
      ? input.lexicalSegmentationFile === null
        ? "Média attendu"
        : input.lexicalSegmentationState.status === "running"
          ? "Analyse locale"
          : "Prêt"
      : !input.diagnostics.canRecord
        ? "Micro à corriger"
        : !localCorpusReady
          ? "Texte attendu"
          : folderSelected
            ? "Prêt"
            : "Export manuel";
  const setupTone = recordingReady
    ? folderSelected
      ? "ready"
      : "limited"
    : "blocked";
  const coveragePercent = input.coverage?.percent ?? 0;
  const readiness = formatDatasetReadiness(input.coverage?.datasetReadiness);
  const storageStatus = input.folderName ?? "Exports à télécharger";
  const corpusStatus =
    input.captureMode === "lexical-segmentation"
      ? (input.lexicalSegmentationFile?.name ?? "Média attendu")
      : input.captureMode === "free"
        ? "Prise continue"
        : input.captureMode === "training"
          ? readiness
          : input.localCorpusSummary === null
            ? "Texte local attendu"
            : `${input.localCorpusSummary.promptCount} segment${
                input.localCorpusSummary.promptCount > 1 ? "s" : ""
              }`;
  const corpusRecommendation =
    input.captureMode === "lexical-segmentation"
      ? "La piste audio est transcrite et découpée localement, sans conserver l'image."
      : input.captureMode === "free"
        ? `Aucun corpus : une prise continue peut durer jusqu'à ${formatCaptureDurationLimit(FREE_CAPTURE_MAX_DURATION_MS)}.`
        : input.captureMode === "training"
          ? (input.coverage?.nextRecommendation ??
            "Commence par un silence de pièce, puis deux prises neutres.")
          : input.localCorpusSummary === null
            ? "Colle un script ou charge un fichier texte."
            : input.captureMode === "dubbing"
              ? `${input.localCorpusSummary.wordCount} mots · ${
                  input.localCorpusSummary.timedPromptCount > 0
                    ? `${input.localCorpusSummary.timedPromptCount} repère${input.localCorpusSummary.timedPromptCount > 1 ? "s" : ""} synchronisé${input.localCorpusSummary.timedPromptCount > 1 ? "s" : ""}`
                    : "départ manuel ou repère global"
                }.`
              : `${input.localCorpusSummary.wordCount} mots${
                  input.backingTrack === null
                    ? " · support audio optionnel"
                    : ` · retour ${input.backingTrack.name}`
                }.`;

  return (
    <div className="home-card">
      <section className="lab-launcher" aria-labelledby="home-title">
        <div className="lab-launcher-copy">
          <p className="soft-label">
            {modeContent.title} · {modeContent.pill}
          </p>
          <h1 id="home-title">
            <strong>{modeContent.headlineLead}</strong>
          </h1>
          <p>{modeContent.headlineDetail}</p>
        </div>
        <button
          className="launch-button is-hero lab-launch-button"
          disabled={
            (input.captureMode !== "lexical-segmentation" &&
              !input.diagnostics.canRecord) ||
            !localCorpusReady ||
            (input.captureMode === "lexical-segmentation" &&
              input.lexicalSegmentationFile === null) ||
            input.lexicalSegmentationState.status === "running" ||
            input.isDirectCaptureStarting
          }
          onClick={input.onStart}
          type="button"
        >
          <span className="launch-record-dot" aria-hidden="true" />
          <span>
            {input.isDirectCaptureStarting
              ? "La capture démarre…"
              : input.lexicalSegmentationState.status === "running"
                ? "Découpe en cours…"
                : input.captureMode !== "lexical-segmentation" &&
                    !input.diagnostics.canRecord
                  ? "Enregistrement indisponible"
                  : !localCorpusReady
                    ? "Ajouter un texte"
                    : modeContent.cta}
          </span>
        </button>
      </section>

      <section className="home-workbench" aria-label="Réglages de la session">
        <section className="lab-overview-card">
          <div className="workbench-header">
            <div>
              <p className="soft-label">{modeContent.kicker}</p>
              <h2>{modeContent.workbenchTitle}</h2>
            </div>
            <span className={`setup-pill is-${setupTone}`}>
              <BadgeCheck aria-hidden="true" size={16} />
              {setupLabel}
            </span>
          </div>

          <p className="plain-text" aria-live="polite">
            {input.message}
          </p>

          <div className="status-strip" aria-label="État de la session">
            <div>
              <HardDrive aria-hidden="true" size={18} />
              <span>{storageStatus}</span>
            </div>
            <div>
              <Timer aria-hidden="true" size={18} />
              <span>
                {input.savedSessions} session
                {input.savedSessions > 1 ? "s" : ""}
              </span>
            </div>
            <div>
              <Check aria-hidden="true" size={18} />
              <span>
                {input.captureMode === "free"
                  ? "Capture libre"
                  : input.captureMode === "lexical-segmentation"
                    ? `${input.lexicalSegmentationState.status === "done" ? input.lexicalSegmentationState.result.manifest.words.length : 0} mots découpés`
                    : input.captureMode === "training"
                      ? `${formatPercent(coveragePercent)} couvert`
                      : corpusStatus}
              </span>
            </div>
          </div>
        </section>

        {input.captureMode === "training" && (
          <div
            aria-label="Suivi de session ML"
            className="coverage-console ml-session-dashboard"
          >
            <div
              aria-label={`Couverture ${formatPercent(coveragePercent)}`}
              className="coverage-ring"
              style={
                {
                  "--coverage": `${Math.max(0, Math.min(100, coveragePercent))}%`,
                } as CSSProperties
              }
            >
              <span>{formatPercent(coveragePercent)}</span>
            </div>
            <div>
              <strong>{corpusStatus}</strong>
              <p>{corpusRecommendation}</p>
            </div>
          </div>
        )}

        {input.captureMode !== "training" &&
          input.captureMode !== "free" &&
          input.captureMode !== "lexical-segmentation" && (
            <LocalCorpusEditor
              mode={input.captureMode}
              onFile={input.onCustomCorpusFile}
              onTextChange={input.onCustomCorpusTextChange}
              sourceName={input.customCorpusSourceName}
              summary={input.localCorpusSummary}
              text={input.customCorpusText}
            />
          )}

        {input.captureMode === "lexical-segmentation" && (
          <Suspense
            fallback={
              <ModePanelLoading
                id="mode-panel:lexical"
                label="Préparation de la découpe lexicale"
              />
            }
          >
            <LexicalSegmentationPanel
              file={input.lexicalSegmentationFile}
              language={input.language}
              onClear={input.onLexicalSegmentationClear}
              onCancel={input.onLexicalSegmentationCancel}
              onFile={input.onLexicalSegmentationFile}
              onLanguageChange={input.onLanguageChange}
              state={input.lexicalSegmentationState}
            />
          </Suspense>
        )}

        {input.captureMode === "dubbing" && (
          <Suspense
            fallback={
              <ModePanelLoading
                id="mode-panel:dubbing"
                label="Préparation du doublage"
              />
            }
          >
            <DubbingMediaPanel
              cueSeconds={input.dubbingCueSeconds}
              muted={input.dubbingMediaMuted}
              onClear={input.onDubbingMediaClear}
              onCueSecondsChange={input.onDubbingCueSecondsChange}
              onLocalVideo={input.onDubbingVideoChange}
              onMutedChange={input.onDubbingMediaMutedChange}
              onYouTubeUrl={input.onDubbingYouTubeUrl}
              source={input.dubbingMedia}
            />
          </Suspense>
        )}

        {input.captureMode === "mastering" && (
          <>
            <BackingTrackPanel
              audioRef={input.backingAudioRef}
              loop={input.backingTrackLoop}
              onChange={input.onBackingTrackChange}
              onClear={input.onBackingTrackClear}
              onLoopChange={input.onBackingTrackLoopChange}
              onVolumeChange={input.onBackingTrackVolumeChange}
              track={input.backingTrack}
              volume={input.backingTrackVolume}
            />
            {input.localCorpusSummary !== null && (
              <label className="session-option is-active">
                <input
                  checked={input.continuousLyricsEnabled}
                  onChange={(event) =>
                    input.onContinuousLyricsChange(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Paroles complètes en une prise</strong>
                  <small>Garde le micro ouvert pendant toute la chanson.</small>
                </span>
              </label>
            )}
          </>
        )}

        {input.captureMode !== "lexical-segmentation" && (
          <VoiceManager
            language={input.language}
            onLanguageChange={input.onLanguageChange}
            onSpeakerChange={input.onSpeakerChange}
            onSpeakerCreate={input.onSpeakerCreate}
            selectedSpeaker={input.selectedSpeaker}
            selectedSpeakerId={input.selectedSpeakerId}
            speakers={input.speakers}
          />
        )}

        {input.captureMode !== "lexical-segmentation" &&
          input.diagnostics.status !== "ready" && (
            <SystemHealthPanel
              diagnostics={input.diagnostics}
              onRefresh={input.onRefreshDiagnostics}
            />
          )}

        {input.workspaceDurability === "memory-only" &&
          input.workspaceBackupUrl !== null &&
          input.workspaceBackupFileName !== null && (
            <div className="workspace-backup">
              <div>
                <strong>Workspace temporaire</strong>
                <p>Télécharge ce manifeste avant de fermer l'onglet.</p>
              </div>
              <a
                className="download-action"
                download={input.workspaceBackupFileName}
                href={input.workspaceBackupUrl}
              >
                <Download aria-hidden="true" size={18} />
                <span>Télécharger le workspace</span>
              </a>
            </div>
          )}

        {input.captureMode !== "lexical-segmentation" &&
          input.captureProfile !== undefined && (
            <details className="capture-profile-details">
              <summary>
                <span>
                  <SlidersHorizontal aria-hidden="true" size={18} />
                  <strong>Profil audio</strong>
                </span>
                <em>{formatCaptureProfileStatus(input.captureProfile)}</em>
              </summary>
              <CaptureProfileEditor
                onChange={input.onProfileChange}
                profile={input.captureProfile}
              />
            </details>
          )}

        {input.captureMode !== "lexical-segmentation" && (
          <section
            aria-labelledby="export-storage-title"
            className="voice-manager"
            id="export-storage"
            ref={exportStorageRef}
            tabIndex={-1}
          >
            <h2 id="export-storage-title">Export et stockage</h2>
            <div className="primary-actions">
              <button
                className="folder-button"
                onClick={input.onChooseFolder}
                type="button"
              >
                <FolderOpen aria-hidden="true" size={19} />
                <span>{input.folderName ?? "Choisir un dossier d'export"}</span>
              </button>
            </div>
            <p className={`action-hint${folderSelected ? " is-ready" : ""}`}>
              {folderSelected
                ? `Les WAV et JSON seront enregistrés dans ${input.folderName}.`
                : "Sans dossier local, garde les boutons WAV et JSON après chaque prise."}
            </p>
          </section>
        )}
      </section>
    </div>
  );
}

function ModePanelLoading(input: {
  readonly id: string;
  readonly label: string;
}) {
  useEffect(() => {
    beginLoadingWave(input.id, input.label);
    return () => finishLoadingWave(input.id);
  }, [input.id, input.label]);

  return (
    <div className="local-analysis-panel" role="status">
      <p className="local-analysis-progress">{input.label}…</p>
    </div>
  );
}

export function VoiceManager(input: {
  readonly language: LanguageCode;
  readonly onLanguageChange: (language: LanguageCode) => void;
  readonly onSpeakerChange: (speakerId: SpeakerId) => void;
  readonly onSpeakerCreate: (speaker: CreateSpeakerInput) => Promise<boolean>;
  readonly selectedSpeaker: SpeakerProfile | undefined;
  readonly selectedSpeakerId: SpeakerId;
  readonly speakers: readonly SpeakerProfile[];
}) {
  const [draftName, setDraftName] = useState("");
  const [draftLanguages, setDraftLanguages] = useState<readonly LanguageCode[]>(
    [input.language],
  );
  const [isCreating, setIsCreating] = useState(false);
  const languageOptions = normalizeSpeakerLanguages([
    input.language,
    ...(input.selectedSpeaker?.supportedLanguages ?? []),
  ]);
  const nextDefaultName = `Voix ${input.speakers.length + 1}`;

  function toggleDraftLanguage(language: LanguageCode) {
    setDraftLanguages((current) => {
      if (!current.includes(language)) {
        return [...current, language];
      }

      return current.length > 1
        ? current.filter((item) => item !== language)
        : current;
    });
  }

  async function submitSpeaker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isCreating) {
      return;
    }

    setIsCreating(true);

    try {
      const created = await input.onSpeakerCreate({
        displayName: draftName.trim() || nextDefaultName,
        languages: draftLanguages,
      });

      if (created) {
        setDraftName("");
        setDraftLanguages([input.language]);
      }
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <section className="voice-manager" aria-label="Voix">
      <div className="simple-form voice-selectors">
        <label>
          <span>Voix</span>
          <select
            value={input.selectedSpeakerId}
            onChange={(event) =>
              input.onSpeakerChange(event.target.value as SpeakerId)
            }
          >
            {input.speakers.map((speaker) => (
              <option key={speaker.id} value={speaker.id}>
                {speaker.displayName}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Langue</span>
          <select
            value={input.language}
            onChange={(event) =>
              input.onLanguageChange(event.target.value as LanguageCode)
            }
          >
            {languageOptions.map((language) => (
              <option key={language} value={language}>
                {formatLanguage(language)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <details className="voice-create-details">
        <summary>
          <UserPlus aria-hidden="true" size={17} />
          <span>Nouvelle voix</span>
        </summary>
        <form className="voice-create" onSubmit={submitSpeaker}>
          <label className="voice-name-field">
            <span>Nom</span>
            <input
              disabled={isCreating}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder={nextDefaultName}
              type="text"
              value={draftName}
            />
          </label>

          <div className="voice-language-toggles" aria-label="Langues">
            {supportedLanguages.map((language) => (
              <label className="language-toggle" key={language.code}>
                <input
                  checked={draftLanguages.includes(language.code)}
                  disabled={isCreating}
                  onChange={() => toggleDraftLanguage(language.code)}
                  type="checkbox"
                />
                <span>{formatLanguage(language.code)}</span>
              </label>
            ))}
          </div>

          <button
            className="folder-button compact voice-create-button"
            disabled={isCreating}
            type="submit"
          >
            <UserPlus aria-hidden="true" size={17} />
            <span>{isCreating ? "Création" : "Créer"}</span>
          </button>
        </form>
      </details>
    </section>
  );
}

export function CaptureModeSelector(input: {
  readonly disabled?: boolean;
  readonly mode: CaptureMode;
  readonly onChange: (mode: CaptureMode) => void;
}) {
  return (
    <div className="mode-dial" role="group" aria-label="Modes de l'instrument">
      {captureModeOptions.map((option) => {
        const Icon = option.icon;

        return (
          <button
            aria-label={option.title}
            aria-pressed={input.mode === option.mode}
            className={`capture-mode-option${input.mode === option.mode ? " is-active" : ""}`}
            disabled={input.disabled}
            key={option.mode}
            onClick={() => input.onChange(option.mode)}
            title={option.title}
            type="button"
          >
            <Icon aria-hidden="true" size={18} />
            <span aria-hidden="true" className="mode-option-label">
              {option.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function LocalCorpusEditor(input: {
  readonly mode: LocalCorpusMode;
  readonly onFile: (file: File) => void;
  readonly onTextChange: (text: string) => void;
  readonly sourceName: string | null;
  readonly summary: LocalTextCorpusSummary | null;
  readonly text: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modeLabel =
    input.mode === "dubbing" ? "Script" : "Texte d'interprétation";

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (file !== undefined) {
      input.onFile(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];

    if (file !== undefined) {
      input.onFile(file);
    }
  }

  return (
    <section
      className="local-corpus-panel"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="local-corpus-header">
        <div>
          <p className="soft-label">Corpus local</p>
          <strong>{modeLabel}</strong>
        </div>
        <button
          className="folder-button compact"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Upload aria-hidden="true" size={17} />
          <span>Charger un texte</span>
        </button>
        <input
          accept=".txt,.md,.srt,.vtt,text/plain,text/markdown"
          className="sr-only"
          onChange={handleFileSelection}
          ref={fileInputRef}
          type="file"
        />
      </div>
      <textarea
        aria-label="Texte du corpus local"
        onChange={(event) => input.onTextChange(event.target.value)}
        placeholder={
          input.mode === "dubbing"
            ? "Colle les répliques ou glisse un fichier texte."
            : "Colle le texte à enregistrer sur la musique."
        }
        rows={8}
        value={input.text}
      />
      <div className="local-corpus-footer">
        <span>
          <FileText aria-hidden="true" size={16} />
          {input.summary === null
            ? "Aucun segment prêt"
            : `${input.summary.promptCount} segment${
                input.summary.promptCount > 1 ? "s" : ""
              } / ${input.summary.wordCount} mots`}
        </span>
        {input.sourceName !== null && <strong>{input.sourceName}</strong>}
      </div>
    </section>
  );
}

export function BackingTrackPanel(input: {
  readonly audioRef: RefObject<HTMLAudioElement | null>;
  readonly loop: boolean;
  readonly onChange: (file: File) => void;
  readonly onClear: () => void;
  readonly onLoopChange: (loop: boolean) => void;
  readonly onVolumeChange: (volume: number) => void;
  readonly track: BackingTrack | null;
  readonly volume: number;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const volumeProgress = input.volume * 100;

  useEffect(() => {
    const audio = input.audioRef.current;

    if (audio === null) {
      return;
    }

    audio.volume = input.volume;
    audio.loop = input.loop;
  }, [input.audioRef, input.loop, input.track?.url, input.volume]);

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (file !== undefined) {
      input.onChange(file);
    }
  }

  return (
    <section className="backing-track-panel">
      <div className="backing-track-header">
        <div>
          <p className="soft-label">Support audio</p>
          <strong>{input.track?.name ?? "Aucune piste"}</strong>
        </div>
        <div className="backing-track-actions">
          <button
            className="folder-button compact"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <Music aria-hidden="true" size={17} />
            <span>Choisir audio</span>
          </button>
          {input.track !== null && (
            <button
              aria-label="Retirer la piste audio"
              className="quiet-button icon-only"
              onClick={input.onClear}
              type="button"
            >
              <Trash2 aria-hidden="true" size={17} />
            </button>
          )}
        </div>
        <input
          accept="audio/*"
          className="sr-only"
          onChange={handleFileSelection}
          ref={fileInputRef}
          type="file"
        />
      </div>
      {input.track !== null && (
        <audio
          controls
          loop={input.loop}
          ref={input.audioRef}
          src={input.track.url}
        />
      )}
      <div className="backing-track-controls">
        <label className="backing-track-volume studio-range-control">
          <span>Volume du support</span>
          <input
            aria-label="Volume du support audio"
            className="studio-range"
            max={1}
            min={0}
            onChange={(event) =>
              input.onVolumeChange(Number(event.target.value))
            }
            step={0.01}
            style={
              {
                "--range-progress": `${volumeProgress}%`,
              } as CSSProperties
            }
            type="range"
            value={input.volume}
          />
          <strong>{Math.round(volumeProgress)}%</strong>
        </label>
        <label className="inline-toggle">
          <input
            checked={input.loop}
            onChange={(event) => input.onLoopChange(event.target.checked)}
            type="checkbox"
          />
          <span>Boucle</span>
        </label>
      </div>
      <p className="coach-note">
        Utilise un casque fermé. Le support guide l'interprétation, le WAV
        exporté reste une prise voix séparée.
      </p>
    </section>
  );
}

export function SystemHealthPanel(input: {
  readonly diagnostics: RuntimeDiagnostics;
  readonly onRefresh: () => void;
}) {
  const visibleChecks = input.diagnostics.checks.filter((check) =>
    [
      "microphone",
      "input-devices",
      "audio-engine",
      "recording-storage",
      "folder-export",
    ].includes(check.id),
  );

  return (
    <div className={`system-health is-${input.diagnostics.status}`}>
      <div className="system-health-header">
        <div>
          <p className="soft-label">Environnement</p>
          <strong>{formatRuntimeStatus(input.diagnostics.status)}</strong>
        </div>
        <AlertTriangle aria-hidden="true" size={18} />
      </div>
      <p>{input.diagnostics.primaryAction}</p>
      <button
        className="system-refresh"
        onClick={input.onRefresh}
        type="button"
      >
        Vérifier à nouveau
      </button>
      <div className="system-check-grid">
        {visibleChecks.map((check) => (
          <SystemCheckItem check={check} key={check.id} />
        ))}
      </div>
    </div>
  );
}

export function SystemCheckItem(input: { readonly check: RuntimeCheck }) {
  return (
    <div className={`system-check is-${input.check.status}`}>
      <span>{input.check.label}</span>
      <strong>{formatRuntimeStatus(input.check.status)}</strong>
    </div>
  );
}

export function CaptureProfileEditor(input: {
  readonly onChange: (profile: CaptureProfile) => void;
  readonly profile: CaptureProfile;
}) {
  function patchProfile(patch: Partial<CaptureProfile>) {
    input.onChange({
      ...input.profile,
      ...patch,
      calibratedAt: new Date().toISOString() as CaptureProfile["calibratedAt"],
    });
  }

  return (
    <div className="capture-profile">
      <section
        className="room-tone-summary"
        aria-label="Dernier silence de pièce"
      >
        <div>
          <Volume2 aria-hidden="true" size={18} />
          <span>Silence de pièce</span>
        </div>
        {input.profile.roomToneCaptured &&
        input.profile.roomToneNoiseFloorDbfs !== undefined ? (
          <dl>
            <div>
              <dt>Bruit</dt>
              <dd>{input.profile.roomToneNoiseFloorDbfs} dBFS</dd>
            </div>
            <div>
              <dt>Pic</dt>
              <dd>{input.profile.roomTonePeakDbfs ?? "n/a"} dBFS</dd>
            </div>
            <div>
              <dt>Durée</dt>
              <dd>
                {formatDurationSeconds(input.profile.roomToneDurationMs ?? 0)}
              </dd>
            </div>
          </dl>
        ) : (
          <p>
            Le niveau de base sera capté automatiquement avant la première
            phrase.
          </p>
        )}
      </section>
      <label>
        <span>Micro</span>
        <input
          aria-label="Nom du micro"
          placeholder="Ex. Shure SM7B"
          value={formatProfileInputValue(
            input.profile.microphoneName,
            DEFAULT_CAPTURE_PROFILE.microphoneName,
          )}
          onChange={(event) =>
            patchProfile({
              microphoneName: normalizeProfileInputValue(
                event.target.value,
                DEFAULT_CAPTURE_PROFILE.microphoneName,
              ),
            })
          }
        />
      </label>
      <label>
        <span>Interface</span>
        <input
          aria-label="Nom de l'interface audio"
          placeholder="Ex. Scarlett 2i2"
          value={formatProfileInputValue(
            input.profile.audioInterface,
            DEFAULT_CAPTURE_PROFILE.audioInterface,
          )}
          onChange={(event) =>
            patchProfile({
              audioInterface: normalizeProfileInputValue(
                event.target.value,
                DEFAULT_CAPTURE_PROFILE.audioInterface,
              ),
            })
          }
        />
      </label>
      <label>
        <span>Distance micro (cm)</span>
        <input
          aria-label="Distance bouche micro en centimètres"
          min={5}
          max={45}
          type="number"
          value={input.profile.mouthToMicDistanceCm}
          onChange={(event) =>
            patchProfile({ mouthToMicDistanceCm: Number(event.target.value) })
          }
        />
      </label>
      <label>
        <span>Pièce</span>
        <input
          aria-label="Description de la pièce"
          placeholder="Ex. bureau traité, fenêtre fermée"
          value={formatProfileInputValue(
            input.profile.roomDescription,
            DEFAULT_CAPTURE_PROFILE.roomDescription,
          )}
          onChange={(event) =>
            patchProfile({
              roomDescription: normalizeProfileInputValue(
                event.target.value,
                DEFAULT_CAPTURE_PROFILE.roomDescription,
              ),
            })
          }
        />
      </label>
    </div>
  );
}

function formatCaptureProfileStatus(profile: CaptureProfile): string {
  return profile.roomToneCaptured ? "Salle calibrée" : "Optionnel";
}

function formatProfileInputValue(value: string, defaultValue: string): string {
  return value === defaultValue ? "" : value;
}

function normalizeProfileInputValue(
  value: string,
  defaultValue: string,
): string {
  return value.trim().length === 0 ? defaultValue : value;
}
