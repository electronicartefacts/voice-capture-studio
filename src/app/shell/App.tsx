import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { Info } from "lucide-react";
import {
  canonicalCorpus,
  createLocalTextCorpus,
  type CorpusManifest,
  type LocalCorpusMode,
  type LocalTextCorpus,
} from "@domains/corpus";
import { summarizeCoverage } from "@domains/coverage";
import type { LocalTakeAnalysis } from "../analysis/types";
import {
  alignPromptToPhonemes,
  type PromptPhonemeAlignment,
} from "@domains/phonetics";
import {
  applyForcedAlignment,
  findPrompt,
  findPromptText,
  planSession,
  type CaptureSession,
  type RecordedTake,
} from "@domains/sessions";
import { initialSpeakers, type SpeakerId } from "@domains/speakers";
import {
  createEmptyWorkspace,
  reconcileWorkspaceProgress,
  type CaptureProfile,
  type VoiceWorkspace,
  type WorkspaceSpeaker,
  type WorkspaceDurability,
  type WorkspaceId,
  type WorkspaceReceipt,
} from "@domains/workspace";
import { type IsoDateTime, type LanguageCode } from "@shared/index";
import { createPcmRecorder, type PcmRecorder } from "../audio/pcmRecorder";
import type { InputGainMode } from "../audio/inputGain";
import { createBrowserAsrObservation } from "../analysis/browserAsrObservation";
import {
  applyLocalAcousticTiming,
  createAcousticPhraseTimings,
} from "../analysis/acousticTimingFusion";
import type { BrowserAsrHypothesis } from "@domains/observations";
import {
  createRecordingFileName,
  createTakeId,
} from "../audio/recordingFileName";
import { VoiceWaveformSurface } from "../rendering/VoiceWaveformSurface";
import {
  pushLiveWaveform as pushWaveformToRenderer,
  pushLiveWaveformFromSource,
  setLiveAudioLevel,
} from "../rendering/liveAudioSignal";
import {
  beginLoadingWave,
  cancelLoadingWave,
  finishLoadingWave,
  mapLocalAnalysisToLoadingProgress,
  runWithLoadingWave,
  updateLoadingWave,
} from "../rendering/loadingWaveSignal";
import {
  resetLiveReadingGuidePosition,
  setLiveReadingGuidePosition,
} from "../rendering/liveReadingGuideSignal";
import { measureAcousticField } from "../rendering/acousticField";
import { FREE_CAPTURE_MAX_DURATION_MS } from "../recording/captureLimits";
import {
  AMBIENT_MEASUREMENT_CONSTRAINTS,
  createAmbientNoiseProfile,
  createVoiceCaptureConstraints,
  type AmbientNoiseProfile,
} from "../recording/microphoneCapturePolicy";
import {
  createRealtimeSpeechActivityDetector,
  type RealtimeSpeechActivityDetector,
} from "../recording/realtimeSpeechActivity";
import { isConfirmedMlEndpointReady } from "../recording/mlCaptureEndpoint";
import { assessVocalPerformance } from "../recording/vocalPerformance";
import {
  finalizeCaptureSession,
  type FinalizedRecording,
} from "../recording/finalizeCaptureSession";
import { createVoiceCapturePackageZip } from "../export/downloadDatasetPackage";
import {
  createVoiceCapturePackagePlan,
  type VoiceCapturePackageScope,
} from "../export/voiceCapturePackage";
import { createBrowserWorkspaceRepository } from "../storage/browserWorkspaceRepository";
import {
  listBrowserRecordings,
  saveBrowserRecordingMetadata,
} from "../storage/browserRecordingStorage";
import { sha256Blob } from "../storage/sha256";
import {
  canChooseSystemFolder,
  chooseWorkspaceFolder,
  getWorkspaceRecording,
  getRememberedFolderName,
  saveVoiceCapturePackageToWorkspaceFolder,
  saveRecordingToWorkspaceFolder,
  saveTakeMetadataToWorkspaceFolder,
} from "../storage/workspaceFolder";
import { createWorkspaceBackup } from "../storage/workspaceBackup";
import {
  createMicrophoneErrorMessage,
  createRuntimeDiagnosticsSnapshot,
  getCaptureBlocker,
  inspectRuntime,
  type RuntimeDiagnostics,
} from "../system/runtimeDiagnostics";
import {
  AUDIO_UI_UPDATE_INTERVAL_MS,
  type WindowWithAudioContext,
  DEFAULT_INPUT_SENSITIVITY,
  DEFAULT_INPUT_GAIN_MODE,
  INPUT_GAIN_MODE_STORAGE_KEY,
  INPUT_SENSITIVITY_MAX,
  INPUT_SENSITIVITY_MIN,
  INPUT_SENSITIVITY_STORAGE_KEY,
  closeAmbientAudioContext,
} from "./audioEnvironment";
import {
  canCreateWorkspaceAfterOpenFailure,
  clampPercent,
  createMemoryOnlyWorkspaceMessage,
  createModeMessage,
  createRoomToneCalibration,
  createRuntimeHomeMessage,
  createSessionPreparationMessage,
  explainPromptChoice,
  formatSaveTarget,
  getCaptureModeContent,
  isDefaultHomeMessage,
  isSupportedAudioFile,
  isSupportedTextFile,
  isSupportedVideoFile,
} from "./helpers";
import { createYouTubeDubbingSource } from "./dubbingMedia";
import {
  DEFAULT_SPEAKER_LANGUAGE,
  createSpeakerId,
  createSpeakerProfiles,
  createWorkspaceSpeakerFromProfile,
  normalizeSpeakerDisplayName,
  normalizeSpeakerLanguages,
  type CreateSpeakerInput,
} from "./speakerProfiles";
import {
  alignTranscriptToPromptDetailed,
  commitSpeechRecognitionSession,
  createSpeechRecognitionBiasPhrases,
  createSpeechRecognitionSession,
  createFreeCaptureTranscript,
  estimateSpeechGuideDurationMs,
  formatSpeechRecognitionLanguage,
  getSpeechRecognitionDisplayText,
  getSpeechRecognitionFinalText,
  isOnDeviceSpeechRecognitionReady,
  mergeSpeechRecognitionHypotheses,
  updateSpeechRecognitionSession,
  wordPositionFromTimings,
  type SpeechRecognitionLike,
  type SpeechRecognitionSession,
  type WindowWithSpeechRecognition,
} from "./speech";
import type {
  BackingTrack,
  CaptureMode,
  DatasetExportState,
  DownloadableRecording,
  DubbingMediaSource,
  ReadingGuideMode,
  RitualStatus,
  RoomToneCalibration,
  Screen,
} from "./types";
import {
  KaraokeScreen,
  RoomToneCalibrationScreen,
} from "./screens/CaptureScreens";
import { CaptureModeSelector, HomeScreen } from "./screens/HomeScreen";
import { PermissionScreen } from "./screens/PermissionScreen";
import type { LexicalSegmentationState } from "./screens/LexicalSegmentationPanel";
import {
  AmbientBackdrop,
  OpeningRitual,
  SiteFooter,
} from "./screens/StudioChrome";
import { useSurfaceProfile } from "./surfaceProfile";
import { useAmbientRenderingBudget } from "./useAmbientRenderingBudget";

const TechnicalPage = lazy(() =>
  import("./screens/TechnicalPage").then((module) => ({
    default: module.TechnicalPage,
  })),
);
const DoneScreen = lazy(() =>
  import("./screens/DoneScreen").then((module) => ({
    default: module.DoneScreen,
  })),
);

function LoadingWaveFallback({
  id,
  label,
  className,
}: {
  id: string;
  label: string;
  className?: string;
}) {
  useEffect(() => {
    beginLoadingWave(id, label);

    return () => finishLoadingWave(id);
  }, [id, label]);

  return className === undefined ? null : (
    <section aria-hidden="true" className={className} />
  );
}

type RecordingWakeLockSentinel = {
  readonly released: boolean;
  release: () => Promise<void>;
};
type NavigatorWithWakeLock = Navigator & {
  readonly wakeLock?: {
    request: (type: "screen") => Promise<RecordingWakeLockSentinel>;
  };
};
type AmbientMicrophoneMonitor = {
  readonly stream: MediaStream;
  readonly snapshot: () => AmbientNoiseProfile | null;
  readonly stop: () => void;
};

const workspaceId = "workspace.local.main" as WorkspaceId;
const workspaceRepository = createBrowserWorkspaceRepository();
const ROOM_TONE_CAPTURE_MS = 3000;
const WAVEFORM_WARMUP_DELAY_MS = 140;

function readStoredInputSensitivity(): number {
  try {
    const raw = window.localStorage.getItem(INPUT_SENSITIVITY_STORAGE_KEY);
    const value = raw === null ? Number.NaN : Number.parseFloat(raw);

    return Number.isFinite(value)
      ? Math.min(INPUT_SENSITIVITY_MAX, Math.max(INPUT_SENSITIVITY_MIN, value))
      : DEFAULT_INPUT_SENSITIVITY;
  } catch {
    return DEFAULT_INPUT_SENSITIVITY;
  }
}

function readStoredInputGainMode(): InputGainMode {
  try {
    return window.localStorage.getItem(INPUT_GAIN_MODE_STORAGE_KEY) === "manual"
      ? "manual"
      : DEFAULT_INPUT_GAIN_MODE;
  } catch {
    return DEFAULT_INPUT_GAIN_MODE;
  }
}

function createMicrophoneLabel(stream: MediaStream): string | null {
  const label = stream.getAudioTracks()[0]?.label.trim() ?? "";

  return label.length > 0 ? label : null;
}

function voiceActivationThreshold(
  roomTone: RoomToneCalibration | null,
): number {
  if (roomTone === null) {
    return 0.06;
  }

  if (roomTone.noiseFloorDbfs >= -46) {
    return 0.1;
  }

  if (roomTone.noiseFloorDbfs >= -56) {
    return 0.078;
  }

  return 0.06;
}

function revokeObjectUrl(url: string | null): void {
  if (url !== null) {
    URL.revokeObjectURL(url);
  }
}

function disconnectAudioNode(node: AudioNode | null): void {
  try {
    node?.disconnect();
  } catch {
    // Browser implementations can throw when a node is already disconnected.
  }
}

const MICROPHONE_REVALIDATION_KEY =
  "voice-capture-studio.microphone-revalidation.v1";

function requiresStoredMicrophoneRevalidation(): boolean {
  try {
    return sessionStorage.getItem(MICROPHONE_REVALIDATION_KEY) === "required";
  } catch {
    return false;
  }
}

function storeMicrophoneRevalidation(required: boolean): void {
  try {
    if (required) {
      sessionStorage.setItem(MICROPHONE_REVALIDATION_KEY, "required");
    } else {
      sessionStorage.removeItem(MICROPHONE_REVALIDATION_KEY);
    }
  } catch {
    // Safari private browsing can make storage unavailable. The in-memory
    // lifecycle state still protects the current page instance.
  }
}

