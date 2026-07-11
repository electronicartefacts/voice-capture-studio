import {
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
import {
  alignPromptToPhonemes,
  importForcedAlignment,
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
import { type LanguageCode } from "@shared/index";
import { createPcmRecorder, type PcmRecorder } from "../audio/pcmRecorder";
import { createBrowserAsrObservation } from "../analysis/browserAsrObservation";
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
  resetLiveReadingGuidePosition,
  setLiveReadingGuidePosition,
} from "../rendering/liveReadingGuideSignal";
import { measureAcousticField } from "../rendering/acousticField";
import { FREE_CAPTURE_MAX_DURATION_MS } from "../recording/captureLimits";
import {
  createRealtimeSpeechActivityDetector,
  type RealtimeSpeechActivityDetector,
} from "../recording/realtimeSpeechActivity";
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
import { listBrowserRecordings } from "../storage/browserRecordingStorage";
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
import { DoneScreen } from "./screens/DoneScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { PermissionScreen } from "./screens/PermissionScreen";
import {
  AmbientBackdrop,
  OpeningRitual,
  SiteFooter,
} from "./screens/StudioChrome";
import { TechnicalPage } from "./screens/TechnicalPage";
import { surfaceProfileDetails, useSurfaceProfile } from "./surfaceProfile";
import { useAmbientRenderingBudget } from "./useAmbientRenderingBudget";

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
  readonly stop: () => void;
};

const workspaceId = "workspace.local.main" as WorkspaceId;
const workspaceRepository = createBrowserWorkspaceRepository();
const ROOM_TONE_CAPTURE_MS = 3000;
const WAVEFORM_WARMUP_DELAY_MS = 140;
const RAW_MICROPHONE_CONSTRAINTS: MediaTrackConstraints = {
  autoGainControl: false,
  channelCount: { ideal: 1 },
  echoCancellation: false,
  noiseSuppression: false,
  sampleRate: { ideal: 48_000 },
  sampleSize: { ideal: 24 },
};

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

export function App() {
  const surfaceProfile = useSurfaceProfile();
  const [studioAwake, setStudioAwake] = useState(false);
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
  const [continuousLyricsEnabled, setContinuousLyricsEnabled] = useState(true);
  const [isContinuousLyricsCapture, setIsContinuousLyricsCapture] =
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
  const ambientMonitorRef = useRef<AmbientMicrophoneMonitor | null>(null);
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
  const readingGuideFinalAlignmentConfirmedRef = useRef(false);
  const readingGuideFinishTimerRef = useRef<number | null>(null);
  const realtimeSpeechActivityRef =
    useRef<RealtimeSpeechActivityDetector | null>(null);
  const freeCaptureLimitTimerRef = useRef<number | null>(null);
  const lastTranscriptAtRef = useRef(0);
  const finishRecordingRef = useRef<() => void>(() => undefined);
  const hasCalibratedCurrentSessionRef = useRef(false);

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
        ".instrument-face h1",
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
    if (captureMode === "training" || captureMode === "free") {
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
  const activePromptId = session?.plannedPromptIds[currentPromptIndex];
  const promptText =
    activePromptId && activeCorpus !== null
      ? findPromptText(activeCorpus, activePromptId)
      : "";
  const activePrompt =
    activePromptId && activeCorpus !== null
      ? findPrompt(activeCorpus, activePromptId)
      : undefined;
  const dubbingStartSeconds =
    activePrompt?.sourceTiming === undefined
      ? dubbingCueSeconds
      : activePrompt.sourceTiming.startMs / 1000;
  const dubbingEndSeconds =
    activePrompt?.sourceTiming === undefined
      ? null
      : activePrompt.sourceTiming.endMs / 1000;
  const words = useMemo(
    () => promptText.split(/\s+/).filter(Boolean),
    [promptText],
  );
  const continuousLyricsText = useMemo(
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

    void workspaceRepository.open(workspaceId).then(async (result) => {
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
    });
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
    function handleVisibilityChange() {
      if (
        document.visibilityState === "visible" &&
        pcmRecorderRef.current !== null
      ) {
        void requestRecordingWakeLock();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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

    try {
      const monitor = await createAmbientMicrophoneMonitor();

      stopAmbientMicrophoneMonitor();
      ambientMonitorRef.current = monitor;
      setStudioAwake(true);
      setRitualStatus("idle");
      setMessage(createRuntimeHomeMessage(diagnostics));
    } catch (error) {
      setRitualStatus("denied");
      setMessage(createMicrophoneErrorMessage(error));
      void refreshDiagnostics(false);
    }
  }

  async function createAmbientMicrophoneMonitor(): Promise<AmbientMicrophoneMonitor> {
    const AudioContextConstructor =
      window.AudioContext ??
      (window as WindowWithAudioContext).webkitAudioContext;

    if (AudioContextConstructor === undefined) {
      throw new Error("AudioContext is not available in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: RAW_MICROPHONE_CONSTRAINTS,
    });
    setMicrophoneLabel(createMicrophoneLabel(stream));

    const audioContext = new AudioContextConstructor();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    let frameId = 0;
    let pausedTimerId: number | null = null;
    let acousticFieldReadAt = -Infinity;
    let smoothedLevel = 0;

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
      await audioContext.resume();
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
    if (workspace === null || activeCorpus === null) {
      return;
    }

    setDatasetExportState({ status: "preparing" });

    try {
      const scope = createCurrentVoicePackageScope(workspace, activeCorpus);
      const plan = await createVoiceCapturePackagePlan({
        corpus: activeCorpus,
        getAudioBlob: getWorkspaceRecording,
        scope,
        speakerProfiles,
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
    if (workspace === null || activeCorpus === null) {
      return;
    }

    setDatasetExportState({ status: "preparing" });

    try {
      const scope = createCurrentVoicePackageScope(workspace, activeCorpus);
      const plan = await createVoiceCapturePackagePlan({
        corpus: activeCorpus,
        getAudioBlob: getWorkspaceRecording,
        scope,
        speakerProfiles,
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

  function createCurrentVoicePackageScope(
    currentWorkspace: VoiceWorkspace,
    corpus: CorpusManifest,
  ): VoiceCapturePackageScope {
    const sessionIds = currentWorkspace.capturedSessions
      .filter(
        (candidate) =>
          candidate.speakerId === selectedSpeakerId &&
          candidate.language === selectedLanguage &&
          candidate.corpusId === corpus.id,
      )
      .map((candidate) => candidate.id);

    if (sessionIds.length === 0) {
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
    if (mode !== "mastering") {
      setContinuousLyricsEnabled(false);
      setIsContinuousLyricsCapture(false);
    }

    if (mode !== "mastering") {
      stopBackingTrackPlayback(true);
    }

    if (
      mode !== "training" &&
      mode !== "free" &&
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
    mode: LocalCorpusMode = captureMode === "training" || captureMode === "free"
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
        captureMode === "training" || captureMode === "free"
          ? "dubbing"
          : captureMode;

      if (captureMode === "training" || captureMode === "free") {
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
      const target = currentWorkspace.capturedSessions
        .flatMap((capturedSession) =>
          capturedSession.takes.map((take) => ({ capturedSession, take })),
        )
        .at(-1);

      if (target === undefined) {
        setMessage("Aucune prise disponible pour cet alignement forcé.");
        return;
      }

      const alignment = importForcedAlignment(JSON.parse(await file.text()));

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
      setMessage(`Alignement forcé importé avec ${alignment.aligner}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible d'importer cet alignement forcé.",
      );
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
      setIsContinuousLyricsCapture(false);
      setSessionRoomTone(null);
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

    if (captureMode === "mastering" && continuousLyricsEnabled) {
      if (continuousLyricsText.trim().length === 0) {
        setMessage("Ajoute des paroles avant de lancer une prise continue.");
        return;
      }

      setSession(null);
      isFreeCaptureRef.current = true;
      setIsFreeCapture(true);
      setIsContinuousLyricsCapture(true);
      setSessionRoomTone(null);
      resetTakeOutputState();
      setScreen("permission");
      setMessage(
        "Prise continue prête : chante toutes les paroles, puis appuie sur Stop.",
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
    setIsContinuousLyricsCapture(false);
    setCurrentPromptIndex(0);
    hasCalibratedCurrentSessionRef.current = false;
    setSessionRoomTone(null);
    setRoomToneProgress(0);
    resetTakeOutputState();
    setScreen("permission");
    setMessage(createSessionPreparationMessage(captureMode));
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

    try {
      const ambientStream = ambientMonitorRef.current?.stream ?? null;
      const ambientStreamIsLive =
        ambientStream
          ?.getAudioTracks()
          .some((track) => track.readyState === "live") ?? false;

      if (ambientStream !== null && ambientStreamIsLive) {
        stream = ambientStream.clone();
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: RAW_MICROPHONE_CONSTRAINTS,
        });
      }

      setMicrophoneLabel(createMicrophoneLabel(stream));

      const recorder = await createPcmRecorder(stream, {
        maxDurationMs: captureIsFree ? FREE_CAPTURE_MAX_DURATION_MS : undefined,
        onLevel: updateVisualAudioLevel,
        onSamples: pushLiveWaveform,
      });

      isPersistingRef.current = false;
      setIsFinalizing(false);
      mediaStreamRef.current = stream;
      pcmRecorderRef.current = recorder;

      await requestRecordingWakeLock();
      if (
        !captureIsFree &&
        !hasCalibratedCurrentSessionRef.current &&
        currentPromptIndex === 0
      ) {
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
    }
  }

  function startPromptRecording(
    stream: MediaStream,
    recorder: PcmRecorder,
    message = "Enregistrement en cours. Lis naturellement : le texte suit ta voix.",
    calibratedRoomTone: RoomToneCalibration | null = sessionRoomTone,
    freeCapture = isFreeCaptureRef.current,
  ) {
    clearRoomToneTimers();
    mediaStreamRef.current = stream;
    pcmRecorderRef.current = recorder;
    resetVisualAudioLevel();
    setActiveWordIndex(0);
    setScreen("karaoke");
    setIsDirectCaptureStarting(false);
    setMessage(message);
    realtimeSpeechActivityRef.current = createRealtimeSpeechActivityDetector({
      noiseFloorDbfs: calibratedRoomTone?.noiseFloorDbfs,
    });

    if (!freeCapture) {
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
    readingGuideFinalAlignmentConfirmedRef.current = false;
    resetLiveReadingGuidePosition();

    const speechRecognitionStarted = startSpeechRecognitionGuide(
      promptWords,
      language,
    );

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
            readingGuideFinalAlignmentConfirmedRef.current = true;
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
      if (!speechActivity.hasDetectedSpeech || speechActivity.active) {
        return false;
      }
    }

    const trailingSilenceMs =
      speechActivity?.trailingSilenceMs ??
      Math.max(0, now - readingGuideLastSpeechAtRef.current);
    const expressiveEnding = /[!?…]\s*$/u.test(activePrompt?.text ?? "");
    const requiredSilenceMs = readingGuideFinalAlignmentConfirmedRef.current
      ? expressiveEnding
        ? 640
        : 540
      : 1_050;

    if (trailingSilenceMs < requiredSilenceMs) {
      return false;
    }

    if (readingGuideFinalAlignmentConfirmedRef.current) {
      return true;
    }

    const alignment = readingGuideAlignmentRef.current;
    const finalWord = alignment?.words[wordCount - 1];
    const fallbackReachedFinalWord =
      finalWord !== undefined &&
      readingGuideProgressRef.current >= finalWord.startMs;
    const minimumPlausibleDuration =
      estimateSpeechGuideDurationMs(words, activePrompt) * 0.55;

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

      setSessionRoomTone(calibration);
      hasCalibratedCurrentSessionRef.current = true;
      await persistRoomToneCalibration(calibration);

      if (mediaStreamRef.current !== stream) {
        return;
      }

      const nextRecorder = await createPcmRecorder(stream, {
        onLevel: updateVisualAudioLevel,
        onSamples: pushLiveWaveform,
      });

      startPromptRecording(
        stream,
        nextRecorder,
        `Salle calibrée : bruit de fond ${calibration.noiseFloorDbfs} dBFS. Enregistrement de la phrase.`,
        calibration,
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

  async function persistRoomToneCalibration(calibration: RoomToneCalibration) {
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
    setMessage(
      !finalization.workspaceSaveResult.ok
        ? `Prise exportable, mais la progression locale n'a pas été mise à jour : ${finalization.workspaceSaveResult.message}`
        : finalization.metadataSaveMessage !== null
          ? `Prise sauvegardée. ${finalization.metadataSaveMessage} Télécharge le JSON complémentaire.`
          : finalization.audioSaveResult.ok
            ? "Prise sauvegardée. Télécharge l'audio et les métadonnées si besoin."
            : nextDownloadUrl === null
              ? finalization.audioSaveResult.message
              : "Stockage interne refusé. Télécharge le fichier maintenant.",
    );
  }

  async function persistFreeCapture(recording: FinalizedRecording) {
    const recordedAt = new Date();
    const takeId = createTakeId(recordedAt);
    const fileName = createRecordingFileName({
      extension: recording.extension,
      sessionId: "free" as never,
      takeId,
    });
    const audioSaveResult = await saveRecordingToWorkspaceFolder(
      fileName,
      recording.blob,
    );
    const audioUrl =
      recording.blob.size > 0 ? URL.createObjectURL(recording.blob) : null;
    const metadata = {
      schemaVersion: "voice.free_capture.v1",
      mode: "free",
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
      lyrics: isContinuousLyricsCapture
        ? { text: continuousLyricsText, capture: "continuous-karaoke" }
        : null,
      transcript: createFreeCaptureTranscript({
        finalTranscript: recognizedFinalTranscriptRef.current,
        recognitionAvailable: freeSpeechRecognitionAvailableRef.current,
      }),
    };
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
    await refreshStoredRecordings();
    setScreen("done");
    setMessage(
      audioSaveResult.ok
        ? isContinuousLyricsCapture
          ? "Paroles complètes sauvegardées. Le WAV et le manifeste sont prêts."
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
    recognizedFinalTranscriptRef.current = "";
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
            <div className="header-actions">
              <span
                aria-label={surfaceProfileDetails[surfaceProfile].description}
                aria-live="polite"
                className="surface-profile-badge"
                title={surfaceProfileDetails[surfaceProfile].description}
              >
                {surfaceProfileDetails[surfaceProfile].label}
              </span>
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
            <TechnicalPage
              audioLevel={audioLevel}
              captureMode={captureMode}
              corpusId={activeCorpus?.id ?? null}
              corpusVersion={activeCorpus?.version ?? null}
              coverage={coverage}
              coveragePercent={coverage?.percent ?? 0}
              datasetExportState={datasetExportState}
              diagnostics={diagnostics}
              folderName={folderName}
              inputSensitivity={inputSensitivity}
              microphoneActive={studioAwake}
              microphoneLabel={microphoneLabel}
              onBack={() => setScreen("home")}
              onDownloadDataset={downloadDatasetPackage}
              onDownloadWorkspaceArchive={downloadWorkspaceArchive}
              onImportForcedAlignment={loadForcedAlignmentFile}
              onImportWorkspaceArchive={importWorkspaceArchive}
              onInputSensitivityChange={updateInputSensitivity}
              onClearCachedModels={() => void clearCachedModels()}
              onWriteDatasetToFolder={writeDatasetPackageToFolder}
              recordings={storedRecordings}
              savedSessions={workspace?.sessions.length ?? 0}
              storageMode={
                canChooseSystemFolder() ? "folder-capable" : "browser-downloads"
              }
            />
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
                  onBackingTrackChange={loadBackingTrackFile}
                  onBackingTrackClear={clearBackingTrack}
                  onBackingTrackLoopChange={setBackingTrackLoop}
                  onBackingTrackVolumeChange={setBackingTrackVolume}
                  onCaptureModeChange={selectCaptureMode}
                  continuousLyricsEnabled={continuousLyricsEnabled}
                  onContinuousLyricsChange={setContinuousLyricsEnabled}
                  message={message}
                  onChooseFolder={selectFolder}
                  onCustomCorpusFile={loadCustomCorpusFile}
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
                  onProfileChange={updateCaptureProfile}
                  onRefreshDiagnostics={() => void refreshDiagnostics()}
                  onSpeakerChange={selectSpeaker}
                  onSpeakerCreate={createSpeaker}
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
                  calibratesRoomTone={!isFreeCapture}
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
                  activeWordIndex={activeWordIndex}
                  audioLevel={audioLevel}
                  currentPromptIndex={currentPromptIndex}
                  dubbingEndSeconds={dubbingEndSeconds}
                  dubbingMedia={captureMode === "dubbing" ? dubbingMedia : null}
                  dubbingMediaMuted={dubbingMediaMuted}
                  dubbingStartSeconds={dubbingStartSeconds}
                  isFreeCapture={isFreeCapture}
                  continuousLyricsText={
                    isContinuousLyricsCapture ? continuousLyricsText : null
                  }
                  isFinalizing={isFinalizing}
                  onStop={finishRecording}
                  prompt={activePrompt}
                  language={selectedLanguage}
                  readingGuideMode={readingGuideMode}
                  recognizedTranscript={recognizedTranscript}
                  roomTone={sessionRoomTone}
                  totalPrompts={session?.plannedPromptIds.length ?? 0}
                  words={words}
                />
              )}

              {screen === "done" && (
                <DoneScreen
                  downloadUrl={downloadUrl}
                  fileName={savedFileName}
                  language={selectedLanguage}
                  location={savedLocation}
                  metadataDownloadUrl={metadataDownloadUrl}
                  message={message}
                  nextRecommendation={coverage?.nextRecommendation ?? null}
                  onPlaybackEnergyChange={updateVisualAudioLevel}
                  onPlaybackProgressChange={setReviewPlaybackProgress}
                  progressLabel={
                    session === null
                      ? null
                      : `Phrase ${Math.min(currentPromptIndex + 1, session.plannedPromptIds.length)} sur ${
                          session.plannedPromptIds.length
                        }`
                  }
                  take={lastTake}
                  hasNextPrompt={
                    session !== null &&
                    currentPromptIndex < session.plannedPromptIds.length - 1 &&
                    lastTake?.quality.verdict === "pass"
                  }
                  isFreeCapture={isFreeCapture}
                  isContinuousLyricsCapture={isContinuousLyricsCapture}
                  onAgain={prepareSession}
                  onNext={continueToNextPrompt}
                  onHome={() => setScreen("home")}
                  onRetake={retakeCurrentPrompt}
                />
              )}
            </section>
          )}

          {!isCapturing && <SiteFooter />}
        </>
      )}
    </main>
  );
}