export function App() {
  const surfaceProfile = useSurfaceProfile();
  const [studioAwake, setStudioAwake] = useState(false);
  const [requiresDeviceRevalidation, setRequiresDeviceRevalidation] = useState(
    requiresStoredMicrophoneRevalidation,
  );
  const [isWaveformReady, setIsWaveformReady] = useState(false);
  const [ritualStatus, setRitualStatus] = useState<RitualStatus>("idle");
  const [screen, setScreenState] = useState<Screen>("home");
  const [workspace, setWorkspace] = useState<VoiceWorkspace | null>(null);
  const [workspaceDurability, setWorkspaceDurability] =
    useState<WorkspaceDurability | null>(null);
  const [workspaceOpenBlocker, setWorkspaceOpenBlocker] = useState<
    string | null
  >(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("training");
  const activeModeContent = getCaptureModeContent(captureMode);
  const [customCorpusText, setCustomCorpusText] = useState("");
  const [customCorpusSourceName, setCustomCorpusSourceName] = useState<
    string | null
  >(null);
  const [backingTrack, setBackingTrack] = useState<BackingTrack | null>(null);
  const [backingTrackVolume, setBackingTrackVolume] = useState(0.28);
  const [backingTrackLoop, setBackingTrackLoop] = useState(true);
  const [dubbingMedia, setDubbingMedia] = useState<DubbingMediaSource | null>(
    null,
  );
  const [dubbingCueSeconds, setDubbingCueSeconds] = useState(0);
  const [dubbingMediaMuted, setDubbingMediaMuted] = useState(true);
  const [lexicalSegmentationFile, setLexicalSegmentationFile] =
    useState<File | null>(null);
  const [lexicalSegmentationState, setLexicalSegmentationState] =
    useState<LexicalSegmentationState>({ status: "idle" });
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<SpeakerId>(
    initialSpeakers[0].id,
  );
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>(
    initialSpeakers[0].primaryLanguage,
  );
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0);
  const [activeWordIndex, setActiveWordIndex] = useState(0);
  const [lastTake, setLastTake] = useState<RecordedTake | null>(null);
  const [message, setMessage] = useState(
    "Sélectionne une voix, confirme l'environnement, puis lance une session courte.",
  );
  const [savedFileName, setSavedFileName] = useState<string | null>(null);
  const [savedLocation, setSavedLocation] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [metadataDownloadUrl, setMetadataDownloadUrl] = useState<string | null>(
    null,
  );
  const [isFreeCapture, setIsFreeCapture] = useState(false);
  const isFreeCaptureRef = useRef(false);
  const [isDirectCaptureStarting, setIsDirectCaptureStarting] = useState(false);
  const [isContinuousCorpusCapture, setIsContinuousCorpusCapture] =
    useState(false);
  const [workspaceBackupUrl, setWorkspaceBackupUrl] = useState<string | null>(
    null,
  );
  const [workspaceBackupFileName, setWorkspaceBackupFileName] = useState<
    string | null
  >(null);
  const [storedRecordings, setStoredRecordings] = useState<
    readonly DownloadableRecording[]
  >([]);
  const [datasetExportState, setDatasetExportState] =
    useState<DatasetExportState>({ status: "idle" });
  const [audioLevel, setAudioLevel] = useState(0);
  const [readingGuideMode, setReadingGuideModeState] =
    useState<ReadingGuideMode>("voice-activity");
  const [recognizedTranscript, setRecognizedTranscript] = useState("");
  const [freeCaptureReviewTranscript, setFreeCaptureReviewTranscript] =
    useState<string | null>(null);
  const [
    freeCaptureReviewTranscriptCandidate,
    setFreeCaptureReviewTranscriptCandidate,
  ] = useState(false);
  const [roomToneProgress, setRoomToneProgress] = useState(0);
  const [sessionRoomTone, setSessionRoomTone] =
    useState<RoomToneCalibration | null>(null);
  const [reviewPlaybackProgress, setReviewPlaybackProgress] = useState(0);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isSpeakingReference, setIsSpeakingReference] = useState(false);
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics>(() =>
    createRuntimeDiagnosticsSnapshot(),
  );
  const [microphoneLabel, setMicrophoneLabel] = useState<string | null>(null);
  const [inputSensitivity, setInputSensitivity] = useState(
    readStoredInputSensitivity,
  );
  const inputSensitivityRef = useRef(inputSensitivity);
  const [inputGainMode, setInputGainMode] = useState<InputGainMode>(
    readStoredInputGainMode,
  );
  const inputGainModeRef = useRef(inputGainMode);
  const appRootRef = useRef<HTMLElement | null>(null);
  const renderedAudioLevelRef = useRef(0);
  const lastAudioUiUpdateAtRef = useRef(-Infinity);
  const workspaceRef = useRef<VoiceWorkspace | null>(null);
  const hasRestoredLocalCorpusRef = useRef(false);
  const screenRef = useRef<Screen>("home");
  const activeWordIndexRef = useRef(0);
  const visualAudioLevelRef = useRef(0);
  const pcmRecorderRef = useRef<PcmRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechRecognitionSessionRef = useRef<SpeechRecognitionSession>(
    createSpeechRecognitionSession(),
  );
  const speechRecognitionRestartTimerRef = useRef<number | null>(null);
  const speechRecognitionRestartEnabledRef = useRef(false);
  const speechRecognitionBiasEnabledRef = useRef(true);
  const speechRecognitionLocalReadyRef = useRef(false);
  const speechRecognitionResultOffsetRef = useRef(0);
  const speechRecognitionSessionResultCountRef = useRef(0);
  const recognizedFinalTranscriptRef = useRef("");
  const speechRecognitionHypothesesRef = useRef<
    readonly BrowserAsrHypothesis[]
  >([]);
  const freeSpeechRecognitionAvailableRef = useRef(false);
  const freeCaptureMetadataRef = useRef<Record<string, unknown> | null>(null);
  const wakeLockRef = useRef<RecordingWakeLockSentinel | null>(null);
  const backingAudioRef = useRef<HTMLAudioElement | null>(null);
  const downloadUrlRef = useRef<string | null>(null);
  const metadataDownloadUrlRef = useRef<string | null>(null);
  const workspaceBackupUrlRef = useRef<string | null>(null);
  const localCorpusPersistTimerRef = useRef<number | null>(null);
  const backingTrackUrlRef = useRef<string | null>(null);
  const dubbingMediaUrlRef = useRef<string | null>(null);
  const storedRecordingUrlsRef = useRef<readonly string[]>([]);
  const datasetZipUrlRef = useRef<string | null>(null);
  const workspaceArchiveUrlRef = useRef<string | null>(null);
  const lexicalSegmentationUrlRef = useRef<string | null>(null);
  const lexicalSegmentationAbortRef = useRef<AbortController | null>(null);
  const ambientMonitorRef = useRef<AmbientMicrophoneMonitor | null>(null);
  const ambientNoiseProfileRef = useRef<AmbientNoiseProfile | null>(null);
  const isPersistingRef = useRef(false);
  const roomToneCaptureTimerRef = useRef<number | null>(null);
  const roomToneProgressTimerRef = useRef<number | null>(null);
  const roomToneStartedAtRef = useRef(0);
  const readingGuideModeRef = useRef<ReadingGuideMode>("voice-activity");
  const readingGuideIntervalRef = useRef<number | null>(null);
  const readingGuideStartedAtRef = useRef(0);
  const readingGuideLastTickAtRef = useRef(0);
  const readingGuideLastSpeechAtRef = useRef(0);
  const readingGuideProgressRef = useRef(0);
  const readingGuideAlignmentRef = useRef<PromptPhonemeAlignment | null>(null);
  const readingGuideFinalAlignmentConfirmedAtRef = useRef<number | null>(null);
  const readingGuideLiveAlignmentCompletedAtRef = useRef<number | null>(null);
  const liveWordStartedAtMsRef = useRef<(number | null)[]>([]);
  const captureRecordingStartedAtRef = useRef(0);
  const readingGuideFinishTimerRef = useRef<number | null>(null);
  const realtimeSpeechActivityRef =
    useRef<RealtimeSpeechActivityDetector | null>(null);
  const freeCaptureLimitTimerRef = useRef<number | null>(null);
  const lastTranscriptAtRef = useRef(0);
  const finishRecordingRef = useRef<() => void>(() => undefined);
  const hasCalibratedCurrentSessionRef = useRef(false);
  const microphoneLeaseEpochRef = useRef(0);
  const microphoneRequestPendingRef = useRef(false);
  const pageExitHandledRef = useRef(false);

  const setScreen = useCallback((nextScreen: Screen) => {
    // Arming the capture screens must never wait on a transition: recording
    // feedback wins. Leaving them is a different moment — finishRecording
    // always calls the recorder's stop() before any setScreen away from
    // calibration/karaoke runs, so by the time this fires the microphone is
    // already closed. Nothing live is left to protect, so "fin de prise" is
    // free to dissolve like every other screen instead of cutting instantly.
    const isArmingCapture =
      nextScreen === "calibration" || nextScreen === "karaoke";
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const documentWithViewTransition = document as Document & {
      startViewTransition?: (update: () => void) => void;
    };

    // Native View Transitions make card changes continuous where supported.
    if (
      !isArmingCapture &&
      !prefersReducedMotion &&
      documentWithViewTransition.startViewTransition !== undefined
    ) {
      documentWithViewTransition.startViewTransition(() =>
        flushSync(() => setScreenState(nextScreen)),
      );
      return;
    }

    setScreenState(nextScreen);
  }, []);

  useEffect(() => {
    if (!studioAwake) {
      return;
    }

    const root = appRootRef.current;
    if (root === null) {
      return;
    }

    const target = root.querySelector<HTMLElement>(
      [
        ".technical-page h1",
        ".director-panel h1",
        ".room-tone-screen h1",
        ".karaoke-screen h1",
        ".karaoke-line",
        ".focus-card h1",
        ".lab-launcher h1",
      ].join(", "),
    );

    if (target === null) {
      return;
    }

    target.tabIndex = -1;
    const frameId = window.requestAnimationFrame(() => {
      target.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [screen, studioAwake]);

  const speakerProfiles = useMemo(
    () => createSpeakerProfiles(workspace?.speakers),
    [workspace?.speakers],
  );
  const selectedSpeaker = speakerProfiles.find(
    (speaker) => speaker.id === selectedSpeakerId,
  );
  const localCorpus = useMemo<LocalTextCorpus | null>(() => {
    if (
      captureMode === "training" ||
      captureMode === "free" ||
      captureMode === "lexical-segmentation"
    ) {
      return null;
    }

    return createLocalTextCorpus({
      mode: captureMode,
      text: customCorpusText,
      language: selectedLanguage,
      sourceName: customCorpusSourceName,
    });
  }, [captureMode, customCorpusSourceName, customCorpusText, selectedLanguage]);
  const activeCorpus: CorpusManifest | null =
    captureMode === "training"
      ? canonicalCorpus
      : (localCorpus?.corpus ?? null);
  const trainingConsentGranted =
    workspace?.rights.consents.some(
      (record) =>
        record.speakerId === selectedSpeakerId &&
        record.status === "granted" &&
        record.grants.includes("forge_ingestion") &&
        record.grants.includes("model_training") &&
        record.revokedAt === null,
    ) ?? false;
  const corpusLicenseGranted =
    activeCorpus !== null &&
    (workspace?.rights.licenses.some(
      (record) =>
        record.corpusId === activeCorpus.id &&
        record.corpusVersion === activeCorpus.version &&
        record.status === "granted",
    ) ??
      false);
  const activePromptId = session?.plannedPromptIds[currentPromptIndex];
  const promptText =
    activePromptId && activeCorpus !== null
      ? findPromptText(activeCorpus, activePromptId)
      : "";
  const activePrompt =
    activePromptId && activeCorpus !== null
      ? findPrompt(activeCorpus, activePromptId)
      : undefined;
  const firstCorpusPrompt = activeCorpus?.scenarios
    .flatMap((scenario) => scenario.prompts)
    .at(0);
  const dubbingStartSeconds =
    activePrompt?.sourceTiming !== undefined
      ? activePrompt.sourceTiming.startMs / 1000
      : isContinuousCorpusCapture &&
          firstCorpusPrompt?.sourceTiming !== undefined
        ? firstCorpusPrompt.sourceTiming.startMs / 1000
        : dubbingCueSeconds;
  const dubbingEndSeconds =
    activePrompt?.sourceTiming === undefined
      ? null
      : activePrompt.sourceTiming.endMs / 1000;
  const words = useMemo(
    () => promptText.split(/\s+/).filter(Boolean),
    [promptText],
  );
  const continuousCorpusPrompts = useMemo(
    () => activeCorpus?.scenarios.flatMap((scenario) => scenario.prompts) ?? [],
    [activeCorpus],
  );
  const continuousPromptRanges = useMemo(() => {
    let wordOffset = 0;

    return continuousCorpusPrompts.map((prompt) => {
      const promptWords = (prompt.spokenText ?? prompt.text)
        .split(/\s+/)
        .filter(Boolean);
      const range = {
        prompt,
        words: promptWords,
        startWordIndex: wordOffset,
        endWordIndex: wordOffset + Math.max(0, promptWords.length - 1),
      };

      wordOffset += promptWords.length;
      return range;
    });
  }, [continuousCorpusPrompts]);
  const continuousGuideWords = useMemo(
    () => continuousPromptRanges.flatMap((range) => range.words),
    [continuousPromptRanges],
  );
  const continuousPromptIndex = Math.max(
    0,
    continuousPromptRanges.findIndex(
      (range) => activeWordIndex <= range.endWordIndex,
    ),
  );
  const continuousPromptRange =
    continuousPromptRanges[continuousPromptIndex] ?? null;
  const visibleWords = isContinuousCorpusCapture
    ? (continuousPromptRange?.words ?? [])
    : words;
  const visibleWordIndex = isContinuousCorpusCapture
    ? Math.max(
        0,
        activeWordIndex - (continuousPromptRange?.startWordIndex ?? 0),
      )
    : activeWordIndex;
  const visiblePrompt = isContinuousCorpusCapture
    ? continuousPromptRange?.prompt
    : activePrompt;
  const continuousCorpusText = useMemo(
    () =>
      activeCorpus?.scenarios
        .flatMap((scenario) => scenario.prompts)
        .map((prompt) => prompt.spokenText ?? prompt.text)
        .join("\n\n") ?? "",
    [activeCorpus],
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  useEffect(() => {
    const loadDubbingSurface = () => {
      void import("../dubbing.css");
    };

    if (captureMode === "dubbing") {
      loadDubbingSurface();
      return;
    }

    const preloadTimer = window.setTimeout(loadDubbingSurface, 800);

    return () => window.clearTimeout(preloadTimer);
  }, [captureMode]);

  const coverage =
    workspace && activeCorpus !== null
      ? summarizeCoverage({
          workspace,
          corpus: activeCorpus,
          speakerId: selectedSpeakerId,
          language: selectedLanguage,
        })
      : null;
  const activePromptInsight =
    activePrompt && coverage
      ? explainPromptChoice(activePrompt, coverage)
      : null;

  useEffect(() => {
    const fallbackSpeaker = speakerProfiles[0];

    if (fallbackSpeaker === undefined) {
      return;
    }

    const nextSpeaker = selectedSpeaker ?? fallbackSpeaker;

    if (nextSpeaker.id !== selectedSpeakerId) {
      setSelectedSpeakerId(nextSpeaker.id);
    }

    if (!nextSpeaker.supportedLanguages.includes(selectedLanguage)) {
      setSelectedLanguage(nextSpeaker.primaryLanguage);
    }
  }, [selectedLanguage, selectedSpeaker, selectedSpeakerId, speakerProfiles]);

  useEffect(() => {
    setFolderName(getRememberedFolderName());
    beginLoadingWave("workspace-open", "Ouverture du workspace");

    void workspaceRepository
      .open(workspaceId)
      .then(async (result) => {
        if (result.ok) {
          let receipt = result.value;
          const openedWorkspace = applyWorkspaceReceipt(receipt);

          if (openedWorkspace !== receipt.workspace) {
            const saveResult = await workspaceRepository.save(openedWorkspace);

            if (saveResult.ok) {
              receipt = saveResult.value;
              applyWorkspaceReceipt(receipt);
            }
          }

          setMessage(
            receipt.durability === "memory-only"
              ? createMemoryOnlyWorkspaceMessage()
              : createRuntimeHomeMessage(diagnostics),
          );
          return;
        }

        if (!canCreateWorkspaceAfterOpenFailure(result.error)) {
          setWorkspaceOpenBlocker(result.message);
          setMessage(result.message);
          return;
        }

        const nextWorkspace = createEmptyWorkspace({
          corpus: canonicalCorpus,
          speakers: initialSpeakers,
          now: new Date(),
        });
        const saveResult = await workspaceRepository.save(nextWorkspace);

        if (saveResult.ok) {
          applyWorkspaceReceipt(saveResult.value);
          if (saveResult.value.durability === "memory-only") {
            setMessage(createMemoryOnlyWorkspaceMessage());
          }
        }
      })
      .then(() => finishLoadingWave("workspace-open"))
      .catch(() => cancelLoadingWave("workspace-open"));

    return () => cancelLoadingWave("workspace-open");
  }, []);

  useEffect(() => {
    let isActive = true;

    void inspectRuntime().then((nextDiagnostics) => {
      if (!isActive) {
        return;
      }

      setDiagnostics(nextDiagnostics);
      setMessage((currentMessage) =>
        isDefaultHomeMessage(currentMessage)
          ? createRuntimeHomeMessage(nextDiagnostics)
          : currentMessage,
      );
    });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (requiresStoredMicrophoneRevalidation()) {
          return;
        }

        if (navigator.permissions?.query === undefined) {
          return;
        }

        const permission = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });

        if (!cancelled && permission.state === "granted") {
          void awakenStudio();
        }
      } catch {
        // Browsers without microphone permission introspection keep the manual ritual.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      const recorder = pcmRecorderRef.current;

      pcmRecorderRef.current = null;
      stopReadingGuide();
      stopPromptReference();
      clearRoomToneTimers();
      clearFreeCaptureLimitTimer();
      stopMediaStream();

      if (recorder !== null) {
        void recorder.stop().catch(() => undefined);
      }

      releaseRecordingWakeLock();
      stopAmbientMicrophoneMonitor();
      if (localCorpusPersistTimerRef.current !== null) {
        window.clearTimeout(localCorpusPersistTimerRef.current);
      }
      revokeObjectUrl(downloadUrlRef.current);
      revokeObjectUrl(metadataDownloadUrlRef.current);
      revokeObjectUrl(workspaceBackupUrlRef.current);
      revokeObjectUrl(backingTrackUrlRef.current);
      revokeObjectUrl(dubbingMediaUrlRef.current);
      revokeObjectUrl(datasetZipUrlRef.current);
      revokeObjectUrl(workspaceArchiveUrlRef.current);
      revokeObjectUrl(lexicalSegmentationUrlRef.current);
      lexicalSegmentationAbortRef.current?.abort();
      cancelLoadingWave("lexical-segmentation");
      revokeStoredRecordingUrls();
    };
  }, []);

  useEffect(() => {
    if (workspace === null || workspaceDurability !== "memory-only") {
      replaceWorkspaceBackupUrl(null);
      setWorkspaceBackupFileName(null);
      return;
    }

    const backup = createWorkspaceBackup({
      now: new Date(),
      workspace,
    });

    setWorkspaceBackupFileName(backup.fileName);
    replaceWorkspaceBackupUrl(
      URL.createObjectURL(
        new Blob([backup.contents], { type: backup.mediaType }),
      ),
    );
  }, [workspace, workspaceDurability]);

  useEffect(() => {
    const usesIOSBlurFallback =
      /iPad|iPhone|iPod/u.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    function handlePageExit() {
      microphoneLeaseEpochRef.current += 1;
      const recorder = pcmRecorderRef.current;
      const hasActiveMicrophone =
        ambientMonitorRef.current !== null ||
        mediaStreamRef.current !== null ||
        recorder !== null ||
        microphoneRequestPendingRef.current;

      if (!hasActiveMicrophone || pageExitHandledRef.current) {
        return;
      }
      pageExitHandledRef.current = true;

      storeMicrophoneRevalidation(true);
      stopAmbientMicrophoneMonitor();
      setStudioAwake(false);
      setRequiresDeviceRevalidation(true);
      setRitualStatus("idle");
      setIsWaveformReady(false);
      resetVisualAudioLevel();
      stopPromptReference();

      if (recorder !== null && screenRef.current === "karaoke") {
        stopMediaStream();
        void finishRecordingRef.current();
        return;
      }

      if (recorder !== null) {
        pcmRecorderRef.current = null;
        void recorder.stop().catch(() => undefined);
        setScreen("permission");
      }

      stopMediaStream();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        handlePageExit();
      }
    }

    function handlePageReturn() {
      if (requiresStoredMicrophoneRevalidation()) {
        setStudioAwake(false);
        setRequiresDeviceRevalidation(true);
        setRitualStatus("idle");
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("freeze", handlePageExit);
    if (usesIOSBlurFallback) {
      window.addEventListener("blur", handlePageExit);
    }
    window.addEventListener("pagehide", handlePageExit);
    window.addEventListener("beforeunload", handlePageExit);
    window.addEventListener("pageshow", handlePageReturn);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("freeze", handlePageExit);
      if (usesIOSBlurFallback) {
        window.removeEventListener("blur", handlePageExit);
      }
      window.removeEventListener("pagehide", handlePageExit);
      window.removeEventListener("beforeunload", handlePageExit);
      window.removeEventListener("pageshow", handlePageReturn);
    };
  }, []);

  useEffect(() => {
    if (!studioAwake) {
      setIsWaveformReady(false);
      return;
    }

    // Paint the interactive cards first. On iPhone Safari, preparing a
    // full-screen canvas in the same frame can delay their first composite.
    let warmupTimer: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      warmupTimer = window.setTimeout(
        () => setIsWaveformReady(true),
        WAVEFORM_WARMUP_DELAY_MS,
      );
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (warmupTimer !== null) {
        window.clearTimeout(warmupTimer);
      }
    };
  }, [studioAwake]);

  useEffect(() => {
    if (screen !== "technical") {
      return;
    }

    void refreshStoredRecordings();
  }, [screen]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    activeWordIndexRef.current = activeWordIndex;
  }, [activeWordIndex]);

  useEffect(() => {
    // Chromium's headless shell currently exposes SpeechRecognition.available
    // without binding the on-device recognition service. Calling it terminates
    // the renderer with a bad Mojo message, so automated browsers must stay on
    // the regular progressive SpeechRecognition path.
    if (navigator.webdriver) {
      speechRecognitionLocalReadyRef.current = false;
      return;
    }

    const SpeechRecognitionConstructor =
      (window as WindowWithSpeechRecognition).SpeechRecognition ??
      (window as WindowWithSpeechRecognition).webkitSpeechRecognition;
    let current = true;

    void isOnDeviceSpeechRecognitionReady(
      SpeechRecognitionConstructor,
      formatSpeechRecognitionLanguage(selectedLanguage),
    ).then((ready) => {
      if (current) speechRecognitionLocalReadyRef.current = ready;
    });

    return () => {
      current = false;
    };
  }, [selectedLanguage]);

  useEffect(() => {
    finishRecordingRef.current = finishRecording;
  });

  useEffect(() => {
    if (ritualStatus === "requesting") {
      beginLoadingWave("microphone-permission", "Ouverture du microphone");
    } else if (ritualStatus === "idle") {
      finishLoadingWave("microphone-permission");
    } else {
      cancelLoadingWave("microphone-permission");
    }
  }, [ritualStatus]);

  useEffect(() => {
    if (isDirectCaptureStarting) {
      beginLoadingWave("capture-start", "Démarrage de la capture");
    } else {
      finishLoadingWave("capture-start");
    }
  }, [isDirectCaptureStarting]);

  useEffect(() => {
    if (isFinalizing) {
      beginLoadingWave("capture-finalization", "Finalisation de la prise");
    } else {
      finishLoadingWave("capture-finalization");
    }
  }, [isFinalizing]);

  useEffect(() => {
    if (datasetExportState.status === "preparing") {
      beginLoadingWave("dataset-export", "Préparation du dataset");
    } else if (datasetExportState.status === "done") {
      finishLoadingWave("dataset-export");
    } else {
      cancelLoadingWave("dataset-export");
    }
  }, [datasetExportState.status]);

  async function awakenStudio() {
    if (studioAwake || ritualStatus === "requesting") {
      return;
    }

    const captureBlocker = getCaptureBlocker(diagnostics);

    if (captureBlocker !== null) {
      setRitualStatus("denied");
      setMessage(captureBlocker);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setRitualStatus("denied");
      setMessage(
        "Micro indisponible ici. Ouvre le site en HTTPS et autorise le micro.",
      );
      return;
    }

    setRitualStatus("requesting");
    const leaseEpoch = microphoneLeaseEpochRef.current;
    microphoneRequestPendingRef.current = true;

    try {
      const monitor = await createAmbientMicrophoneMonitor();

      if (
        leaseEpoch !== microphoneLeaseEpochRef.current ||
        document.visibilityState === "hidden"
      ) {
        monitor.stop();
        storeMicrophoneRevalidation(true);
        setRequiresDeviceRevalidation(true);
        setRitualStatus("idle");
        return;
      }

      stopAmbientMicrophoneMonitor();
      ambientMonitorRef.current = monitor;
      pageExitHandledRef.current = false;
      setStudioAwake(true);
      storeMicrophoneRevalidation(false);
      setRequiresDeviceRevalidation(false);
      setRitualStatus("idle");
      setMessage(createRuntimeHomeMessage(diagnostics));
    } catch (error) {
      if (leaseEpoch !== microphoneLeaseEpochRef.current) {
        setRitualStatus("idle");
        return;
      }
      setRitualStatus("denied");
      setMessage(createMicrophoneErrorMessage(error));
      void refreshDiagnostics(false);
    } finally {
      microphoneRequestPendingRef.current = false;
    }
  }

  function enterMediaStudio() {
    stopAmbientMicrophoneMonitor();
    setStudioAwake(true);
    setRitualStatus("idle");
    setCaptureMode("lexical-segmentation");
    setMessage(createModeMessage("lexical-segmentation"));
  }

  async function createAmbientMicrophoneMonitor(): Promise<AmbientMicrophoneMonitor> {
    const AudioContextConstructor =
      window.AudioContext ??
      (window as WindowWithAudioContext).webkitAudioContext;

    if (AudioContextConstructor === undefined) {
      throw new Error("AudioContext is not available in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: AMBIENT_MEASUREMENT_CONSTRAINTS,
    });
    setMicrophoneLabel(createMicrophoneLabel(stream));

    let audioContext: AudioContext;
    try {
      audioContext = new AudioContextConstructor();
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    let frameId = 0;
    let pausedTimerId: number | null = null;
    let acousticFieldReadAt = -Infinity;
    let smoothedLevel = 0;
    const ambientStartedAt = performance.now();
    const ambientRmsWindows: number[] = [];

    analyser.fftSize = 2048;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -8;
    analyser.smoothingTimeConstant = 0.42;
    source.connect(analyser);

    // Keep the analyser signal in floating point. Safari's quieter microphone
    // streams lose visible detail when rounded to the 8-bit time-domain API.
    const timeData = new Float32Array(analyser.fftSize);
    const frequencyData = new Uint8Array(analyser.frequencyBinCount);

    if (audioContext.state === "suspended") {
      try {
        await audioContext.resume();
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        await closeAmbientAudioContext(audioContext);
        throw error;
      }
    }

    function scheduleAmbientLevelUpdate() {
      if (ambientRenderingBudgetRef.current === "paused") {
        // A backgrounded page keeps the microphone monitor available without
        // paying display cadence. Visible scrolling never reaches this branch.
        pausedTimerId = window.setTimeout(() => {
          pausedTimerId = null;
          frameId = window.requestAnimationFrame(updateAmbientLevel);
        }, 120);
        return;
      }

      frameId = window.requestAnimationFrame(updateAmbientLevel);
    }

    function updateAmbientLevel() {
      const renderingBudget = ambientRenderingBudgetRef.current;

      if (renderingBudget === "paused") {
        scheduleAmbientLevelUpdate();
        return;
      }

      const now = performance.now();
      if (
        renderingBudget === "constrained" &&
        now - acousticFieldReadAt < 1000 / 30
      ) {
        scheduleAmbientLevelUpdate();
        return;
      }
      analyser.getFloatTimeDomainData(timeData);

      let sumSquares = 0;

      for (const value of timeData) {
        sumSquares += value * value;
      }

      const rms = Math.sqrt(sumSquares / Math.max(1, timeData.length));
      ambientRmsWindows.push(rms);
      if (ambientRmsWindows.length > 300) ambientRmsWindows.shift();
      smoothedLevel += (rms - smoothedLevel) * 0.3;

      if (pcmRecorderRef.current === null && !isPersistingRef.current) {
        pushLiveWaveformFromSource(
          (index) => timeData[index],
          timeData.length,
          1.5 * inputSensitivityRef.current,
        );
        updateVisualAudioLevel(Math.min(1, smoothedLevel * 7));
      }

      if (now - acousticFieldReadAt >= 1000 / 30) {
        analyser.getByteFrequencyData(frequencyData);
        applyAcousticField(
          measureAcousticField(
            frequencyData,
            audioContext.sampleRate,
            analyser.fftSize,
          ),
        );
        acousticFieldReadAt = now;
      }

      scheduleAmbientLevelUpdate();
    }

    frameId = window.requestAnimationFrame(updateAmbientLevel);

    return {
      stream,
      snapshot: () =>
        createAmbientNoiseProfile(
          ambientRmsWindows,
          performance.now() - ambientStartedAt,
        ),
      stop() {
        window.cancelAnimationFrame(frameId);
        if (pausedTimerId !== null) {
          window.clearTimeout(pausedTimerId);
        }
        disconnectAudioNode(source);
        stream.getTracks().forEach((track) => track.stop());
        void closeAmbientAudioContext(audioContext);
      },
    };
  }

  function stopAmbientMicrophoneMonitor() {
    ambientMonitorRef.current?.stop();
    ambientMonitorRef.current = null;
  }

  function applyAcousticField(features: {
    readonly ambience: number;
    readonly bass: number;
    readonly presence: number;
    readonly air: number;
  }) {
    const style = appRootRef.current?.style;

    if (style === undefined) return;

    style.setProperty("--acoustic-ambience", features.ambience.toFixed(3));
    style.setProperty("--acoustic-bass", features.bass.toFixed(3));
    style.setProperty("--acoustic-presence", features.presence.toFixed(3));
    style.setProperty("--acoustic-air", features.air.toFixed(3));
  }

  useEffect(() => {
    if (screen === "karaoke" && isFreeCapture) {
      return;
    }

    if (screen !== "karaoke" || words.length === 0) {
      stopReadingGuide();
      return;
    }

    startReadingGuide(words, selectedLanguage);

    return () => stopReadingGuide();
  }, [isFreeCapture, screen, promptText, selectedLanguage]);

  async function ensureWorkspace(): Promise<VoiceWorkspace> {
    if (workspaceOpenBlocker !== null) {
      setMessage(workspaceOpenBlocker);
      throw new Error(workspaceOpenBlocker);
    }

    if (workspace !== null) {
      return workspace;
    }

    const nextWorkspace = createEmptyWorkspace({
      corpus: canonicalCorpus,
      speakers: initialSpeakers,
      now: new Date(),
    });
    const result = await workspaceRepository.save(nextWorkspace);

    if (!result.ok) {
      throw new Error(result.message);
    }

    return applyWorkspaceReceipt(result.value);
  }

  function applyWorkspaceReceipt(receipt: WorkspaceReceipt): VoiceWorkspace {
    const nextWorkspace = reconcileWorkspaceProgress(
      receipt.workspace,
      canonicalCorpus,
    );

    workspaceRef.current = nextWorkspace;
    setWorkspace(nextWorkspace);
    setWorkspaceDurability(receipt.durability);
    setWorkspaceOpenBlocker(null);

    if (
      !hasRestoredLocalCorpusRef.current &&
      nextWorkspace.localCorpusSnapshot !== null
    ) {
      hasRestoredLocalCorpusRef.current = true;
      setCaptureMode(nextWorkspace.localCorpusSnapshot.mode);
      setCustomCorpusText(nextWorkspace.localCorpusSnapshot.text);
      setCustomCorpusSourceName(nextWorkspace.localCorpusSnapshot.sourceName);
      setSelectedLanguage(nextWorkspace.localCorpusSnapshot.language);
    }

    return nextWorkspace;
  }

  async function downloadDatasetPackage() {
    if (workspace === null) {
      return;
    }

    setDatasetExportState({ status: "preparing" });

    try {
      const exportCorpus = activeCorpus ?? canonicalCorpus;
      const standaloneCaptures = (await listBrowserRecordings())
        .filter((recording) => recording.metadata !== undefined)
        .map((recording) => ({
          blob: recording.blob,
          fileName: recording.fileName,
          metadata: recording.metadata ?? {},
        }));
      const scope = createCurrentVoicePackageScope(
        workspace,
        exportCorpus,
        standaloneCaptures.length > 0,
      );
      const plan = await createVoiceCapturePackagePlan({
        corpus: exportCorpus,
        getAudioBlob: getWorkspaceRecording,
        processAudioBlob: (audioBlob) =>
          import("../analysis/processedVoiceArtifact").then((module) =>
            module.createProcessedVoiceArtifact({ audioBlob }),
          ),
        licenses: workspace.rights.licenses,
        rights: workspace.rights.consents,
        scope,
        speakerProfiles,
        standaloneCaptures,
        workspace,
      });
      const zip = await createVoiceCapturePackageZip({ plan });

      revokeObjectUrl(datasetZipUrlRef.current);
      const url = URL.createObjectURL(zip.blob);
      datasetZipUrlRef.current = url;

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `voice-capture-package-${plan.manifest.package_id}.zip`;
      anchor.click();

      setDatasetExportState({
        status: "done",
        keeperCount: plan.samples.length,
        missingAudioFiles: [],
        forgeReady: plan.forgeCompatibility.ready,
        blockingReasons: plan.forgeCompatibility.errors,
      });
    } catch (error) {
      setDatasetExportState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Le dataset n'a pas pu être généré.",
      });
    }
  }

  async function downloadWorkspaceArchive(): Promise<number> {
    const { createWorkspaceArchive } =
      await import("../storage/workspaceArchive");
    const currentWorkspace = await ensureWorkspace();
    const archive = await createWorkspaceArchive({
      workspace: currentWorkspace,
      getAudioBlob: getWorkspaceRecording,
      now: new Date(),
    });

    revokeObjectUrl(workspaceArchiveUrlRef.current);
    const url = URL.createObjectURL(archive.blob);
    workspaceArchiveUrlRef.current = url;

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = archive.fileName;
    anchor.click();

    setMessage(
      `Archive complète prête avec ${archive.recordingCount} WAV vérifié${archive.recordingCount > 1 ? "s" : ""}.`,
    );
    return archive.recordingCount;
  }

  async function importWorkspaceArchive(file: File): Promise<number> {
    const { readWorkspaceArchive } =
      await import("../storage/workspaceArchive");
    const restored = await readWorkspaceArchive(file);
    const saveResult = await workspaceRepository.restoreArchive(restored);
    if (!saveResult.ok) {
      throw new Error(saveResult.message);
    }

    hasRestoredLocalCorpusRef.current = false;
    applyWorkspaceReceipt(saveResult.value);
    setSession(null);
    setCurrentPromptIndex(0);
    resetTakeOutputState();
    await refreshStoredRecordings();
    setMessage(
      `Workspace restauré avec ${restored.recordings.length} WAV vérifié${restored.recordings.length > 1 ? "s" : ""}.`,
    );

    return restored.recordings.length;
  }

  async function writeDatasetPackageToFolder() {
    if (workspace === null) {
      return;
    }

    setDatasetExportState({ status: "preparing" });

    try {
      const exportCorpus = activeCorpus ?? canonicalCorpus;
      const standaloneCaptures = (await listBrowserRecordings())
        .filter((recording) => recording.metadata !== undefined)
        .map((recording) => ({
          blob: recording.blob,
          fileName: recording.fileName,
          metadata: recording.metadata ?? {},
        }));
      const scope = createCurrentVoicePackageScope(
        workspace,
        exportCorpus,
        standaloneCaptures.length > 0,
      );
      const plan = await createVoiceCapturePackagePlan({
        corpus: exportCorpus,
        getAudioBlob: getWorkspaceRecording,
        processAudioBlob: (audioBlob) =>
          import("../analysis/processedVoiceArtifact").then((module) =>
            module.createProcessedVoiceArtifact({ audioBlob }),
          ),
        licenses: workspace.rights.licenses,
        rights: workspace.rights.consents,
        scope,
        speakerProfiles,
        standaloneCaptures,
        workspace,
      });
      const result = await saveVoiceCapturePackageToWorkspaceFolder({
        files: plan.files,
      });

      if (!result.ok) {
        setDatasetExportState({ status: "error", message: result.message });
        return;
      }

      setDatasetExportState({
        status: "done",
        keeperCount: plan.samples.length,
        missingAudioFiles: [],
        forgeReady: plan.forgeCompatibility.ready,
        blockingReasons: plan.forgeCompatibility.errors,
      });
    } catch (error) {
      setDatasetExportState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Le dataset n'a pas pu être écrit dans ce dossier.",
      });
    }
  }

  async function updateTrainingConsent(granted: boolean) {
    const currentWorkspace = await ensureWorkspace();
    const now = new Date().toISOString() as IsoDateTime;
    const previous = currentWorkspace.rights.consents.find(
      (record) => record.speakerId === selectedSpeakerId,
    );
    const nextRecord = {
      consentId: previous?.consentId ?? `consent.${selectedSpeakerId}.local`,
      speakerId: selectedSpeakerId,
      policyVersion: "voice-training-consent.v1",
      status: granted ? ("granted" as const) : ("revoked" as const),
      grants: granted ? ["forge_ingestion", "model_training"] : [],
      restrictions: [],
      grantedAt: granted ? now : (previous?.grantedAt ?? null),
      revokedAt: granted ? null : now,
      evidenceRef: granted ? `local-attestation:${now}` : null,
      source: "local_user_attestation" as const,
    };
    const nextWorkspace = {
      ...currentWorkspace,
      updatedAt: now,
      rights: {
        ...currentWorkspace.rights,
        consents: [
          ...currentWorkspace.rights.consents.filter(
            (record) => record.speakerId !== selectedSpeakerId,
          ),
          nextRecord,
        ],
      },
    };
    const result = await workspaceRepository.save(nextWorkspace);
    if (!result.ok) throw new Error(result.message);
    applyWorkspaceReceipt(result.value);
    setDatasetExportState({ status: "idle" });
    setMessage(
      granted ? "Consentement enregistré localement." : "Consentement révoqué.",
    );
  }

  async function updateCorpusLicense(granted: boolean) {
    if (activeCorpus === null) return;
    const currentWorkspace = await ensureWorkspace();
    const now = new Date().toISOString() as IsoDateTime;
    const matchesCorpus = (
      record: VoiceWorkspace["rights"]["licenses"][number],
    ) =>
      record.corpusId === activeCorpus.id &&
      record.corpusVersion === activeCorpus.version;
    const previous = currentWorkspace.rights.licenses.find(matchesCorpus);
    const nextRecord = {
      licenseId:
        previous?.licenseId ??
        `license.${activeCorpus.id}.${activeCorpus.version}.local`,
      corpusId: activeCorpus.id,
      corpusVersion: activeCorpus.version,
      status: granted ? ("granted" as const) : ("unknown" as const),
      spdxId: null,
      restrictions: [],
      evidenceRef: granted ? `local-attestation:${now}` : null,
      source: "local_user_attestation" as const,
    };
    const nextWorkspace = {
      ...currentWorkspace,
      updatedAt: now,
      rights: {
        ...currentWorkspace.rights,
        licenses: [
          ...currentWorkspace.rights.licenses.filter(
            (record) => !matchesCorpus(record),
          ),
          nextRecord,
        ],
      },
    };
    const result = await workspaceRepository.save(nextWorkspace);
    if (!result.ok) throw new Error(result.message);
    applyWorkspaceReceipt(result.value);
    setDatasetExportState({ status: "idle" });
    setMessage(
      granted
        ? "Droits du corpus attestés localement."
        : "Attestation du corpus retirée.",
    );
  }

  function createCurrentVoicePackageScope(
    currentWorkspace: VoiceWorkspace,
    corpus: CorpusManifest,
    hasStandaloneCaptures = false,
  ): VoiceCapturePackageScope {
    const sessionIds = currentWorkspace.capturedSessions
      .filter(
        (candidate) =>
          candidate.speakerId === selectedSpeakerId &&
          candidate.language === selectedLanguage &&
          candidate.corpusId === corpus.id,
      )
      .map((candidate) => candidate.id);

    if (sessionIds.length === 0 && !hasStandaloneCaptures) {
      throw new Error(
        "Aucune session enregistrée dans le scope actuel. Sélectionne une voix, une langue et un corpus avec au moins une prise gardée.",
      );
    }

    return {
      datasetId: `dataset.${currentWorkspace.workspaceId}.${corpus.id}.${selectedSpeakerId}.${selectedLanguage}`,
      projectId: "project.voice-capture-studio",
      speakerIds: [selectedSpeakerId],
      languages: [selectedLanguage],
      locales: [selectedLanguage === "fr" ? "fr-FR" : "en-US"],
      corpusRefs: [{ id: corpus.id, version: corpus.version }],
      sessionIds,
      takeStatuses: ["keeper"],
      includeRoomTones: true,
    };
  }

  async function selectFolder() {
    const result = await chooseWorkspaceFolder();

    if (result.ok) {
      setFolderName(result.value.folderName);
      setMessage(
        canChooseSystemFolder() &&
          result.value.folderName !== "Stockage du navigateur"
          ? "Dossier local connecté. Les fichiers restent sur cet appareil."
          : "Stockage navigateur actif. Télécharge le WAV et le JSON après chaque prise.",
      );
      await ensureWorkspace().catch(() => undefined);
      return;
    }

    setMessage(result.message);
  }

  function selectCaptureMode(mode: CaptureMode) {
    setCaptureMode(mode);
    setSession(null);
    resetTakeOutputState();
    setIsContinuousCorpusCapture(false);

    if (mode !== "mastering") {
      stopBackingTrackPlayback(true);
    }

    if (
      mode !== "training" &&
      mode !== "free" &&
      mode !== "lexical-segmentation" &&
      customCorpusText.trim().length > 0
    ) {
      const generatedCorpus = createLocalTextCorpus({
        mode,
        text: customCorpusText,
        language: selectedLanguage,
        sourceName: customCorpusSourceName,
      });

      if (generatedCorpus !== null) {
        scheduleLocalCorpusSnapshot({
          corpusId: generatedCorpus.corpus.id,
          mode,
          language: selectedLanguage,
          sourceName: generatedCorpus.summary.sourceName,
          text: customCorpusText,
        });
      }
    }

    setMessage(createModeMessage(mode));
  }

  function selectLanguage(language: LanguageCode) {
    setSelectedLanguage(language);

    if (
      captureMode === "training" ||
      captureMode === "free" ||
      captureMode === "lexical-segmentation" ||
      customCorpusText.trim().length === 0
    ) {
      return;
    }

    const generatedCorpus = createLocalTextCorpus({
      mode: captureMode,
      text: customCorpusText,
      language,
      sourceName: customCorpusSourceName,
    });

    if (generatedCorpus !== null) {
      scheduleLocalCorpusSnapshot({
        corpusId: generatedCorpus.corpus.id,
        mode: captureMode,
        language,
        sourceName: generatedCorpus.summary.sourceName,
        text: customCorpusText,
      });
    }
  }

  function updateCustomCorpusText(
    text: string,
    sourceName = customCorpusSourceName,
    mode: LocalCorpusMode = captureMode === "training" ||
    captureMode === "free" ||
    captureMode === "lexical-segmentation"
      ? "dubbing"
      : captureMode,
  ) {
    setCustomCorpusText(text);
    setCustomCorpusSourceName(text.trim().length === 0 ? null : sourceName);
    setSession(null);
    resetTakeOutputState();

    const generatedCorpus = createLocalTextCorpus({
      mode,
      text,
      language: selectedLanguage,
      sourceName,
    });

    scheduleLocalCorpusSnapshot(
      generatedCorpus === null
        ? null
        : {
            corpusId: generatedCorpus.corpus.id,
            mode,
            language: selectedLanguage,
            sourceName: generatedCorpus.summary.sourceName,
            text,
          },
    );
  }

  async function loadCustomCorpusFile(file: File) {
    if (!isSupportedTextFile(file)) {
      setMessage("Charge un fichier texte, Markdown, SRT ou VTT.");
      return;
    }

    try {
      const text = await file.text();

      if (text.trim().length === 0) {
        setMessage("Le fichier texte est vide.");
        return;
      }

      const mode =
        captureMode === "training" ||
        captureMode === "free" ||
        captureMode === "lexical-segmentation"
          ? "dubbing"
          : captureMode;

      if (
        captureMode === "training" ||
        captureMode === "free" ||
        captureMode === "lexical-segmentation"
      ) {
        setCaptureMode(mode);
      }

      updateCustomCorpusText(text, file.name, mode);
      setMessage(`Corpus local chargé : ${file.name}.`);
    } catch {
      setMessage("Impossible de lire ce fichier texte.");
    }
  }

  function scheduleLocalCorpusSnapshot(
    snapshot: VoiceWorkspace["localCorpusSnapshot"],
  ) {
    if (localCorpusPersistTimerRef.current !== null) {
      window.clearTimeout(localCorpusPersistTimerRef.current);
    }

    localCorpusPersistTimerRef.current = window.setTimeout(() => {
      localCorpusPersistTimerRef.current = null;
      void persistLocalCorpusSnapshot(snapshot);
    }, 250);
  }

  async function persistLocalCorpusSnapshot(
    snapshot: VoiceWorkspace["localCorpusSnapshot"],
  ) {
    const currentWorkspace = workspaceRef.current ?? workspace;

    if (currentWorkspace === null) {
      return;
    }

    const nextWorkspace: VoiceWorkspace = {
      ...currentWorkspace,
      localCorpusSnapshot: snapshot,
      updatedAt: new Date().toISOString() as VoiceWorkspace["updatedAt"],
    };
    const result = await workspaceRepository.save(nextWorkspace);

    if (result.ok) {
      applyWorkspaceReceipt(result.value);
    }
  }

  async function loadForcedAlignmentFile(file: File) {
    try {
      const currentWorkspace = await ensureWorkspace();
      const payload: unknown = JSON.parse(await file.text());
      const requestedTakeId =
        typeof payload === "object" &&
        payload !== null &&
        "takeId" in payload &&
        typeof payload.takeId === "string"
          ? payload.takeId
          : null;
      const availableTakes = currentWorkspace.capturedSessions.flatMap(
        (capturedSession) =>
          capturedSession.takes.map((take) => ({ capturedSession, take })),
      );
      const target =
        requestedTakeId === null
          ? availableTakes.at(-1)
          : availableTakes.find(({ take }) => take.id === requestedTakeId);

      if (target === undefined) {
        setMessage(
          requestedTakeId === null
            ? "Aucune prise disponible pour cet alignement forcé."
            : `La prise ciblée ${requestedTakeId} est introuvable.`,
        );
        return;
      }

      const localAnalysis = target.take.timing.localAcousticAnalysis;
      const alignment = (
        await import("@domains/phonetics/alignmentConsensus")
      ).importAlignmentWithConsensus({
        payload,
        estimated: target.take.timing.alignment,
        localAcoustic:
          localAnalysis === undefined
            ? undefined
            : {
                matchRate: localAnalysis.alignmentComparison.matchRate,
                medianBoundaryDeltaMs:
                  localAnalysis.alignmentComparison.medianBoundaryDeltaMs,
                words: localAnalysis.words,
              },
      });

      if (alignment.language !== target.capturedSession.language) {
        setMessage("La langue de l'alignement ne correspond pas à la prise.");
        return;
      }

      if (Math.abs(alignment.durationMs - target.take.durationMs) > 250) {
        setMessage("La durée de l'alignement ne correspond pas à la prise.");
        return;
      }

      const updatedTake = applyForcedAlignment(target.take, alignment);
      const nextWorkspace: VoiceWorkspace = {
        ...currentWorkspace,
        updatedAt: new Date().toISOString() as VoiceWorkspace["updatedAt"],
        capturedSessions: currentWorkspace.capturedSessions.map(
          (capturedSession) =>
            capturedSession.id !== target.capturedSession.id
              ? capturedSession
              : {
                  ...capturedSession,
                  takes: capturedSession.takes.map((take) =>
                    take.id === updatedTake.id ? updatedTake : take,
                  ),
                },
        ),
      };
      const result = await workspaceRepository.save(nextWorkspace);

      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      applyWorkspaceReceipt(result.value);
      setLastTake(updatedTake);
      setMessage(
        alignment.consensus === undefined
          ? `Alignement forcé importé avec ${alignment.aligner}.`
          : alignment.consensus.reviewRequired
            ? `Consensus importé, mais les aligneurs divergent de ${alignment.consensus.agreementMs} ms : révision requise.`
            : `Consensus ${alignment.consensus.status} importé depuis ${alignment.consensus.acousticSourceCount} aligneurs acoustiques.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible d'importer cet alignement forcé.",
      );
    }
  }

  async function persistLocalTakeAnalysis(analysis: LocalTakeAnalysis) {
    const takeId = lastTake?.id;
    const currentWorkspace = workspaceRef.current ?? workspace;
    const persistedAnalysis = {
      schemaVersion: "voice.local_acoustic_analysis.v1" as const,
      engine:
        analysis.strategy === undefined
          ? ("whisper-tiny" as const)
          : ("whisper-adaptive" as const),
      transcript: analysis.transcript,
      analyzedAt: new Date().toISOString(),
      ...(analysis.strategy === undefined
        ? {}
        : { strategy: analysis.strategy }),
      words: analysis.whisperWords,
      speechSegments: analysis.speechSegments.map((segment) => ({
        ...segment,
        source: "silero_vad" as const,
      })),
      alignmentComparison: analysis.alignmentComparison,
    };

    if (takeId === undefined) {
      const metadata = freeCaptureMetadataRef.current;
      if (metadata === null) return;
      const expectedText = freeCaptureReviewTranscript ?? analysis.transcript;
      const durationMs =
        typeof metadata.durationMs === "number" ? metadata.durationMs : 0;
      const nextMetadata = {
        ...metadata,
        localAcousticAnalysis: persistedAnalysis,
        timing: {
          schemaVersion: "voice.standalone_timing.v1",
          words: analysis.whisperWords,
          phrases: createAcousticPhraseTimings(
            expectedText,
            analysis.whisperWords,
            durationMs,
          ),
          speechSegments: persistedAnalysis.speechSegments,
        },
      };
      freeCaptureMetadataRef.current = nextMetadata;
      if (typeof metadata.fileName === "string") {
        await saveBrowserRecordingMetadata(
          metadata.fileName,
          nextMetadata,
        ).catch(() => undefined);
      }
      replaceMetadataDownloadUrl(
        URL.createObjectURL(
          new Blob([JSON.stringify(nextMetadata, null, 2)], {
            type: "application/json",
          }),
        ),
      );
      setMessage(
        "Analyse acoustique terminée : mots, phrases et segments vocaux sont intégrés au manifeste.",
      );
      return;
    }

    if (currentWorkspace === null) {
      return;
    }

    let updatedTake: RecordedTake | null = null;
    const nextWorkspace: VoiceWorkspace = {
      ...currentWorkspace,
      updatedAt: new Date().toISOString() as VoiceWorkspace["updatedAt"],
      capturedSessions: currentWorkspace.capturedSessions.map(
        (capturedSession) => ({
          ...capturedSession,
          takes: capturedSession.takes.map((take) => {
            if (take.id !== takeId) return take;
            updatedTake = applyLocalAcousticTiming({
              take,
              analysis: persistedAnalysis,
            });
            return updatedTake;
          }),
        }),
      ),
    };
    const result = await workspaceRepository.save(nextWorkspace);

    if (result.ok && updatedTake !== null) {
      applyWorkspaceReceipt(result.value);
      setLastTake(updatedTake);
    } else if (!result.ok) {
      setMessage(`Analyse terminée, mais non persistée : ${result.message}`);
    }
  }

  function loadBackingTrackFile(file: File) {
    if (!isSupportedAudioFile(file)) {
      setMessage("Charge un fichier audio lisible par le navigateur.");
      return;
    }

    replaceBackingTrack({
      name: file.name,
      url: URL.createObjectURL(file),
    });
    setMessage(`Support audio chargé : ${file.name}.`);
  }

  function clearBackingTrack() {
    replaceBackingTrack(null);
    setMessage("Support audio retiré.");
  }

  function replaceBackingTrack(track: BackingTrack | null) {
    stopBackingTrackPlayback(true);
    revokeObjectUrl(backingTrackUrlRef.current);
    backingTrackUrlRef.current = track?.url ?? null;
    setBackingTrack(track);
  }

  function loadDubbingVideoFile(file: File) {
    if (!isSupportedVideoFile(file)) {
      setMessage("Charge une vidéo MP4, MOV, WebM ou OGV lisible ici.");
      return;
    }

    replaceDubbingMedia({
      kind: "local-video",
      name: file.name,
      url: URL.createObjectURL(file),
    });
    setMessage(
      `Scène locale chargée : ${file.name}. Elle reste sur cet appareil.`,
    );
  }

  function loadDubbingYouTubeUrl(url: string) {
    const source = createYouTubeDubbingSource(url);

    if (source === null) {
      setMessage(
        "Lien YouTube non reconnu. Colle l'adresse complète de la vidéo.",
      );
      return;
    }

    replaceDubbingMedia(source);
    setMessage(
      "Scène YouTube reliée. La vidéo reste distante et nécessite une connexion.",
    );
  }

  function clearDubbingMedia() {
    replaceDubbingMedia(null);
    setMessage("Image de référence retirée. Le script reste disponible.");
  }

  function replaceDubbingMedia(source: DubbingMediaSource | null) {
    revokeObjectUrl(dubbingMediaUrlRef.current);
    dubbingMediaUrlRef.current =
      source?.kind === "local-video" ? source.url : null;
    setDubbingMedia(source);
  }

  async function startBackingTrackPlayback() {
    const audio = backingAudioRef.current;

    if (
      captureMode !== "mastering" ||
      backingTrack === null ||
      audio === null
    ) {
      return;
    }

    audio.volume = backingTrackVolume;
    audio.loop = backingTrackLoop;
    audio.currentTime = 0;

    try {
      await audio.play();
    } catch {
      setMessage(
        "Prise lancée. Le navigateur demande de démarrer le support audio manuellement.",
      );
    }
  }

  function stopBackingTrackPlayback(reset = false) {
    const audio = backingAudioRef.current;

    if (audio === null) {
      return;
    }

    audio.pause();

    if (reset) {
      audio.currentTime = 0;
    }
  }

  function selectSpeaker(speakerId: SpeakerId) {
    const speaker = speakerProfiles.find((item) => item.id === speakerId);

    setSelectedSpeakerId(speakerId);
    setSelectedLanguage(speaker?.primaryLanguage ?? selectedLanguage);
    setSession(null);
    resetTakeOutputState();
  }

  async function createSpeaker(input: CreateSpeakerInput): Promise<boolean> {
    const currentWorkspace = await ensureWorkspace().catch(() => null);

    if (currentWorkspace === null) {
      return false;
    }

    const existingSpeakers =
      currentWorkspace.speakers.length > 0
        ? currentWorkspace.speakers
        : speakerProfiles.map(createWorkspaceSpeakerFromProfile);
    const requestedName = input.displayName.trim();
    const baseDisplayName =
      requestedName.length > 0
        ? requestedName
        : `Voix ${existingSpeakers.length + 1}`;
    const existingNames = new Set(
      existingSpeakers.map((speaker, index) =>
        normalizeSpeakerDisplayName(
          speaker.displayName,
          index,
        ).toLocaleLowerCase("fr-FR"),
      ),
    );
    let displayName = baseDisplayName;
    let suffix = 2;

    while (existingNames.has(displayName.toLocaleLowerCase("fr-FR"))) {
      displayName = `${baseDisplayName} ${suffix}`;
      suffix += 1;
    }

    const languages = normalizeSpeakerLanguages(input.languages);
    const nextSpeaker: WorkspaceSpeaker = {
      speakerId: createSpeakerId(),
      displayName,
      languages,
    };
    const nextWorkspace: VoiceWorkspace = {
      ...currentWorkspace,
      updatedAt: new Date().toISOString() as VoiceWorkspace["updatedAt"],
      speakers: [...existingSpeakers, nextSpeaker],
    };
    const result = await workspaceRepository.save(nextWorkspace);

    if (!result.ok) {
      setMessage(result.message);
      return false;
    }

    applyWorkspaceReceipt(result.value);
    setSelectedSpeakerId(nextSpeaker.speakerId);
    setSelectedLanguage(languages[0] ?? DEFAULT_SPEAKER_LANGUAGE);
    setSession(null);
    resetTakeOutputState();
    setMessage(`${displayName} créée.`);
    return true;
  }

  async function prepareSession() {
    if (captureMode === "lexical-segmentation") {
      await runLexicalSegmentation();
      return;
    }

    const captureBlocker = getCaptureBlocker(diagnostics);

    if (captureBlocker !== null) {
      setIsDirectCaptureStarting(false);
      setMessage(captureBlocker);
      return;
    }

    if (captureMode === "free") {
      setSession(null);
      isFreeCaptureRef.current = true;
      setIsFreeCapture(true);
      setIsContinuousCorpusCapture(false);
      setCurrentPromptIndex(0);
      setSessionRoomTone(null);
      hasCalibratedCurrentSessionRef.current = false;
      resetTakeOutputState();
      setIsDirectCaptureStarting(true);
      setMessage("La capture démarre…");
      await allowMicrophoneAndStart(true);
      return;
    }

    if (activeCorpus === null) {
      setMessage(
        "Ajoute un texte ou glisse un fichier pour créer le corpus local.",
      );
      return;
    }

    if (captureMode === "dubbing" || captureMode === "mastering") {
      if (continuousCorpusText.trim().length === 0) {
        setMessage("Ajoute un corpus avant de lancer la prise continue.");
        return;
      }

      setSession(null);
      isFreeCaptureRef.current = true;
      setIsFreeCapture(true);
      setIsContinuousCorpusCapture(true);
      setCurrentPromptIndex(0);
      setSessionRoomTone(null);
      hasCalibratedCurrentSessionRef.current = false;
      resetTakeOutputState();
      setScreen("permission");
      setMessage(
        captureMode === "mastering"
          ? "Prise continue prête : interprète tout le corpus, puis appuie sur Stop."
          : "Prise continue prête : lis tout le corpus, puis appuie sur Stop.",
      );
      return;
    }

    const currentWorkspace = await ensureWorkspace().catch(() => null);

    if (currentWorkspace === null) {
      return;
    }

    const nextSession = planSession({
      workspace: currentWorkspace,
      corpus: activeCorpus,
      speakerId: selectedSpeakerId,
      language: selectedLanguage,
      targetMinutes: currentWorkspace.settings.preferredSessionMinutes,
      now: new Date(),
      strategy: captureMode === "training" ? "coverage" : "sequential",
    });

    if (nextSession.plannedPromptIds.length === 0) {
      setMessage("Aucune phrase disponible pour cette voix et cette langue.");
      return;
    }

    setSession(nextSession);
    isFreeCaptureRef.current = false;
    setIsFreeCapture(false);
    setIsContinuousCorpusCapture(false);
    setCurrentPromptIndex(0);
    hasCalibratedCurrentSessionRef.current = false;
    setSessionRoomTone(null);
    setRoomToneProgress(0);
    resetTakeOutputState();
    setScreen("permission");
    setMessage(createSessionPreparationMessage(captureMode));
  }

  function loadLexicalSegmentationFile(file: File) {
    if (!isSupportedAudioFile(file) && !isSupportedVideoFile(file)) {
      setLexicalSegmentationState({
        status: "error",
        message: "Charge un fichier audio ou vidéo lisible par le navigateur.",
      });
      return;
    }

    revokeObjectUrl(lexicalSegmentationUrlRef.current);
    lexicalSegmentationUrlRef.current = null;
    setLexicalSegmentationFile(file);
    setLexicalSegmentationState({ status: "idle" });
    setMessage(
      `${file.name} prêt. La vidéo sera ignorée et seule sa piste audio sera découpée.`,
    );
  }

  function clearLexicalSegmentation() {
    lexicalSegmentationAbortRef.current?.abort();
    cancelLoadingWave("lexical-segmentation");
    revokeObjectUrl(lexicalSegmentationUrlRef.current);
    lexicalSegmentationUrlRef.current = null;
    setLexicalSegmentationFile(null);
    setLexicalSegmentationState({ status: "idle" });
    setMessage(createModeMessage("lexical-segmentation"));
  }

  function cancelLexicalSegmentation() {
    lexicalSegmentationAbortRef.current?.abort();
    cancelLoadingWave("lexical-segmentation");
    setMessage("Annulation de l'analyse locale…");
  }

  async function runLexicalSegmentation() {
    const file = lexicalSegmentationFile;
    if (file === null) {
      setMessage("Importe d'abord une vidéo ou un fichier audio.");
      return;
    }

    revokeObjectUrl(lexicalSegmentationUrlRef.current);
    lexicalSegmentationUrlRef.current = null;
    lexicalSegmentationAbortRef.current?.abort();
    const abortController = new AbortController();
    lexicalSegmentationAbortRef.current = abortController;
    beginLoadingWave("lexical-segmentation", "Découpe lexicale locale", 0.02);
    setLexicalSegmentationState({
      status: "running",
      progress: { stage: "loading-model", progressPercent: 0 },
    });
    setMessage("Découpe lexicale en cours, entièrement sur cet appareil…");

    try {
      const { segmentImportedMedia } =
        await import("../analysis/importedMediaSegmentation");
      const result = await segmentImportedMedia({
        file,
        language: selectedLanguage,
        onProgress: (progress) => {
          if (!abortController.signal.aborted) {
            setLexicalSegmentationState({ status: "running", progress });
            updateLoadingWave(
              "lexical-segmentation",
              mapLocalAnalysisToLoadingProgress(progress),
            );
          }
        },
        signal: abortController.signal,
      });
      const downloadUrl = URL.createObjectURL(result.archive);
      lexicalSegmentationUrlRef.current = downloadUrl;
      setLexicalSegmentationState({ status: "done", result, downloadUrl });
      finishLoadingWave("lexical-segmentation");
      setMessage(
        result.manifest.transcription.quality.status === "insufficient"
          ? `${result.manifest.words.length} segment${result.manifest.words.length > 1 ? "s" : ""} candidat${result.manifest.words.length > 1 ? "s" : ""} produit${result.manifest.words.length > 1 ? "s" : ""}. La voix chantée n'a pas été confirmée par le détecteur de parole.`
          : `${result.manifest.words.length} mot${result.manifest.words.length > 1 ? "s" : ""} acoustiquement soutenu${result.manifest.words.length > 1 ? "s" : ""} et découpé${result.manifest.words.length > 1 ? "s" : ""}. Vérification humaine recommandée.`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        cancelLoadingWave("lexical-segmentation");
        setLexicalSegmentationState({ status: "idle" });
        setMessage("Analyse annulée. Le média reste prêt sur cet appareil.");
        return;
      }
      const failureMessage =
        error instanceof Error
          ? error.message
          : "La piste audio n'a pas pu être découpée.";
      setLexicalSegmentationState({
        status: "error",
        message: failureMessage,
      });
      cancelLoadingWave("lexical-segmentation");
      setMessage(failureMessage);
    } finally {
      if (lexicalSegmentationAbortRef.current === abortController) {
        lexicalSegmentationAbortRef.current = null;
      }
    }
  }

  async function updateCaptureProfile(profile: CaptureProfile) {
    const currentWorkspace = await ensureWorkspace().catch(() => null);

    if (currentWorkspace === null) {
      return;
    }

    const nextWorkspace: VoiceWorkspace = {
      ...currentWorkspace,
      updatedAt: new Date().toISOString() as VoiceWorkspace["updatedAt"],
      settings: {
        ...currentWorkspace.settings,
        captureProfile: profile,
      },
    };
    const result = await workspaceRepository.save(nextWorkspace);

    if (result.ok) {
      applyWorkspaceReceipt(result.value);
      setMessage(
        result.value.durability === "memory-only"
          ? createMemoryOnlyWorkspaceMessage()
          : "Profil audio enregistré sur cet appareil.",
      );
    }
  }

  function speakPromptReference() {
    if (activePrompt === undefined || !("speechSynthesis" in window)) {
      setMessage("Lecture de référence indisponible dans ce navigateur.");
      return;
    }

    stopPromptReference();

    const utterance = new SpeechSynthesisUtterance(
      activePrompt.spokenText ?? activePrompt.text,
    );

    utterance.lang = formatSpeechRecognitionLanguage(selectedLanguage);
    utterance.rate = selectedLanguage === "fr" ? 0.94 : 0.98;
    utterance.pitch = 1;
    utterance.onend = () => setIsSpeakingReference(false);
    utterance.onerror = () => setIsSpeakingReference(false);

    setIsSpeakingReference(true);
    window.speechSynthesis.speak(utterance);
  }

  function stopPromptReference() {
    if (!("speechSynthesis" in window)) {
      setIsSpeakingReference(false);
      return;
    }

    window.speechSynthesis.cancel();
    setIsSpeakingReference(false);
  }

  async function allowMicrophoneAndStart(forceFreeCapture = false) {
    const captureIsFree = forceFreeCapture || isFreeCaptureRef.current;

    if (session === null && !captureIsFree) {
      return;
    }

    const captureBlocker = getCaptureBlocker(diagnostics);

    if (captureBlocker !== null) {
      setIsDirectCaptureStarting(false);
      setMessage(captureBlocker);
      return;
    }

    if (pcmRecorderRef.current !== null || isPersistingRef.current) {
      setIsDirectCaptureStarting(false);
      setMessage("Une prise est déjà en cours de finalisation.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setIsDirectCaptureStarting(false);
      setMessage(
        "Micro indisponible ici. Ouvre le site en HTTPS et autorise le micro.",
      );
      return;
    }

    if (
      !window.AudioContext &&
      !(window as WindowWithAudioContext).webkitAudioContext
    ) {
      setIsDirectCaptureStarting(false);
      setMessage(
        "Capture WAV non supportée par ce navigateur. Essaie Chrome récent.",
      );
      return;
    }

    stopPromptReference();

    let stream: MediaStream | null = null;
    const leaseEpoch = microphoneLeaseEpochRef.current;
    microphoneRequestPendingRef.current = true;

    try {
      // The ambient monitor is deliberately raw. Never clone it into a take:
      // acquire a fresh voice-optimised stream so browser AEC/NS can reject
      // loudspeaker and stationary room spill before PCM capture begins.
      ambientNoiseProfileRef.current =
        ambientMonitorRef.current?.snapshot() ?? ambientNoiseProfileRef.current;
      stopAmbientMicrophoneMonitor();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: createVoiceCaptureConstraints(),
      });

      if (
        leaseEpoch !== microphoneLeaseEpochRef.current ||
        document.visibilityState === "hidden"
      ) {
        stream.getTracks().forEach((track) => track.stop());
        setIsDirectCaptureStarting(false);
        storeMicrophoneRevalidation(true);
        setRequiresDeviceRevalidation(true);
        return;
      }

      setMicrophoneLabel(createMicrophoneLabel(stream));

      const needsRoomToneCalibration =
        !hasCalibratedCurrentSessionRef.current && currentPromptIndex === 0;
      const recorder = await createPcmRecorder(stream, {
        ambientPreflight: ambientNoiseProfileRef.current,
        maxDurationMs: captureIsFree ? FREE_CAPTURE_MAX_DURATION_MS : undefined,
        ...(needsRoomToneCalibration ? {} : createInputGainOptions()),
        onLevel: updateVisualAudioLevel,
        onSamples: pushLiveWaveform,
      });

      isPersistingRef.current = false;
      setIsFinalizing(false);
      mediaStreamRef.current = stream;
      pcmRecorderRef.current = recorder;

      await requestRecordingWakeLock();
      if (!hasCalibratedCurrentSessionRef.current && currentPromptIndex === 0) {
        startRoomToneCalibration(stream, recorder);
        return;
      }

      startPromptRecording(
        stream,
        recorder,
        undefined,
        undefined,
        captureIsFree,
      );
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setIsDirectCaptureStarting(false);
      setMessage(createMicrophoneErrorMessage(error));
      void refreshDiagnostics(false);
    } finally {
      microphoneRequestPendingRef.current = false;
    }
  }

  function startPromptRecording(
    stream: MediaStream,
    recorder: PcmRecorder,
    message = captureMode === "mastering"
      ? "Enregistrement en cours. Chante naturellement : le guide suit la performance sans juger la diction comme une lecture."
      : "Enregistrement en cours. Lis ou chante naturellement : le texte suit ta voix.",
    calibratedRoomTone: RoomToneCalibration | null = sessionRoomTone,
    freeCapture = isFreeCaptureRef.current,
  ) {
    clearRoomToneTimers();
    mediaStreamRef.current = stream;
    pcmRecorderRef.current = recorder;
    captureRecordingStartedAtRef.current = performance.now();
    resetVisualAudioLevel();
    setActiveWordIndex(0);
    setScreen("karaoke");
    setIsDirectCaptureStarting(false);
    setMessage(message);
    realtimeSpeechActivityRef.current = createRealtimeSpeechActivityDetector({
      noiseFloorDbfs: calibratedRoomTone?.noiseFloorDbfs,
    });

    if (isContinuousCorpusCapture) {
      startReadingGuide(continuousGuideWords, selectedLanguage);
      scheduleFreeCaptureLimit();
    } else if (!freeCapture) {
      startReadingGuide(words, selectedLanguage);
    } else {
      startFreeWordDetection(selectedLanguage);
      scheduleFreeCaptureLimit();
    }

    if (captureMode === "mastering") {
      void startBackingTrackPlayback();
    }
  }

  function startReadingGuide(
    promptWords: readonly string[],
    language: LanguageCode,
  ) {
    stopReadingGuide();

    readingGuideStartedAtRef.current = performance.now();
    readingGuideLastTickAtRef.current = readingGuideStartedAtRef.current;
    readingGuideLastSpeechAtRef.current = readingGuideStartedAtRef.current;
    readingGuideProgressRef.current = 0;
    readingGuideAlignmentRef.current = alignPromptToPhonemes({
      durationMs: Math.round(
        estimateSpeechGuideDurationMs(promptWords, activePrompt),
      ),
      language,
      text: promptWords.join(" "),
    });
    lastTranscriptAtRef.current = 0;
    activeWordIndexRef.current = 0;
    setActiveWordIndex(0);
    setRecognizedTranscript("");
    recognizedFinalTranscriptRef.current = "";
    speechRecognitionHypothesesRef.current = [];
    speechRecognitionSessionRef.current = createSpeechRecognitionSession();
    speechRecognitionResultOffsetRef.current = 0;
    speechRecognitionSessionResultCountRef.current = 0;
    speechRecognitionRestartEnabledRef.current = true;
    speechRecognitionBiasEnabledRef.current = true;
    readingGuideFinalAlignmentConfirmedAtRef.current = null;
    readingGuideLiveAlignmentCompletedAtRef.current = null;
    liveWordStartedAtMsRef.current = Array<number | null>(
      promptWords.length,
    ).fill(null);
    resetLiveReadingGuidePosition();

    const speechRecognitionStarted =
      (captureMode !== "mastering" || isContinuousCorpusCapture) &&
      startSpeechRecognitionGuide(promptWords, language);

    setReadingGuideMode(
      speechRecognitionStarted ? "speech-recognition" : "voice-activity",
    );

    readingGuideIntervalRef.current = window.setInterval(() => {
      updateVoiceActivityGuide(promptWords);
    }, 90);
  }

  function startSpeechRecognitionGuide(
    promptWords: readonly string[],
    language: LanguageCode,
  ): boolean {
    const SpeechRecognitionConstructor =
      (window as WindowWithSpeechRecognition).SpeechRecognition ??
      (window as WindowWithSpeechRecognition).webkitSpeechRecognition;

    if (SpeechRecognitionConstructor === undefined) {
      return false;
    }

    try {
      const recognition = new SpeechRecognitionConstructor();
      const speechWindow = window as WindowWithSpeechRecognition;
      let restartAllowed = true;

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = formatSpeechRecognitionLanguage(language);
      recognition.maxAlternatives = 3;
      if (speechRecognitionLocalReadyRef.current) {
        recognition.processLocally = true;
      }
      if (speechRecognitionBiasEnabledRef.current) {
        const phrases = createSpeechRecognitionBiasPhrases(
          promptWords,
          speechWindow.SpeechRecognitionPhrase,
        );

        if (phrases.length > 0) {
          try {
            recognition.phrases = [...phrases];
          } catch {
            // Contextual biasing is progressive; recognition itself remains
            // useful when an implementation exposes only the older surface.
            speechRecognitionBiasEnabledRef.current = false;
          }
        }
      }
      recognition.onresult = (event) => {
        const now = performance.now();

        speechRecognitionSessionRef.current = updateSpeechRecognitionSession(
          speechRecognitionSessionRef.current,
          event,
          { promptWords },
        );
        speechRecognitionSessionResultCountRef.current = Math.max(
          speechRecognitionSessionResultCountRef.current,
          event.results.length,
        );
        const transcript = getSpeechRecognitionDisplayText(
          speechRecognitionSessionRef.current,
        );
        const finalTranscript = getSpeechRecognitionFinalText(
          speechRecognitionSessionRef.current,
        );

        speechRecognitionHypothesesRef.current =
          mergeSpeechRecognitionHypotheses(
            speechRecognitionHypothesesRef.current,
            event,
            Math.max(0, now - readingGuideStartedAtRef.current),
            speechRecognitionResultOffsetRef.current,
          );

        if (finalTranscript.length > 0) {
          recognizedFinalTranscriptRef.current = finalTranscript;
          const finalAlignment = alignTranscriptToPromptDetailed(
            promptWords,
            finalTranscript,
          );
          const minimumFinalMatches = Math.max(
            1,
            Math.ceil(promptWords.length * 0.72),
          );

          if (
            finalAlignment.position.wordIndex === promptWords.length - 1 &&
            finalAlignment.matchedWordCount >= minimumFinalMatches &&
            finalAlignment.score >= 0.68
          ) {
            readingGuideFinalAlignmentConfirmedAtRef.current ??= now;
            updateReadingGuideIndex(
              finalAlignment.position.wordIndex,
              promptWords.length,
            );
          }
        }

        if (transcript.length === 0) {
          return;
        }

        const alignment = alignTranscriptToPromptDetailed(
          promptWords,
          transcript,
        );

        if (alignment.matchedWordCount === 0 || alignment.score < 0.42) {
          return;
        }

        recordLiveWordPosition(
          alignment.position.wordIndex,
          promptWords.length,
          now,
        );

        const minimumLiveMatches = Math.max(
          1,
          Math.ceil(promptWords.length * 0.72),
        );
        if (
          alignment.position.wordIndex === promptWords.length - 1 &&
          alignment.matchedWordCount >= minimumLiveMatches &&
          alignment.score >= 0.68
        ) {
          readingGuideLiveAlignmentCompletedAtRef.current ??= now;
        }

        lastTranscriptAtRef.current = now;
        readingGuideLastSpeechAtRef.current = lastTranscriptAtRef.current;
        setRecognizedTranscript(transcript);
        const position = alignment.position;
        const alignedWord =
          readingGuideAlignmentRef.current?.words[position.wordIndex];

        if (alignedWord !== undefined) {
          readingGuideProgressRef.current = Math.max(
            readingGuideProgressRef.current,
            alignedWord.startMs +
              (alignedWord.endMs - alignedWord.startMs) * position.wordProgress,
          );
        }

        setLiveReadingGuidePosition({
          ...position,
          source: "speech-recognition",
        });
        updateReadingGuideIndex(position.wordIndex, promptWords.length);
      };
      recognition.onerror = (event) => {
        const error = event.error ?? "unknown";

        if (error === "phrases-not-supported") {
          speechRecognitionBiasEnabledRef.current = false;
        } else if (
          error === "not-allowed" ||
          error === "service-not-allowed" ||
          error === "audio-capture" ||
          error === "language-not-supported"
        ) {
          restartAllowed = false;
          speechRecognitionRestartEnabledRef.current = false;
        }

        if (!restartAllowed) {
          setReadingGuideMode("voice-activity");
        }
      };
      recognition.onend = () => {
        if (speechRecognitionRef.current === recognition) {
          speechRecognitionRef.current = null;
        }

        commitCurrentSpeechRecognitionSession();

        if (
          restartAllowed &&
          speechRecognitionRestartEnabledRef.current &&
          screenRef.current === "karaoke" &&
          !isPersistingRef.current &&
          pcmRecorderRef.current !== null
        ) {
          scheduleSpeechRecognitionRestart(() => {
            if (startSpeechRecognitionGuide(promptWords, language)) {
              setReadingGuideMode("speech-recognition");
            }
          });
        } else if (!restartAllowed) {
          setReadingGuideMode("voice-activity");
        }
      };

      recognition.start();
      speechRecognitionRef.current = recognition;

      return true;
    } catch {
      return false;
    }
  }

  function startFreeWordDetection(language: LanguageCode) {
    stopReadingGuide();
    setRecognizedTranscript("");
    recognizedFinalTranscriptRef.current = "";
    freeSpeechRecognitionAvailableRef.current = false;
    speechRecognitionSessionRef.current = createSpeechRecognitionSession();
    speechRecognitionResultOffsetRef.current = 0;
    speechRecognitionSessionResultCountRef.current = 0;
    speechRecognitionRestartEnabledRef.current = true;

    if (startFreeSpeechRecognitionSession(language)) {
      freeSpeechRecognitionAvailableRef.current = true;
      setReadingGuideMode("speech-recognition");
    } else {
      setReadingGuideMode("voice-activity");
    }
  }

  function startFreeSpeechRecognitionSession(language: LanguageCode): boolean {
    const SpeechRecognitionConstructor =
      (window as WindowWithSpeechRecognition).SpeechRecognition ??
      (window as WindowWithSpeechRecognition).webkitSpeechRecognition;

    if (SpeechRecognitionConstructor === undefined) {
      return false;
    }

    try {
      const recognition = new SpeechRecognitionConstructor();
      let restartAllowed = true;

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = formatSpeechRecognitionLanguage(language);
      recognition.maxAlternatives = 1;
      if (speechRecognitionLocalReadyRef.current) {
        recognition.processLocally = true;
      }
      recognition.onresult = (event) => {
        speechRecognitionSessionRef.current = updateSpeechRecognitionSession(
          speechRecognitionSessionRef.current,
          event,
        );
        speechRecognitionSessionResultCountRef.current = Math.max(
          speechRecognitionSessionResultCountRef.current,
          event.results.length,
        );
        const displayTranscript = getSpeechRecognitionDisplayText(
          speechRecognitionSessionRef.current,
        );
        const finalTranscript = getSpeechRecognitionFinalText(
          speechRecognitionSessionRef.current,
        );

        if (displayTranscript.length > 0) {
          setRecognizedTranscript(displayTranscript);
        }

        if (finalTranscript.length > 0) {
          recognizedFinalTranscriptRef.current = finalTranscript;
        }
      };
      recognition.onerror = (event) => {
        const error = event.error ?? "unknown";

        if (
          error === "not-allowed" ||
          error === "service-not-allowed" ||
          error === "audio-capture" ||
          error === "language-not-supported"
        ) {
          restartAllowed = false;
          speechRecognitionRestartEnabledRef.current = false;
        }
      };
      recognition.onend = () => {
        if (speechRecognitionRef.current === recognition) {
          speechRecognitionRef.current = null;
        }

        commitCurrentSpeechRecognitionSession();

        if (
          restartAllowed &&
          speechRecognitionRestartEnabledRef.current &&
          screenRef.current === "karaoke" &&
          !isPersistingRef.current &&
          pcmRecorderRef.current !== null
        ) {
          scheduleSpeechRecognitionRestart(() => {
            if (startFreeSpeechRecognitionSession(language)) {
              setReadingGuideMode("speech-recognition");
            }
          });
        } else if (!restartAllowed) {
          setReadingGuideMode("voice-activity");
        }
      };

      recognition.start();
      speechRecognitionRef.current = recognition;
      return true;
    } catch {
      return false;
    }
  }

  function commitCurrentSpeechRecognitionSession() {
    speechRecognitionSessionRef.current = commitSpeechRecognitionSession(
      speechRecognitionSessionRef.current,
    );
    speechRecognitionResultOffsetRef.current +=
      speechRecognitionSessionResultCountRef.current;
    speechRecognitionSessionResultCountRef.current = 0;
    const finalTranscript = getSpeechRecognitionFinalText(
      speechRecognitionSessionRef.current,
    );

    if (finalTranscript.length > 0) {
      recognizedFinalTranscriptRef.current = finalTranscript;
    }
  }

  function scheduleSpeechRecognitionRestart(restart: () => void) {
    clearSpeechRecognitionRestartTimer();
    speechRecognitionRestartTimerRef.current = window.setTimeout(() => {
      speechRecognitionRestartTimerRef.current = null;

      if (
        speechRecognitionRestartEnabledRef.current &&
        screenRef.current === "karaoke" &&
        !isPersistingRef.current &&
        pcmRecorderRef.current !== null
      ) {
        restart();
      }
    }, 140);
  }

  function clearSpeechRecognitionRestartTimer() {
    if (speechRecognitionRestartTimerRef.current !== null) {
      window.clearTimeout(speechRecognitionRestartTimerRef.current);
      speechRecognitionRestartTimerRef.current = null;
    }
  }

  function updateVoiceActivityGuide(promptWords: readonly string[]) {
    if (promptWords.length === 0 || screenRef.current !== "karaoke") {
      return;
    }

    const now = performance.now();
    const deltaMs = Math.max(0, now - readingGuideLastTickAtRef.current);

    readingGuideLastTickAtRef.current = now;

    const level = visualAudioLevelRef.current;
    const speechActivity = realtimeSpeechActivityRef.current?.snapshot(now);
    const isVoiceActive =
      speechActivity?.active ??
      level >= voiceActivationThreshold(sessionRoomTone);
    const recognitionIsFresh =
      readingGuideModeRef.current === "speech-recognition" &&
      lastTranscriptAtRef.current > 0 &&
      now - lastTranscriptAtRef.current < 1600;

    if (speechActivity?.hasDetectedSpeech === true) {
      readingGuideLastSpeechAtRef.current = speechActivity.lastSpeechAtMs;
    } else if (isVoiceActive) {
      readingGuideLastSpeechAtRef.current = now;
    }

    if (!isVoiceActive || recognitionIsFresh) {
      evaluateReadingGuideEndpoint(promptWords.length, now);
      return;
    }

    const alignment = readingGuideAlignmentRef.current;

    if (alignment === null) {
      return;
    }

    const energyFactor = 0.72 + Math.min(0.55, level * 0.7);

    readingGuideProgressRef.current = Math.min(
      alignment.durationMs,
      readingGuideProgressRef.current + deltaMs * energyFactor,
    );
    const position = wordPositionFromTimings(
      alignment.words,
      readingGuideProgressRef.current,
    );

    setLiveReadingGuidePosition({
      ...position,
      source: "voice-activity",
    });
    updateReadingGuideIndex(position.wordIndex, promptWords.length);
    evaluateReadingGuideEndpoint(promptWords.length, now);
  }

  function updateReadingGuideIndex(nextIndex: number, wordCount: number) {
    if (wordCount === 0) {
      return;
    }

    const boundedIndex = Math.max(0, Math.min(wordCount - 1, nextIndex));

    if (boundedIndex > activeWordIndexRef.current) {
      activeWordIndexRef.current = boundedIndex;
      setActiveWordIndex(boundedIndex);
    }

    if (boundedIndex < wordCount - 1) clearReadingGuideFinishTimer();
  }

  function recordLiveWordPosition(
    wordIndex: number,
    wordCount: number,
    observedAtMs: number,
  ) {
    if (wordIndex < 0 || wordIndex >= wordCount) return;
    if (liveWordStartedAtMsRef.current[wordIndex] !== null) return;
    const observedAt = Math.max(
      0,
      observedAtMs - captureRecordingStartedAtRef.current,
    );
    for (let index = 0; index <= wordIndex; index += 1) {
      liveWordStartedAtMsRef.current[index] ??=
        (observedAt * (index + 1)) / (wordIndex + 1);
    }
  }

  function createLiveWordTimings(
    promptWords: readonly string[],
    durationMs: number,
  ) {
    const observed = liveWordStartedAtMsRef.current;
    if (promptWords.length === 0 || observed[promptWords.length - 1] == null) {
      return [];
    }

    return promptWords.map((word, index) => ({
      word,
      startMs: Math.round(observed[index] ?? 0),
      endMs: Math.round(observed[index + 1] ?? durationMs),
    }));
  }

  function evaluateReadingGuideEndpoint(wordCount: number, now: number) {
    if (!isReadingGuideEndpointReady(wordCount, now)) {
      clearReadingGuideFinishTimer();
      return;
    }

    if (
      readingGuideFinishTimerRef.current !== null ||
      isPersistingRef.current
    ) {
      return;
    }

    readingGuideFinishTimerRef.current = window.setTimeout(() => {
      readingGuideFinishTimerRef.current = null;

      if (
        screenRef.current === "karaoke" &&
        !isPersistingRef.current &&
        isReadingGuideEndpointReady(wordCount, performance.now())
      ) {
        void finishRecordingRef.current();
      }
    }, 90);
  }

  function isReadingGuideEndpointReady(
    wordCount: number,
    now: number,
  ): boolean {
    if (
      wordCount === 0 ||
      activeWordIndexRef.current < wordCount - 1 ||
      isPersistingRef.current
    ) {
      return false;
    }

    const speechActivity = realtimeSpeechActivityRef.current?.snapshot(now);

    if (speechActivity !== undefined) {
      if (!speechActivity.hasDetectedSpeech) {
        return false;
      }
    }

    const trailingSilenceMs =
      speechActivity?.trailingSilenceMs ??
      Math.max(0, now - readingGuideLastSpeechAtRef.current);
    const expressiveEnding = /[!?…]\s*$/u.test(activePrompt?.text ?? "");

    const endpointConfirmedAtMs =
      readingGuideFinalAlignmentConfirmedAtRef.current ??
      readingGuideLiveAlignmentCompletedAtRef.current;
    if (endpointConfirmedAtMs !== null) {
      return isConfirmedMlEndpointReady({
        finalAlignmentConfirmedAtMs: endpointConfirmedAtMs,
        nowMs: now,
        expressiveEnding,
        speechActive: speechActivity?.active ?? false,
        trailingSilenceMs,
      });
    }

    if (speechActivity?.active === true) {
      return false;
    }

    const requiredSilenceMs = captureMode === "mastering" ? 1_500 : 1_050;

    if (trailingSilenceMs < requiredSilenceMs) {
      return false;
    }

    const alignment = readingGuideAlignmentRef.current;
    const finalWord = alignment?.words[wordCount - 1];
    const fallbackReachedFinalWord =
      finalWord !== undefined &&
      readingGuideProgressRef.current >= finalWord.startMs;
    const minimumPlausibleDuration =
      estimateSpeechGuideDurationMs(words, activePrompt) *
      (captureMode === "mastering" ? 0.9 : 0.55);

    return (
      fallbackReachedFinalWord &&
      now - readingGuideStartedAtRef.current >= minimumPlausibleDuration
    );
  }

  function setReadingGuideMode(mode: ReadingGuideMode) {
    readingGuideModeRef.current = mode;
    setReadingGuideModeState(mode);
  }

  function stopReadingGuide() {
    const recognition = speechRecognitionRef.current;

    speechRecognitionRestartEnabledRef.current = false;
    clearSpeechRecognitionRestartTimer();
    speechRecognitionRef.current = null;

    if (recognition !== null) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      try {
        recognition.abort();
      } catch {
        // Some browser implementations throw when recognition is already stopped.
      }
    }

    if (readingGuideIntervalRef.current !== null) {
      window.clearInterval(readingGuideIntervalRef.current);
      readingGuideIntervalRef.current = null;
    }

    readingGuideAlignmentRef.current = null;
    resetLiveReadingGuidePosition();
    clearReadingGuideFinishTimer();
  }

  async function stopFreeWordDetection() {
    speechRecognitionRestartEnabledRef.current = false;
    clearSpeechRecognitionRestartTimer();
    const recognition = speechRecognitionRef.current;

    if (recognition === null) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeout);
        if (speechRecognitionRef.current === recognition) {
          speechRecognitionRef.current = null;
        }
        commitCurrentSpeechRecognitionSession();
        resolve();
      };
      const timeout = window.setTimeout(() => {
        try {
          recognition.abort();
        } catch {
          // Recognition may already have stopped after the final result.
        }
        finish();
      }, 750);

      recognition.onend = finish;
      recognition.onerror = finish;

      try {
        recognition.stop();
      } catch {
        finish();
      }
    });
  }

  function clearReadingGuideFinishTimer() {
    if (readingGuideFinishTimerRef.current !== null) {
      window.clearTimeout(readingGuideFinishTimerRef.current);
      readingGuideFinishTimerRef.current = null;
    }
  }

  function scheduleFreeCaptureLimit() {
    clearFreeCaptureLimitTimer();

    freeCaptureLimitTimerRef.current = window.setTimeout(() => {
      freeCaptureLimitTimerRef.current = null;

      if (screenRef.current === "karaoke" && !isPersistingRef.current) {
        setMessage(
          "Limite de capture atteinte : préparation du WAV pour préserver la mémoire de l'appareil.",
        );
        void finishRecordingRef.current();
      }
    }, FREE_CAPTURE_MAX_DURATION_MS);
  }

  function clearFreeCaptureLimitTimer() {
    if (freeCaptureLimitTimerRef.current !== null) {
      window.clearTimeout(freeCaptureLimitTimerRef.current);
      freeCaptureLimitTimerRef.current = null;
    }
  }

  function startRoomToneCalibration(
    stream: MediaStream,
    recorder: PcmRecorder,
  ) {
    clearRoomToneTimers();
    roomToneStartedAtRef.current = performance.now();
    setRoomToneProgress(0);
    setScreen("calibration");
    setMessage(
      "Silence de pièce en cours. Ne parle pas pendant trois secondes.",
    );

    roomToneProgressTimerRef.current = window.setInterval(() => {
      const elapsedMs = performance.now() - roomToneStartedAtRef.current;
      setRoomToneProgress(Math.min(1, elapsedMs / ROOM_TONE_CAPTURE_MS));
    }, 80);
    roomToneCaptureTimerRef.current = window.setTimeout(() => {
      void finishRoomToneCalibration(stream, recorder);
    }, ROOM_TONE_CAPTURE_MS);
  }

  async function finishRoomToneCalibration(
    stream: MediaStream,
    recorder: PcmRecorder,
  ) {
    clearRoomToneTimers();
    setRoomToneProgress(1);

    if (
      pcmRecorderRef.current !== recorder ||
      mediaStreamRef.current !== stream
    ) {
      return;
    }

    try {
      setMessage("Silence capté. Redémarrage de la prise...");
      const roomToneRecording = await recorder.stop();

      if (pcmRecorderRef.current === recorder) {
        pcmRecorderRef.current = null;
      }

      const calibration = createRoomToneCalibration(roomToneRecording.metrics);
      const roomToneSha256 = await sha256Blob(roomToneRecording.blob);
      const roomToneFileName = `room-tone-${Date.now()}-${roomToneSha256.slice(0, 12)}.wav`;
      const roomToneSaveResult = await saveRecordingToWorkspaceFolder(
        roomToneFileName,
        roomToneRecording.blob,
      );

      setSessionRoomTone(calibration);
      hasCalibratedCurrentSessionRef.current = true;
      await persistRoomToneCalibration(
        calibration,
        roomToneSaveResult.ok ? roomToneFileName : null,
        roomToneSaveResult.ok ? roomToneSha256 : null,
      );

      if (mediaStreamRef.current !== stream) {
        return;
      }

      const nextRecorder = await createPcmRecorder(stream, {
        ambientPreflight: ambientNoiseProfileRef.current,
        ...(isFreeCaptureRef.current
          ? { maxDurationMs: FREE_CAPTURE_MAX_DURATION_MS }
          : {}),
        ...createInputGainOptions(),
        onLevel: updateVisualAudioLevel,
        onSamples: pushLiveWaveform,
      });

      startPromptRecording(
        stream,
        nextRecorder,
        captureMode === "mastering"
          ? `Salle calibrée : bruit de fond ${calibration.noiseFloorDbfs} dBFS. Enregistrement de l'interprétation chantée.`
          : `Salle calibrée : bruit de fond ${calibration.noiseFloorDbfs} dBFS. Enregistrement de la phrase parlée ou chantée.`,
        calibration,
        isFreeCaptureRef.current,
      );
    } catch {
      if (pcmRecorderRef.current === recorder) {
        pcmRecorderRef.current = null;
      }

      stopMediaStream();
      setScreen("permission");
      setMessage(
        "La calibration de la salle a échoué. Relance la prise depuis cette phrase.",
      );
    }
  }

  async function persistRoomToneCalibration(
    calibration: RoomToneCalibration,
    roomToneFileName: string | null,
    roomToneSha256: string | null,
  ) {
    const currentWorkspace = await ensureWorkspace().catch(() => null);

    if (currentWorkspace === null) {
      return;
    }

    const nextWorkspace: VoiceWorkspace = {
      ...currentWorkspace,
      updatedAt: new Date().toISOString() as VoiceWorkspace["updatedAt"],
      settings: {
        ...currentWorkspace.settings,
        captureProfile: {
          ...currentWorkspace.settings.captureProfile,
          roomToneCaptured: true,
          roomToneNoiseFloorDbfs: calibration.noiseFloorDbfs,
          roomTonePeakDbfs: calibration.peakDbfs,
          roomToneIntegratedLufs: calibration.integratedLufs,
          roomToneDurationMs: calibration.durationMs,
          calibratedAt:
            new Date().toISOString() as CaptureProfile["calibratedAt"],
          roomToneFileName: roomToneFileName ?? undefined,
          roomToneSha256: roomToneSha256 ?? undefined,
        },
      },
    };
    const result = await workspaceRepository.save(nextWorkspace);

    if (result.ok) {
      applyWorkspaceReceipt(result.value);
      return;
    }

    workspaceRef.current = nextWorkspace;
    setWorkspace(nextWorkspace);
  }

  async function finishRecording() {
    if (isPersistingRef.current) {
      setMessage(
        "Finalisation en cours. Garde cette page ouverte quelques secondes.",
      );
      return;
    }

    const recorder = pcmRecorderRef.current;

    if (recorder !== null) {
      clearFreeCaptureLimitTimer();
      pcmRecorderRef.current = null;
      isPersistingRef.current = true;
      setIsFinalizing(true);
      setMessage("Préparation du fichier...");

      try {
        if (isFreeCapture) {
          await stopFreeWordDetection();
        }
        const recording = await recorder.stop();
        await persistFinishedSession(recording);
      } catch {
        stopMediaStream();
        setScreen("permission");
        setMessage(
          "La prise n'a pas pu être finalisée. Réessaie depuis la même phrase.",
        );
      } finally {
        isPersistingRef.current = false;
        setIsFinalizing(false);
      }

      return;
    }

    setMessage("Aucune prise en cours.");
  }

  async function persistFinishedSession(recording: FinalizedRecording) {
    stopMediaStream();
    resetVisualAudioLevel();

    const currentWorkspace = workspaceRef.current ?? workspace;

    if (isFreeCapture) {
      await persistFreeCapture(recording);
      return;
    }

    if (
      currentWorkspace === null ||
      session === null ||
      activeCorpus === null
    ) {
      setMessage(
        "Espace local indisponible. La prise n'a pas été enregistrée.",
      );
      return;
    }

    const recordedAt = new Date();
    const speechRecognitionAvailable =
      "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
    const finalization = await finalizeCaptureSession({
      activePrompt,
      captureMode:
        captureMode === "dubbing" || captureMode === "mastering"
          ? captureMode
          : "training",
      corpus: activeCorpus,
      folderName,
      recognizedTranscript: recognizedFinalTranscriptRef.current,
      liveWordTimings: createLiveWordTimings(
        words,
        recording.metrics.durationMs,
      ),
      recordedAt,
      recording,
      speechRecognition: createBrowserAsrObservation({
        available: speechRecognitionAvailable,
        engine:
          "SpeechRecognition" in window
            ? "SpeechRecognition"
            : "webkitSpeechRecognition" in window
              ? "webkitSpeechRecognition"
              : null,
        generatedAt: recordedAt.toISOString(),
        hypotheses: speechRecognitionHypothesesRef.current,
        locale: formatSpeechRecognitionLanguage(selectedLanguage),
        userAgent: navigator.userAgent,
      }),
      saveRecording: saveRecordingToWorkspaceFolder,
      saveTakeMetadata: saveTakeMetadataToWorkspaceFolder,
      saveWorkspace: workspaceRepository.save,
      selectedSpeaker,
      session,
      workspace: currentWorkspace,
    });
    const nextDownloadUrl = finalization.audioDownloadAvailable
      ? URL.createObjectURL(finalization.audioBlob)
      : null;

    if (finalization.workspaceSaveResult.ok) {
      applyWorkspaceReceipt(finalization.workspaceSaveResult.value);
    }

    await refreshStoredRecordings();

    setSavedFileName(
      finalization.audioSaveResult.ok
        ? finalization.audioSaveResult.value.fileName
        : nextDownloadUrl === null
          ? null
          : finalization.fileName,
    );
    setSavedLocation(
      finalization.audioSaveResult.ok
        ? formatSaveTarget(finalization.audioSaveResult.value.target)
        : nextDownloadUrl === null
          ? null
          : "Téléchargement uniquement",
    );
    replaceDownloadUrl(nextDownloadUrl);
    replaceMetadataDownloadUrl(
      URL.createObjectURL(
        new Blob(
          [JSON.stringify(finalization.metadataDownloadPayload, null, 2)],
          { type: "application/json" },
        ),
      ),
    );
    setLastTake(finalization.take);
    setSession(finalization.completedSession);
    setScreen("done");
    const progressionMessage =
      captureMode !== "training" || finalization.take === null
        ? null
        : finalization.take.quality.verdict === "pass"
          ? "Prise validée : le parcours ML a avancé d'une phrase."
          : "Prise sauvegardée, mais non validée : le parcours ML reste inchangé. Reprends cette phrase ou passe sans la créditer.";
    setMessage(
      !finalization.workspaceSaveResult.ok
        ? `Prise exportable, mais la progression locale n'a pas été mise à jour : ${finalization.workspaceSaveResult.message}`
        : finalization.metadataSaveMessage !== null
          ? `${progressionMessage ?? "Prise sauvegardée."} ${finalization.metadataSaveMessage} Télécharge le JSON complémentaire.`
          : !finalization.audioSaveResult.ok
            ? `${captureMode === "training" ? "Le parcours ML reste inchangé." : "La prise n'a pas été enregistrée dans le stockage local."} ${
                nextDownloadUrl === null
                  ? finalization.audioSaveResult.message
                  : "Stockage interne refusé : télécharge le fichier maintenant."
              }`
            : progressionMessage !== null
              ? progressionMessage
              : "Prise sauvegardée. Télécharge l'audio et les métadonnées si besoin.",
    );
  }

  async function persistFreeCapture(recording: FinalizedRecording) {
    const recordedAt = new Date();
    const takeId = createTakeId(recordedAt);
    const recordedMode =
      isContinuousCorpusCapture &&
      (captureMode === "dubbing" || captureMode === "mastering")
        ? captureMode
        : "free";
    const fileName = createRecordingFileName({
      extension: recording.extension,
      sessionId: recordedMode as never,
      takeId,
    });
    const audioSaveResult = await saveRecordingToWorkspaceFolder(
      fileName,
      recording.blob,
    );
    const audioUrl =
      recording.blob.size > 0 ? URL.createObjectURL(recording.blob) : null;
    const vocalPerformance = assessVocalPerformance({
      captureMode: recordedMode,
      metrics: recording.metrics,
      sungIntent: isContinuousCorpusCapture && captureMode === "mastering",
    });
    const freeCaptureTranscript = createFreeCaptureTranscript({
      finalTranscript: recognizedFinalTranscriptRef.current,
      performanceKind: vocalPerformance.kind,
      recognitionAvailable: freeSpeechRecognitionAvailableRef.current,
    });
    const metadata = {
      schemaVersion: isContinuousCorpusCapture
        ? "voice.continuous_corpus_capture.v1"
        : "voice.free_capture.v1",
      mode: recordedMode,
      recordedAt: recordedAt.toISOString(),
      durationMs: recording.metrics.durationMs,
      fileName,
      media: {
        byteLength: recording.blob.size,
        mimeType: recording.mimeType,
        sha256:
          recording.blob.size > 0 ? await sha256Blob(recording.blob) : null,
        capture: recording.capture,
      },
      metrics: recording.metrics,
      roomTone: sessionRoomTone,
      speaker: selectedSpeaker ?? null,
      language: selectedLanguage,
      processing: { localOnly: true, audioWorkletPreferred: true },
      vocalPerformance,
      corpus: isContinuousCorpusCapture
        ? {
            id: activeCorpus?.id ?? null,
            version: activeCorpus?.version ?? null,
            text: continuousCorpusText,
            capture: "continuous",
          }
        : null,
      transcript: freeCaptureTranscript,
    };
    freeCaptureMetadataRef.current = metadata;
    if (audioSaveResult.ok) {
      await saveBrowserRecordingMetadata(fileName, metadata).catch(
        () => undefined,
      );
    }
    replaceDownloadUrl(audioUrl);
    replaceMetadataDownloadUrl(
      URL.createObjectURL(
        new Blob([JSON.stringify(metadata, null, 2)], {
          type: "application/json",
        }),
      ),
    );
    setSavedFileName(fileName);
    setSavedLocation(
      audioSaveResult.ok
        ? formatSaveTarget(audioSaveResult.value.target)
        : "Téléchargement uniquement",
    );
    setLastTake(null);
    setFreeCaptureReviewTranscript(
      isContinuousCorpusCapture
        ? continuousCorpusText
        : freeCaptureTranscript.text,
    );
    setFreeCaptureReviewTranscriptCandidate(
      !isContinuousCorpusCapture &&
        freeCaptureTranscript.status === "candidate-sung",
    );
    await refreshStoredRecordings();
    setScreen("done");
    setMessage(
      audioSaveResult.ok
        ? isContinuousCorpusCapture
          ? "Corpus complet sauvegardé en une prise. Le WAV et le manifeste sont prêts."
          : "Capture libre sauvegardée. Le WAV et le manifeste complet sont prêts."
        : "Capture prête. Télécharge le WAV et son manifeste JSON.",
    );
  }

  function retakeCurrentPrompt() {
    resetTakeOutputState();
    setScreen("permission");
    setMessage(
      "Même phrase. Conserve l'intention, corrige seulement la prise.",
    );
  }

  function continueToNextPrompt() {
    if (session === null) {
      return;
    }

    const nextIndex = currentPromptIndex + 1;

    if (nextIndex >= session.plannedPromptIds.length) {
      setScreen("technical");
      setMessage(
        "Session terminée. Consulte la qualité pour savoir quoi enregistrer ensuite.",
      );
      return;
    }

    setCurrentPromptIndex(nextIndex);
    resetTakeOutputState();
    setScreen("permission");
    setMessage("Phrase suivante. Même distance micro, même posture.");
  }

  async function refreshStoredRecordings() {
    try {
      const recordings = await listBrowserRecordings();

      replaceStoredRecordings(
        recordings.map((recording) => ({
          ...recording,
          url: URL.createObjectURL(recording.blob),
        })),
      );
    } catch {
      replaceStoredRecordings([]);
    }
  }

  async function refreshDiagnostics(updateMessage = true) {
    const nextDiagnostics = await inspectRuntime();

    setDiagnostics(nextDiagnostics);

    if (updateMessage) {
      setMessage(createRuntimeHomeMessage(nextDiagnostics));
    }

    return nextDiagnostics;
  }

  async function clearCachedModels() {
    if (!("caches" in window)) {
      setMessage(
        "Le cache des modèles n'est pas disponible dans ce navigateur.",
      );
      return;
    }

    try {
      const cacheNames = await caches.keys();
      const modelCaches = cacheNames.filter((name) =>
        name.startsWith("voice-capture-studio-models-"),
      );

      await Promise.all(modelCaches.map((name) => caches.delete(name)));
      setMessage(
        modelCaches.length === 0
          ? "Aucun modèle local en cache."
          : "Cache des modèles supprimé. La prochaine analyse les téléchargera à nouveau.",
      );
    } catch {
      setMessage(
        "Impossible de supprimer le cache des modèles dans ce navigateur.",
      );
    }
  }

  function resetTakeOutputState() {
    stopReadingGuide();
    setActiveWordIndex(0);
    setRecognizedTranscript("");
    setFreeCaptureReviewTranscript(null);
    setFreeCaptureReviewTranscriptCandidate(false);
    recognizedFinalTranscriptRef.current = "";
    freeCaptureMetadataRef.current = null;
    speechRecognitionHypothesesRef.current = [];
    freeSpeechRecognitionAvailableRef.current = false;
    setLastTake(null);
    setReviewPlaybackProgress(0);
    setSavedFileName(null);
    setSavedLocation(null);
    replaceDownloadUrl(null);
    replaceMetadataDownloadUrl(null);
  }

  function clearRoomToneTimers() {
    if (roomToneCaptureTimerRef.current !== null) {
      window.clearTimeout(roomToneCaptureTimerRef.current);
      roomToneCaptureTimerRef.current = null;
    }

    if (roomToneProgressTimerRef.current !== null) {
      window.clearInterval(roomToneProgressTimerRef.current);
      roomToneProgressTimerRef.current = null;
    }
  }

  function stopMediaStream() {
    stopReadingGuide();
    realtimeSpeechActivityRef.current = null;
    clearRoomToneTimers();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    stopBackingTrackPlayback(true);
    releaseRecordingWakeLock();
  }

  function replaceDownloadUrl(url: string | null) {
    revokeObjectUrl(downloadUrlRef.current);
    downloadUrlRef.current = url;
    setDownloadUrl(url);
  }

  function replaceMetadataDownloadUrl(url: string | null) {
    revokeObjectUrl(metadataDownloadUrlRef.current);
    metadataDownloadUrlRef.current = url;
    setMetadataDownloadUrl(url);
  }

  function replaceWorkspaceBackupUrl(url: string | null) {
    revokeObjectUrl(workspaceBackupUrlRef.current);
    workspaceBackupUrlRef.current = url;
    setWorkspaceBackupUrl(url);
  }

  function replaceStoredRecordings(
    recordings: readonly DownloadableRecording[],
  ) {
    revokeStoredRecordingUrls();
    storedRecordingUrlsRef.current = recordings.map(
      (recording) => recording.url,
    );
    setStoredRecordings(recordings);
  }

  function revokeStoredRecordingUrls() {
    storedRecordingUrlsRef.current.forEach(revokeObjectUrl);
    storedRecordingUrlsRef.current = [];
  }

  function pushLiveWaveform(samples: Float32Array, sampleRateHz = 48_000) {
    realtimeSpeechActivityRef.current?.process(
      samples,
      sampleRateHz,
      performance.now(),
    );
    pushWaveformToRenderer(samples, 1.5 * inputSensitivityRef.current);
  }

  function updateVisualAudioLevel(level: number) {
    const sensitiveLevel = Math.min(
      1,
      Math.max(0, level * inputSensitivityRef.current),
    );
    const boostedLevel = Math.min(1, Math.pow(sensitiveLevel, 0.58));
    const previousLevel = visualAudioLevelRef.current;
    const nextLevel =
      boostedLevel > previousLevel
        ? previousLevel + (boostedLevel - previousLevel) * 0.86
        : previousLevel * 0.58 + boostedLevel * 0.42;

    visualAudioLevelRef.current = nextLevel;
    setLiveAudioLevel(nextLevel);
    appRootRef.current?.style.setProperty(
      "--audio-level",
      nextLevel.toFixed(3),
    );

    const now = performance.now();

    if (
      now - lastAudioUiUpdateAtRef.current >= AUDIO_UI_UPDATE_INTERVAL_MS ||
      Math.abs(nextLevel - renderedAudioLevelRef.current) > 0.12
    ) {
      renderedAudioLevelRef.current = nextLevel;
      lastAudioUiUpdateAtRef.current = now;
      setAudioLevel(nextLevel);
    }
  }

  function resetVisualAudioLevel() {
    visualAudioLevelRef.current = 0;
    renderedAudioLevelRef.current = 0;
    lastAudioUiUpdateAtRef.current = performance.now();
    setLiveAudioLevel(0);
    appRootRef.current?.style.setProperty("--audio-level", "0");
    setAudioLevel(0);
  }

  function updateInputSensitivity(value: number) {
    const bounded = Math.min(
      INPUT_SENSITIVITY_MAX,
      Math.max(INPUT_SENSITIVITY_MIN, value),
    );

    inputSensitivityRef.current = bounded;
    setInputSensitivity(bounded);

    try {
      window.localStorage.setItem(
        INPUT_SENSITIVITY_STORAGE_KEY,
        bounded.toFixed(2),
      );
    } catch {
      // Sensitivity stays session-only when local storage is blocked.
    }
  }

  function updateInputGainMode(mode: InputGainMode) {
    inputGainModeRef.current = mode;
    setInputGainMode(mode);

    try {
      window.localStorage.setItem(INPUT_GAIN_MODE_STORAGE_KEY, mode);
    } catch {
      // The preference remains active for this session when storage is blocked.
    }
  }

  function createInputGainOptions() {
    return {
      inputGain: {
        manualFactor: inputSensitivityRef.current,
        mode: inputGainModeRef.current,
      },
    } as const;
  }

  async function requestRecordingWakeLock() {
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;

    if (wakeLock === undefined || wakeLockRef.current?.released === false) {
      return;
    }

    try {
      wakeLockRef.current = await wakeLock.request("screen");
    } catch {
      wakeLockRef.current = null;
    }
  }

  function releaseRecordingWakeLock() {
    const wakeLock = wakeLockRef.current;

    wakeLockRef.current = null;
    void wakeLock?.release().catch(() => undefined);
  }

  function updateAmbientPointer(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse") {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();

    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }

    const pointerX = clampPercent(
      ((event.clientX - bounds.left) / bounds.width) * 100,
    );
    const pointerY = clampPercent(
      ((event.clientY - bounds.top) / bounds.height) * 100,
    );

    event.currentTarget.style.setProperty("--pointer-x", pointerX.toFixed(2));
    event.currentTarget.style.setProperty("--pointer-y", pointerY.toFixed(2));
    event.currentTarget.style.setProperty("--pointer-intensity", "1");
  }

  function settleAmbientPointer(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse") {
      return;
    }

    event.currentTarget.style.setProperty("--pointer-intensity", "0.36");
  }

  const isCapturing = screen === "calibration" || screen === "karaoke";
  const {
    budget: ambientRenderingBudget,
    budgetRef: ambientRenderingBudgetRef,
  } = useAmbientRenderingBudget({ isCapturing });

  const appClassName = [
    "simple-app",
    `surface-${surfaceProfile}`,
    `screen-${screen}`,
    studioAwake ? "is-awake" : "is-ritual",
    isWaveformReady ? "is-waveform-ready" : "",
    isCapturing ? "is-recording" : "",
    isFinalizing ? "is-finalizing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main
      ref={appRootRef}
      className={appClassName}
      onPointerDown={updateAmbientPointer}
      onPointerLeave={settleAmbientPointer}
      onPointerMove={updateAmbientPointer}
    >
      <AmbientBackdrop awake={studioAwake} />
      <VoiceWaveformSurface
        active={isWaveformReady}
        budget={ambientRenderingBudget}
        awake={studioAwake}
        playbackProgress={reviewPlaybackProgress}
        screen={screen}
      />

      {!studioAwake ? (
        <OpeningRitual
          onAwaken={() => void awakenStudio()}
          onEnterMediaStudio={enterMediaStudio}
          requiresDeviceRevalidation={requiresDeviceRevalidation}
          status={ritualStatus}
        />
      ) : (
        <>
          <header className="simple-header">
            <button
              className="brand-button"
              disabled={isCapturing || isFinalizing}
              onClick={() => setScreen("home")}
              type="button"
            >
              <span>
                <em>electronic</em>
                <b>Artefacts</b>
              </span>
              <strong>Voice Capture Studio</strong>
            </button>
            {screen === "home" && (
              <div className="header-mode-navigation">
                <CaptureModeSelector
                  disabled={lexicalSegmentationState.status === "running"}
                  mode={captureMode}
                  onChange={selectCaptureMode}
                />
                <span
                  aria-live="polite"
                  className="header-mode-caption"
                  data-testid="active-mode-label"
                >
                  {activeModeContent.title} · {activeModeContent.pill}
                </span>
              </div>
            )}
            <div className="header-actions">
              <button
                className="quiet-button"
                aria-label="Qualité et exports"
                disabled={isCapturing || isFinalizing}
                onClick={() => setScreen("technical")}
                type="button"
              >
                <Info aria-hidden="true" size={17} />
                <span>Qualité</span>
              </button>
            </div>
          </header>

          {screen === "technical" ? (
            <Suspense
              fallback={
                <LoadingWaveFallback
                  className="technical-page"
                  id="technical-screen-load"
                  label="Ouverture de la qualité"
                />
              }
            >
              <TechnicalPage
                audioLevel={audioLevel}
                captureMode={captureMode}
                corpusId={activeCorpus?.id ?? null}
                corpusLicenseGranted={corpusLicenseGranted}
                corpusVersion={activeCorpus?.version ?? null}
                coverage={coverage}
                coveragePercent={coverage?.percent ?? 0}
                datasetExportState={datasetExportState}
                diagnostics={diagnostics}
                folderName={folderName}
                inputGainMode={inputGainMode}
                inputSensitivity={inputSensitivity}
                microphoneActive={studioAwake}
                microphoneLabel={microphoneLabel}
                onBack={() => setScreen("home")}
                onDownloadDataset={downloadDatasetPackage}
                onDownloadWorkspaceArchive={() =>
                  runWithLoadingWave(
                    "workspace-archive-export",
                    "Création de l’archive",
                    downloadWorkspaceArchive,
                  )
                }
                onImportForcedAlignment={(file) =>
                  runWithLoadingWave(
                    "forced-alignment-import",
                    "Import de l’alignement",
                    () => loadForcedAlignmentFile(file),
                  )
                }
                onImportWorkspaceArchive={(file) =>
                  runWithLoadingWave(
                    "workspace-archive-import",
                    "Restauration du workspace",
                    () => importWorkspaceArchive(file),
                  )
                }
                onInputGainModeChange={updateInputGainMode}
                onInputSensitivityChange={updateInputSensitivity}
                onCorpusLicenseChange={(granted) =>
                  void runWithLoadingWave(
                    "corpus-license-update",
                    "Enregistrement des droits",
                    () => updateCorpusLicense(granted),
                  ).catch((error: unknown) =>
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : "Impossible d’enregistrer les droits du corpus.",
                    ),
                  )
                }
                onClearCachedModels={() =>
                  void runWithLoadingWave(
                    "model-cache-clear",
                    "Nettoyage des modèles",
                    clearCachedModels,
                  )
                }
                onTrainingConsentChange={(granted) =>
                  void runWithLoadingWave(
                    "training-consent-update",
                    "Enregistrement du consentement",
                    () => updateTrainingConsent(granted),
                  ).catch((error: unknown) =>
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : "Impossible d’enregistrer le consentement.",
                    ),
                  )
                }
                onWriteDatasetToFolder={writeDatasetPackageToFolder}
                recordings={storedRecordings}
                savedSessions={workspace?.sessions.length ?? 0}
                storageMode={
                  canChooseSystemFolder()
                    ? "folder-capable"
                    : "browser-downloads"
                }
                trainingConsentGranted={trainingConsentGranted}
              />
            </Suspense>
          ) : (
            <section className="session-stage">
              {screen === "home" && (
                <HomeScreen
                  backingAudioRef={backingAudioRef}
                  backingTrack={backingTrack}
                  backingTrackLoop={backingTrackLoop}
                  backingTrackVolume={backingTrackVolume}
                  captureProfile={workspace?.settings.captureProfile}
                  captureMode={captureMode}
                  coverage={coverage}
                  customCorpusSourceName={customCorpusSourceName}
                  customCorpusText={customCorpusText}
                  diagnostics={diagnostics}
                  dubbingCueSeconds={dubbingCueSeconds}
                  dubbingMedia={dubbingMedia}
                  dubbingMediaMuted={dubbingMediaMuted}
                  folderName={folderName}
                  language={selectedLanguage}
                  localCorpusSummary={localCorpus?.summary ?? null}
                  lexicalSegmentationFile={lexicalSegmentationFile}
                  lexicalSegmentationState={lexicalSegmentationState}
                  onBackingTrackChange={loadBackingTrackFile}
                  onBackingTrackClear={clearBackingTrack}
                  onBackingTrackLoopChange={setBackingTrackLoop}
                  onBackingTrackVolumeChange={setBackingTrackVolume}
                  message={message}
                  onChooseFolder={() =>
                    void runWithLoadingWave(
                      "folder-selection",
                      "Connexion du dossier",
                      selectFolder,
                    )
                  }
                  onCustomCorpusFile={(file) =>
                    runWithLoadingWave(
                      "custom-corpus-import",
                      "Lecture du corpus",
                      () => loadCustomCorpusFile(file),
                    )
                  }
                  onCustomCorpusTextChange={(text) =>
                    updateCustomCorpusText(
                      text,
                      customCorpusSourceName ?? "Texte libre",
                    )
                  }
                  onDubbingCueSecondsChange={setDubbingCueSeconds}
                  onDubbingMediaClear={clearDubbingMedia}
                  onDubbingMediaMutedChange={setDubbingMediaMuted}
                  onDubbingVideoChange={loadDubbingVideoFile}
                  onDubbingYouTubeUrl={loadDubbingYouTubeUrl}
                  onLanguageChange={selectLanguage}
                  onLexicalSegmentationClear={clearLexicalSegmentation}
                  onLexicalSegmentationCancel={cancelLexicalSegmentation}
                  onLexicalSegmentationFile={loadLexicalSegmentationFile}
                  onProfileChange={updateCaptureProfile}
                  onRefreshDiagnostics={() =>
                    void runWithLoadingWave(
                      "runtime-diagnostics",
                      "Actualisation du diagnostic",
                      () => refreshDiagnostics(),
                    )
                  }
                  onSpeakerChange={selectSpeaker}
                  onSpeakerCreate={(speaker) =>
                    runWithLoadingWave(
                      "speaker-create",
                      "Création de la voix",
                      () => createSpeaker(speaker),
                    )
                  }
                  isDirectCaptureStarting={isDirectCaptureStarting}
                  onStart={prepareSession}
                  savedSessions={workspace?.sessions.length ?? 0}
                  speakers={speakerProfiles}
                  selectedSpeaker={selectedSpeaker}
                  selectedSpeakerId={selectedSpeakerId}
                  workspaceBackupFileName={workspaceBackupFileName}
                  workspaceBackupUrl={workspaceBackupUrl}
                  workspaceDurability={workspaceDurability}
                />
              )}

              {screen === "permission" && (
                <PermissionScreen
                  calibratesRoomTone={
                    !hasCalibratedCurrentSessionRef.current &&
                    currentPromptIndex === 0
                  }
                  dubbingEndSeconds={dubbingEndSeconds}
                  dubbingMedia={captureMode === "dubbing" ? dubbingMedia : null}
                  dubbingMediaMuted={dubbingMediaMuted}
                  dubbingStartSeconds={dubbingStartSeconds}
                  insight={activePromptInsight}
                  diagnostics={diagnostics}
                  isSpeakingReference={isSpeakingReference}
                  message={message}
                  prompt={activePrompt}
                  onAllow={() => void allowMicrophoneAndStart()}
                  onBack={() => setScreen("home")}
                  onReference={
                    isSpeakingReference
                      ? stopPromptReference
                      : speakPromptReference
                  }
                />
              )}

              {screen === "calibration" && (
                <RoomToneCalibrationScreen
                  audioLevel={audioLevel}
                  progress={roomToneProgress}
                  totalMs={ROOM_TONE_CAPTURE_MS}
                />
              )}

              {screen === "karaoke" && (
                <KaraokeScreen
                  activeWordIndex={visibleWordIndex}
                  audioLevel={audioLevel}
                  currentPromptIndex={
                    isContinuousCorpusCapture
                      ? continuousPromptIndex
                      : currentPromptIndex
                  }
                  dubbingEndSeconds={dubbingEndSeconds}
                  dubbingMedia={captureMode === "dubbing" ? dubbingMedia : null}
                  dubbingMediaMuted={dubbingMediaMuted}
                  dubbingStartSeconds={dubbingStartSeconds}
                  isFreeCapture={isFreeCapture}
                  continuousCorpusMode={
                    isContinuousCorpusCapture ? captureMode : null
                  }
                  isFinalizing={isFinalizing}
                  onStop={finishRecording}
                  prompt={visiblePrompt}
                  language={selectedLanguage}
                  readingGuideWordOffset={
                    isContinuousCorpusCapture
                      ? (continuousPromptRange?.startWordIndex ?? 0)
                      : 0
                  }
                  readingGuideMode={readingGuideMode}
                  recognizedTranscript={recognizedTranscript}
                  roomTone={sessionRoomTone}
                  totalPrompts={
                    isContinuousCorpusCapture
                      ? continuousPromptRanges.length
                      : (session?.plannedPromptIds.length ?? 0)
                  }
                  words={visibleWords}
                />
              )}

              {screen === "done" && (
                <Suspense
                  fallback={
                    <LoadingWaveFallback
                      id="done-screen-load"
                      label="Préparation de la prise"
                    />
                  }
                >
                  <DoneScreen
                    downloadUrl={downloadUrl}
                    fileName={savedFileName}
                    freeCaptureTranscript={
                      isFreeCapture ? freeCaptureReviewTranscript : null
                    }
                    freeCaptureTranscriptCandidate={
                      isFreeCapture && freeCaptureReviewTranscriptCandidate
                    }
                    language={selectedLanguage}
                    location={savedLocation}
                    metadataDownloadUrl={metadataDownloadUrl}
                    message={message}
                    nextRecommendation={coverage?.nextRecommendation ?? null}
                    onPlaybackEnergyChange={updateVisualAudioLevel}
                    onPlaybackProgressChange={setReviewPlaybackProgress}
                    onLocalAnalysis={(analysis) =>
                      void persistLocalTakeAnalysis(analysis)
                    }
                    onBeforePlayback={stopAmbientMicrophoneMonitor}
                    progressLabel={
                      session === null
                        ? null
                        : [
                            `Phrase ${Math.min(currentPromptIndex + 1, session.plannedPromptIds.length)} sur ${session.plannedPromptIds.length}`,
                            captureMode === "training" && coverage !== null
                              ? `parcours ${coverage.completedPrompts}/${coverage.totalPrompts} validées`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                    }
                    take={lastTake}
                    hasNextPrompt={
                      session !== null &&
                      currentPromptIndex < session.plannedPromptIds.length - 1
                    }
                    isFreeCapture={isFreeCapture}
                    isContinuousCorpusCapture={isContinuousCorpusCapture}
                    onAgain={prepareSession}
                    onNext={continueToNextPrompt}
                    onHome={() => setScreen("home")}
                    onRetake={retakeCurrentPrompt}
                  />
                </Suspense>
              )}
            </section>
          )}

          {!isCapturing && <SiteFooter />}
        </>
      )}
    </main>
  );
}
