import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Check,
  Clapperboard,
  Database,
  Download,
  FileText,
  FolderOpen,
  HardDrive,
  Headphones,
  Home,
  Info,
  Mic,
  Music,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  StepForward,
  Timer,
  Trash2,
  Upload,
  UserPlus,
  Volume2,
} from "lucide-react";
import {
  canonicalCorpus,
  createLocalTextCorpus,
  type CorpusManifest,
  type LocalCorpusMode,
  type LocalTextCorpus,
  type LocalTextCorpusSummary,
  type PromptDefinition,
} from "@domains/corpus";
import { summarizeCoverage, type CoverageSummary } from "@domains/coverage";
import { alignPromptToPhonemes } from "@domains/phonetics";
import {
  findPrompt,
  findPromptText,
  planSession,
  type CaptureSession,
  type RecordedTake,
} from "@domains/sessions";
import {
  initialSpeakers,
  type SpeakerId,
  type SpeakerProfile,
} from "@domains/speakers";
import {
  DEFAULT_CAPTURE_PROFILE,
  createEmptyWorkspace,
  reconcileWorkspaceProgress,
  type CaptureProfile,
  type VoiceWorkspace,
  type WorkspaceSpeaker,
  type WorkspaceDurability,
  type WorkspaceId,
  type WorkspaceOpenError,
  type WorkspaceReceipt,
} from "@domains/workspace";
import {
  formatLanguage,
  supportedLanguages,
  type LanguageCode,
} from "@shared/index";
import {
  createPcmRecorder,
  type PcmRecorder,
  type PcmRecordingMetrics,
} from "../audio/pcmRecorder";
import {
  finalizeCaptureSession,
  type FinalizedRecording,
} from "../recording/finalizeCaptureSession";
import { createDatasetPackagePlan } from "../export/datasetPackage";
import { createDatasetZip } from "../export/downloadDatasetPackage";
import { createBrowserWorkspaceRepository } from "../storage/browserWorkspaceRepository";
import {
  canChooseSystemFolder,
  chooseWorkspaceFolder,
  getBrowserRecording,
  getRememberedFolderName,
  listBrowserRecordings,
  saveDatasetPackageToWorkspaceFolder,
  saveRecordingToWorkspaceFolder,
  saveTakeMetadataToWorkspaceFolder,
  type StoredRecording,
} from "../storage/workspaceFolder";
import { createWorkspaceBackup } from "../storage/workspaceBackup";
import {
  createMicrophoneErrorMessage,
  createRuntimeDiagnosticsSnapshot,
  getCaptureBlocker,
  inspectRuntime,
  type RuntimeCheck,
  type RuntimeDiagnostics,
} from "../system/runtimeDiagnostics";

type Screen =
  "home" | "permission" | "calibration" | "karaoke" | "done" | "technical";
type CaptureMode = "training" | LocalCorpusMode;
type DownloadableRecording = StoredRecording & {
  readonly url: string;
};
type BackingTrack = {
  readonly name: string;
  readonly url: string;
};
type DatasetExportState =
  | { readonly status: "idle" }
  | { readonly status: "preparing" }
  | {
      readonly status: "done";
      readonly keeperCount: number;
      readonly missingAudioFiles: readonly string[];
    }
  | { readonly status: "error"; readonly message: string };
type ReadingGuideMode = "speech-recognition" | "voice-activity";
type RitualStatus = "idle" | "requesting" | "denied";
type RoomToneCalibration = {
  readonly durationMs: number;
  readonly peakDbfs: number;
  readonly noiseFloorDbfs: number;
  readonly integratedLufs: number;
};
type WindowWithAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
type SpeechRecognitionAlternativeLike = {
  readonly transcript: string;
  readonly confidence: number;
};
type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike | undefined;
};
type SpeechRecognitionEventLike = {
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike | undefined;
  };
};
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  abort: () => void;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type WindowWithSpeechRecognition = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
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
const WAVEFORM_DISPLAY_SAMPLES = 220;
const DEFAULT_SPEAKER_LANGUAGE =
  supportedLanguages[0]?.code ?? ("fr" as LanguageCode);

type CreateSpeakerInput = {
  readonly displayName: string;
  readonly languages: readonly LanguageCode[];
};

function createSpeakerProfiles(
  workspaceSpeakers: readonly WorkspaceSpeaker[] | undefined,
): readonly SpeakerProfile[] {
  if (workspaceSpeakers !== undefined && workspaceSpeakers.length > 0) {
    return workspaceSpeakers.map((speaker, index) =>
      createSpeakerProfileFromWorkspaceSpeaker(speaker, index),
    );
  }

  return initialSpeakers.map((speaker, index) => ({
    ...speaker,
    displayName: normalizeSpeakerDisplayName(speaker.displayName, index),
    supportedLanguages: normalizeSpeakerLanguages(speaker.supportedLanguages),
  }));
}

function createSpeakerProfileFromWorkspaceSpeaker(
  speaker: WorkspaceSpeaker,
  index: number,
): SpeakerProfile {
  const languages = normalizeSpeakerLanguages(speaker.languages);

  return {
    id: speaker.speakerId,
    displayName: normalizeSpeakerDisplayName(speaker.displayName, index),
    primaryLanguage: languages[0] ?? DEFAULT_SPEAKER_LANGUAGE,
    supportedLanguages: languages,
  };
}

function createWorkspaceSpeakerFromProfile(
  speaker: SpeakerProfile,
): WorkspaceSpeaker {
  return {
    speakerId: speaker.id,
    displayName: speaker.displayName,
    languages: speaker.supportedLanguages,
  };
}

function normalizeSpeakerLanguages(
  languages: readonly LanguageCode[] | undefined,
): readonly LanguageCode[] {
  const normalized: LanguageCode[] = [];

  for (const language of languages ?? []) {
    if (
      supportedLanguages.some((candidate) => candidate.code === language) &&
      !normalized.includes(language)
    ) {
      normalized.push(language);
    }
  }

  return normalized.length > 0 ? normalized : [DEFAULT_SPEAKER_LANGUAGE];
}

function normalizeSpeakerDisplayName(
  displayName: string,
  index: number,
): string {
  const trimmed = displayName.trim();

  if (trimmed === "Primary Voice") {
    return "Voix 1";
  }

  if (trimmed === "Secondary Voice") {
    return "Voix 2";
  }

  return trimmed.length > 0 ? trimmed : `Voix ${index + 1}`;
}

function createSpeakerId(): SpeakerId {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return `speaker.${suffix}` as SpeakerId;
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

async function closeAmbientAudioContext(
  audioContext: AudioContext,
): Promise<void> {
  try {
    if (audioContext.state !== "closed") {
      await audioContext.close();
    }
  } catch {
    // Closing the ambient monitor should never block the recording workflow.
  }
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function formatMeterScale(value: number): string {
  return Math.max(0.035, clampUnit(value)).toFixed(3);
}

function softLimitWaveSample(
  value: number,
  threshold: number,
  ratio: number,
): number {
  const absoluteValue = Math.abs(value);

  if (absoluteValue <= threshold) {
    return value;
  }

  return Math.sign(value) * (threshold + (absoluteValue - threshold) / ratio);
}

export function App() {
  const [studioAwake, setStudioAwake] = useState(false);
  const [ritualStatus, setRitualStatus] = useState<RitualStatus>("idle");
  const [screen, setScreen] = useState<Screen>("home");
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
  const workspaceRef = useRef<VoiceWorkspace | null>(null);
  const screenRef = useRef<Screen>("home");
  const activeWordIndexRef = useRef(0);
  const visualAudioLevelRef = useRef(0);
  const pcmRecorderRef = useRef<PcmRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeLockRef = useRef<RecordingWakeLockSentinel | null>(null);
  const backingAudioRef = useRef<HTMLAudioElement | null>(null);
  const downloadUrlRef = useRef<string | null>(null);
  const metadataDownloadUrlRef = useRef<string | null>(null);
  const workspaceBackupUrlRef = useRef<string | null>(null);
  const backingTrackUrlRef = useRef<string | null>(null);
  const storedRecordingUrlsRef = useRef<readonly string[]>([]);
  const datasetZipUrlRef = useRef<string | null>(null);
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
  const readingGuideFinishTimerRef = useRef<number | null>(null);
  const lastTranscriptAtRef = useRef(0);
  const finishRecordingRef = useRef<() => void>(() => undefined);
  const hasCalibratedCurrentSessionRef = useRef(false);

  const speakerProfiles = useMemo(
    () => createSpeakerProfiles(workspace?.speakers),
    [workspace?.speakers],
  );
  const selectedSpeaker = speakerProfiles.find(
    (speaker) => speaker.id === selectedSpeakerId,
  );
  const localCorpus = useMemo<LocalTextCorpus | null>(() => {
    if (captureMode === "training") {
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
  const words = useMemo(
    () => promptText.split(/\s+/).filter(Boolean),
    [promptText],
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);
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
    return () => {
      const recorder = pcmRecorderRef.current;

      pcmRecorderRef.current = null;
      stopReadingGuide();
      stopPromptReference();
      clearRoomToneTimers();
      stopMediaStream();

      if (recorder !== null) {
        void recorder.stop().catch(() => undefined);
      }

      releaseRecordingWakeLock();
      stopAmbientMicrophoneMonitor();
      revokeObjectUrl(downloadUrlRef.current);
      revokeObjectUrl(metadataDownloadUrlRef.current);
      revokeObjectUrl(workspaceBackupUrlRef.current);
      revokeObjectUrl(backingTrackUrlRef.current);
      revokeObjectUrl(datasetZipUrlRef.current);
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
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    const audioContext = new AudioContextConstructor();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);
    let frameId = 0;
    let smoothedLevel = 0;

    analyser.fftSize = 2048;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -8;
    analyser.smoothingTimeConstant = 0.42;
    source.connect(analyser);

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    function updateAmbientLevel() {
      analyser.getByteFrequencyData(frequencyData);
      analyser.getByteTimeDomainData(timeData);

      let sumSquares = 0;

      for (const value of timeData) {
        const normalized = (value - 128) / 128;

        sumSquares += normalized * normalized;
      }

      const rms = Math.sqrt(sumSquares / Math.max(1, timeData.length));
      smoothedLevel += (rms - smoothedLevel) * 0.12;

      if (pcmRecorderRef.current === null && !isPersistingRef.current) {
        updateVisualAudioLevel(Math.min(1, smoothedLevel * 4.8));
      }

      frameId = window.requestAnimationFrame(updateAmbientLevel);
    }

    frameId = window.requestAnimationFrame(updateAmbientLevel);

    return {
      stream,
      stop() {
        window.cancelAnimationFrame(frameId);
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

  useEffect(() => {
    if (screen !== "karaoke" || words.length === 0) {
      stopReadingGuide();
      return;
    }

    startReadingGuide(words, selectedLanguage);

    return () => stopReadingGuide();
  }, [screen, promptText, selectedLanguage]);

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

    return nextWorkspace;
  }

  async function downloadDatasetPackage() {
    if (workspace === null || activeCorpus === null) {
      return;
    }

    setDatasetExportState({ status: "preparing" });

    try {
      const plan = createDatasetPackagePlan({
        corpus: activeCorpus,
        speaker: selectedSpeaker,
        workspace,
      });

      if (plan.keeperCount === 0) {
        setDatasetExportState({
          status: "error",
          message:
            "Aucune prise gardée pour l'instant. Enregistre des prises validées avant d'exporter le dataset.",
        });
        return;
      }

      const zip = await createDatasetZip({
        getAudioBlob: getBrowserRecording,
        plan,
      });

      revokeObjectUrl(datasetZipUrlRef.current);
      const url = URL.createObjectURL(zip.blob);
      datasetZipUrlRef.current = url;

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `voice-capture-dataset-${workspace.workspaceId}.zip`;
      anchor.click();

      setDatasetExportState({
        status: "done",
        keeperCount: plan.keeperCount,
        missingAudioFiles: zip.missingAudioFiles,
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

  async function writeDatasetPackageToFolder() {
    if (workspace === null || activeCorpus === null) {
      return;
    }

    setDatasetExportState({ status: "preparing" });

    try {
      const plan = createDatasetPackagePlan({
        corpus: activeCorpus,
        speaker: selectedSpeaker,
        workspace,
      });

      if (plan.keeperCount === 0) {
        setDatasetExportState({
          status: "error",
          message:
            "Aucune prise gardée pour l'instant. Enregistre des prises validées avant d'exporter le dataset.",
        });
        return;
      }

      const result = await saveDatasetPackageToWorkspaceFolder({
        getAudioBlob: getBrowserRecording,
        jsonFiles: plan.jsonFiles,
        textFiles: plan.textFiles,
        audioFiles: plan.audioFiles,
        readme: plan.readme,
      });

      if (!result.ok) {
        setDatasetExportState({ status: "error", message: result.message });
        return;
      }

      setDatasetExportState({
        status: "done",
        keeperCount: plan.keeperCount,
        missingAudioFiles: [],
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
      stopBackingTrackPlayback(true);
    }

    setMessage(createModeMessage(mode));
  }

  function updateCustomCorpusText(
    text: string,
    sourceName = customCorpusSourceName,
  ) {
    setCustomCorpusText(text);
    setCustomCorpusSourceName(text.trim().length === 0 ? null : sourceName);
    setSession(null);
    resetTakeOutputState();
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

      if (captureMode === "training") {
        setCaptureMode("dubbing");
      }

      updateCustomCorpusText(text, file.name);
      setMessage(`Corpus local chargé : ${file.name}.`);
    } catch {
      setMessage("Impossible de lire ce fichier texte.");
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
    setMessage(`Retour casque chargé : ${file.name}.`);
  }

  function clearBackingTrack() {
    replaceBackingTrack(null);
    setMessage("Retour casque retiré.");
  }

  function replaceBackingTrack(track: BackingTrack | null) {
    stopBackingTrackPlayback(true);
    revokeObjectUrl(backingTrackUrlRef.current);
    backingTrackUrlRef.current = track?.url ?? null;
    setBackingTrack(track);
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
        "Prise lancée. Le navigateur demande de démarrer le retour casque manuellement.",
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
      setMessage(captureBlocker);
      return;
    }

    if (activeCorpus === null) {
      setMessage(
        "Ajoute un texte ou glisse un fichier pour créer le corpus local.",
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
    });

    if (nextSession.plannedPromptIds.length === 0) {
      setMessage("Aucune phrase disponible pour cette voix et cette langue.");
      return;
    }

    setSession(nextSession);
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

  async function allowMicrophoneAndStart() {
    if (session === null) {
      return;
    }

    const captureBlocker = getCaptureBlocker(diagnostics);

    if (captureBlocker !== null) {
      setMessage(captureBlocker);
      return;
    }

    if (pcmRecorderRef.current !== null || isPersistingRef.current) {
      setMessage("Une prise est déjà en cours de finalisation.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(
        "Micro indisponible ici. Ouvre le site en HTTPS et autorise le micro.",
      );
      return;
    }

    if (
      !window.AudioContext &&
      !(window as WindowWithAudioContext).webkitAudioContext
    ) {
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
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }
      const recorder = await createPcmRecorder(stream, {
        onLevel: updateVisualAudioLevel,
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

      startPromptRecording(stream, recorder);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setMessage(createMicrophoneErrorMessage(error));
      void refreshDiagnostics(false);
    }
  }

  function startPromptRecording(
    stream: MediaStream,
    recorder: PcmRecorder,
    message = "Enregistrement en cours. Lis naturellement : le texte suit ta voix.",
  ) {
    clearRoomToneTimers();
    mediaStreamRef.current = stream;
    pcmRecorderRef.current = recorder;
    visualAudioLevelRef.current = 0;
    setAudioLevel(0);
    setActiveWordIndex(0);
    setScreen("karaoke");
    setMessage(message);

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
    lastTranscriptAtRef.current = 0;
    activeWordIndexRef.current = 0;
    setActiveWordIndex(0);
    setRecognizedTranscript("");

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

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = formatSpeechRecognitionLanguage(language);
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const transcript = extractSpeechRecognitionTranscript(event);

        if (transcript.length === 0) {
          return;
        }

        lastTranscriptAtRef.current = performance.now();
        setRecognizedTranscript(transcript);
        updateReadingGuideIndex(
          alignTranscriptToPrompt(promptWords, transcript),
          promptWords.length,
        );
      };
      recognition.onerror = () => {
        if (speechRecognitionRef.current === recognition) {
          speechRecognitionRef.current = null;
        }

        setReadingGuideMode("voice-activity");
      };
      recognition.onend = () => {
        if (speechRecognitionRef.current === recognition) {
          speechRecognitionRef.current = null;
        }

        if (
          screenRef.current === "karaoke" &&
          activeWordIndexRef.current < promptWords.length - 1
        ) {
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

  function updateVoiceActivityGuide(promptWords: readonly string[]) {
    if (promptWords.length === 0 || screenRef.current !== "karaoke") {
      return;
    }

    const now = performance.now();
    const deltaMs = Math.max(0, now - readingGuideLastTickAtRef.current);

    readingGuideLastTickAtRef.current = now;

    const level = visualAudioLevelRef.current;
    const isVoiceActive = level >= 0.045;
    const recognitionIsFresh =
      readingGuideModeRef.current === "speech-recognition" &&
      lastTranscriptAtRef.current > 0 &&
      now - lastTranscriptAtRef.current < 1600;

    if (!isVoiceActive || recognitionIsFresh) {
      return;
    }

    const expectedSpeechMs = estimateSpeechGuideDurationMs(
      promptWords,
      activePrompt,
    );
    const totalWeight = sumWordWeights(promptWords);
    const speechWeightPerMs = totalWeight / expectedSpeechMs;
    const energyFactor = 0.72 + Math.min(0.55, level * 0.7);

    readingGuideLastSpeechAtRef.current = now;
    readingGuideProgressRef.current = Math.min(
      totalWeight,
      readingGuideProgressRef.current +
        deltaMs * speechWeightPerMs * energyFactor,
    );
    updateReadingGuideIndex(
      wordIndexFromSpeechProgress(promptWords, readingGuideProgressRef.current),
      promptWords.length,
    );
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

    if (boundedIndex >= wordCount - 1) {
      const now = performance.now();
      const maximumExpectedMs =
        estimateSpeechGuideDurationMs(words, activePrompt) * 1.4;
      const finishedBySilence = now - readingGuideLastSpeechAtRef.current > 650;
      const finishedByDuration =
        now - readingGuideStartedAtRef.current > maximumExpectedMs;

      if (
        readingGuideModeRef.current === "speech-recognition" ||
        finishedBySilence ||
        finishedByDuration
      ) {
        scheduleReadingGuideFinish();
      }
      return;
    }

    clearReadingGuideFinishTimer();
  }

  function scheduleReadingGuideFinish() {
    if (
      readingGuideFinishTimerRef.current !== null ||
      isPersistingRef.current
    ) {
      return;
    }

    readingGuideFinishTimerRef.current = window.setTimeout(() => {
      readingGuideFinishTimerRef.current = null;

      if (screenRef.current === "karaoke" && !isPersistingRef.current) {
        void finishRecordingRef.current();
      }
    }, 850);
  }

  function setReadingGuideMode(mode: ReadingGuideMode) {
    readingGuideModeRef.current = mode;
    setReadingGuideModeState(mode);
  }

  function stopReadingGuide() {
    const recognition = speechRecognitionRef.current;

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

    clearReadingGuideFinishTimer();
  }

  function clearReadingGuideFinishTimer() {
    if (readingGuideFinishTimerRef.current !== null) {
      window.clearTimeout(readingGuideFinishTimerRef.current);
      readingGuideFinishTimerRef.current = null;
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
      });

      startPromptRecording(
        stream,
        nextRecorder,
        `Salle calibrée : bruit de fond ${calibration.noiseFloorDbfs} dBFS. Enregistrement de la phrase.`,
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
      pcmRecorderRef.current = null;
      isPersistingRef.current = true;
      setIsFinalizing(true);
      setMessage("Préparation du fichier...");

      try {
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
    visualAudioLevelRef.current = 0;
    setAudioLevel(0);

    const currentWorkspace = workspaceRef.current ?? workspace;

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

    const finalization = await finalizeCaptureSession({
      activePrompt,
      corpus: activeCorpus,
      folderName,
      recognizedTranscript,
      recording,
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

  function resetTakeOutputState() {
    stopReadingGuide();
    setActiveWordIndex(0);
    setRecognizedTranscript("");
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

  function updateVisualAudioLevel(level: number) {
    const boostedLevel = Math.min(1, Math.max(0, Math.pow(level, 0.58)));
    const previousLevel = visualAudioLevelRef.current;
    const nextLevel =
      boostedLevel > previousLevel
        ? previousLevel + (boostedLevel - previousLevel) * 0.86
        : previousLevel * 0.58 + boostedLevel * 0.42;

    visualAudioLevelRef.current = nextLevel;
    setAudioLevel(nextLevel);
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
    event.currentTarget.style.setProperty("--pointer-intensity", "0.36");
  }

  const isCapturing = screen === "calibration" || screen === "karaoke";
  const appClassName = [
    "simple-app",
    `screen-${screen}`,
    studioAwake ? "is-awake" : "is-ritual",
    isCapturing ? "is-recording" : "",
    isFinalizing ? "is-finalizing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main
      className={appClassName}
      onPointerDown={updateAmbientPointer}
      onPointerLeave={settleAmbientPointer}
      onPointerMove={updateAmbientPointer}
      style={{ "--audio-level": audioLevel } as CSSProperties}
    >
      <AmbientBackdrop awake={studioAwake} />
      <VoiceWaveformSurface
        audioLevel={audioLevel}
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
              <a
                className="site-signature"
                href="https://www.electronicartefacts.com"
                rel="noreferrer"
                target="_blank"
              >
                www.electronicartefacts.com
              </a>
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
              captureMode={captureMode}
              corpusId={activeCorpus?.id ?? null}
              corpusVersion={activeCorpus?.version ?? null}
              coverage={coverage}
              coveragePercent={coverage?.percent ?? 0}
              datasetExportState={datasetExportState}
              diagnostics={diagnostics}
              folderName={folderName}
              onBack={() => setScreen("home")}
              onDownloadDataset={downloadDatasetPackage}
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
                  folderName={folderName}
                  language={selectedLanguage}
                  localCorpusSummary={localCorpus?.summary ?? null}
                  onBackingTrackChange={loadBackingTrackFile}
                  onBackingTrackClear={clearBackingTrack}
                  onBackingTrackLoopChange={setBackingTrackLoop}
                  onBackingTrackVolumeChange={setBackingTrackVolume}
                  onCaptureModeChange={selectCaptureMode}
                  message={message}
                  onChooseFolder={selectFolder}
                  onCustomCorpusFile={loadCustomCorpusFile}
                  onCustomCorpusTextChange={(text) =>
                    updateCustomCorpusText(
                      text,
                      customCorpusSourceName ?? "Texte libre",
                    )
                  }
                  onLanguageChange={setSelectedLanguage}
                  onProfileChange={updateCaptureProfile}
                  onRefreshDiagnostics={() => void refreshDiagnostics()}
                  onSpeakerChange={selectSpeaker}
                  onSpeakerCreate={createSpeaker}
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
                  insight={activePromptInsight}
                  diagnostics={diagnostics}
                  isSpeakingReference={isSpeakingReference}
                  message={message}
                  prompt={activePrompt}
                  onAllow={allowMicrophoneAndStart}
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
                  onAgain={prepareSession}
                  onNext={continueToNextPrompt}
                  onHome={() => setScreen("home")}
                  onRetake={retakeCurrentPrompt}
                />
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

function OpeningRitual(input: {
  readonly onAwaken: () => void;
  readonly status: RitualStatus;
}) {
  const buttonLabel =
    input.status === "requesting"
      ? "Listening..."
      : input.status === "denied"
        ? "Try microphone again"
        : "Enable your microphone";

  return (
    <section className="opening-ritual" aria-live="polite">
      <div>
        <h1>Welcome to Voice Capture Studio.</h1>
        <button
          className="ritual-button"
          disabled={input.status === "requesting"}
          onClick={input.onAwaken}
          type="button"
        >
          <Mic aria-hidden="true" size={18} />
          <span>{buttonLabel}</span>
        </button>
        {input.status === "denied" && (
          <p>Microphone access is required to enter the studio.</p>
        )}
      </div>
    </section>
  );
}

function VoiceWaveformSurface(input: {
  readonly audioLevel: number;
  readonly awake: boolean;
  readonly playbackProgress: number;
  readonly screen: Screen;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioLevelRef = useRef(input.audioLevel);
  const awakeRef = useRef(input.awake);
  const playbackProgressRef = useRef(input.playbackProgress);
  const screenRef = useRef(input.screen);

  useEffect(() => {
    audioLevelRef.current = input.audioLevel;
  }, [input.audioLevel]);

  useEffect(() => {
    awakeRef.current = input.awake;
  }, [input.awake]);

  useEffect(() => {
    playbackProgressRef.current = input.playbackProgress;
  }, [input.playbackProgress]);

  useEffect(() => {
    screenRef.current = input.screen;
  }, [input.screen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (canvas === null || context === undefined || context === null) {
      return;
    }

    const surfaceCanvas = canvas;
    const ctx = context;
    const previousWaveform = new Float32Array(WAVEFORM_DISPLAY_SAMPLES).fill(0);
    let frameId = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;

      surfaceCanvas.width = Math.floor(window.innerWidth * dpr);
      surfaceCanvas.height = Math.floor(window.innerHeight * dpr);
      surfaceCanvas.style.width = `${window.innerWidth}px`;
      surfaceCanvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function readColor(variableName: string, fallback: string): string {
      return (
        getComputedStyle(document.documentElement)
          .getPropertyValue(variableName)
          .trim() || fallback
      );
    }

    function readNumber(variableName: string, fallback: number): number {
      const value = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          variableName,
        ),
      );

      return Number.isFinite(value) ? value : fallback;
    }

    function getWaveCenterRatio(state: Screen, width: number): number {
      if (state === "home") {
        return width < 720 ? 0.28 : width < 980 ? 0.24 : 0.36;
      }

      if (state === "permission") {
        return width < 720 ? 0.22 : 0.7;
      }

      if (state === "technical") {
        return width < 720 ? 0.2 : 0.34;
      }

      if (state === "done") {
        return width < 720 ? 0.58 : 0.64;
      }

      return 0.5;
    }

    function createWaveSample(
      index: number,
      timeSeconds: number,
      level: number,
      state: Screen,
    ): number {
      const position = index / Math.max(1, WAVEFORM_DISPLAY_SAMPLES - 1);
      const phase = position * Math.PI * 2;
      const recordingGain =
        state === "karaoke" ? 1 : state === "calibration" ? 0.42 : 0.22;
      const reviewGain = state === "done" ? 0.52 : 0;
      const quietMotion = 0.018 + (state === "home" ? 0.012 : 0);
      const gain = quietMotion + level * (recordingGain + reviewGain);
      const carrier =
        Math.sin(phase * 2.8 + timeSeconds * 1.7) * 0.42 +
        Math.sin(phase * 5.7 - timeSeconds * 1.15) * 0.27 +
        Math.sin(phase * 11.2 + timeSeconds * 0.72) * 0.13;
      const breath =
        Math.sin(timeSeconds * 0.85 + index * 0.037) * (0.03 + level * 0.08);

      return softLimitWaveSample(carrier * gain + breath, 0.88, 4.8);
    }

    function drawSpline(
      points: readonly { readonly x: number; readonly y: number }[],
      offsetScale: number,
      lineWidth: number,
      alpha: number,
      color: string,
    ) {
      if (points.length < 2) {
        return;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);

      for (let index = 0; index < points.length - 1; index += 1) {
        const p0 = index > 0 ? points[index - 1] : points[0];
        const p1 = points[index];
        const p2 = points[index + 1];
        const p3 =
          index + 2 < points.length ? points[index + 2] : (points.at(-1) ?? p2);
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const normalX = (-dy / length) * offsetScale;
        const normalY = (dx / length) * offsetScale;
        const cp1x = p1.x + (p2.x - p0.x) / 6 + normalX;
        const cp1y = p1.y + (p2.y - p0.y) / 6 + normalY;
        const cp2x = p2.x - (p3.x - p1.x) / 6 + normalX;
        const cp2y = p2.y - (p3.y - p1.y) / 6 + normalY;

        ctx.bezierCurveTo(
          cp1x,
          cp1y,
          cp2x,
          cp2y,
          p2.x + normalX,
          p2.y + normalY,
        );
      }

      ctx.stroke();
      ctx.restore();
    }

    function draw() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const timeSeconds = performance.now() * 0.001;
      const waveColor = readColor(
        "--wave-surface-color",
        "rgba(255,255,255,0.72)",
      );
      const guideColor = readColor(
        "--wave-surface-guide",
        "rgba(255,255,255,0.14)",
      );
      const playheadColor = readColor(
        "--wave-surface-playhead",
        "rgba(122,220,255,0.9)",
      );
      const waveAlpha = clampUnit(readNumber("--wave-surface-alpha", 0.72));
      const state = screenRef.current;
      const isAwake = awakeRef.current;
      const level = isAwake
        ? Math.max(0, Math.min(1, audioLevelRef.current))
        : 0;

      ctx.clearRect(0, 0, width, height);

      if (!isAwake) {
        frameId = window.requestAnimationFrame(draw);
        return;
      }

      const centerRatio = getWaveCenterRatio(state, width);
      const centerY = height * centerRatio;
      const isCaptureSurface = state === "calibration" || state === "karaoke";
      const isQuietSurface = ["home", "permission", "technical"].includes(
        state,
      );
      const visualHeight = Math.min(
        isQuietSurface ? 180 : 260,
        height * (isQuietSurface ? 0.16 : 0.25),
      );
      const points: { x: number; y: number }[] = [];

      for (let index = 0; index < WAVEFORM_DISPLAY_SAMPLES; index += 1) {
        const position = index / Math.max(1, WAVEFORM_DISPLAY_SAMPLES - 1);
        const edge = Math.abs(position - 0.5) * 2;
        const envelope = Math.pow(
          0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, 1 - edge)),
          1.8,
        );
        const targetSample = createWaveSample(index, timeSeconds, level, state);
        const smoothing = state === "karaoke" ? 0.48 : 0.22;
        const sample =
          previousWaveform[index] +
          (targetSample - previousWaveform[index]) * smoothing;

        previousWaveform[index] = sample;
        points.push({
          x: width * position,
          y: centerY + sample * (0.08 + envelope * 0.92) * visualHeight,
        });
      }

      if (["calibration", "karaoke", "done"].includes(state)) {
        ctx.save();
        ctx.strokeStyle = guideColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = isCaptureSurface ? 0.48 : 0.34;
        ctx.beginPath();
        ctx.moveTo(width / 2, centerY - visualHeight * 1.22);
        ctx.lineTo(width / 2, centerY + visualHeight * 1.22);
        ctx.stroke();
        ctx.restore();
      }

      const quietAlpha = isQuietSurface ? 0.24 : 1;
      const captureAlpha = isCaptureSurface ? 0.56 : 1;
      const alpha = waveAlpha * quietAlpha * captureAlpha;
      const primaryWidth = state === "karaoke" ? 3.1 : 2.8;

      drawSpline(points, -4, 0.26, alpha * 0.04, waveColor);
      drawSpline(points, -2.4, 0.42, alpha * 0.09, waveColor);
      drawSpline(points, -1.1, 0.74, alpha * 0.18, waveColor);
      drawSpline(points, -0.4, 1.18, alpha * 0.28, waveColor);
      drawSpline(points, 0, primaryWidth, alpha * 0.68, waveColor);
      drawSpline(points, 0.4, 1.18, alpha * 0.28, waveColor);
      drawSpline(points, 1.1, 0.74, alpha * 0.18, waveColor);
      drawSpline(points, 2.4, 0.42, alpha * 0.09, waveColor);
      drawSpline(points, 4, 0.26, alpha * 0.04, waveColor);

      if (state === "done") {
        const progress = Math.max(0, Math.min(1, playbackProgressRef.current));
        const x = width * progress;

        ctx.save();
        ctx.strokeStyle = playheadColor;
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = waveAlpha * 0.5;
        ctx.beginPath();
        ctx.moveTo(x, centerY - visualHeight * 1.08);
        ctx.lineTo(x, centerY + visualHeight * 1.08);
        ctx.stroke();
        ctx.restore();
      }

      frameId = window.requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    frameId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas aria-hidden="true" className="voice-wave-canvas" ref={canvasRef} />
  );
}

function AmbientBackdrop(input: { readonly awake: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`ambient-backdrop${input.awake ? " is-awake" : ""}`}
    >
      <span className="voice-halo halo-a" />
      <span className="voice-halo halo-b" />
      <span className="voice-halo halo-c" />
      <span className="voice-halo halo-d" />
    </div>
  );
}

function createModeMessage(mode: CaptureMode): string {
  if (mode === "training") {
    return "Mode dataset : le corpus intégré reste actif pour entraîner et comparer les prises.";
  }

  if (mode === "dubbing") {
    return "Mode doublage : ajoute un script local, puis enregistre les répliques une par une.";
  }

  return "Mode master : ajoute un texte local et, si besoin, une piste de retour au casque.";
}

function createSessionPreparationMessage(mode: CaptureMode): string {
  if (mode === "mastering") {
    return "Lis la consigne. Au lancement, reste silencieux pendant la calibration, puis le retour casque démarre avec la prise.";
  }

  if (mode === "dubbing") {
    return "Lis la réplique. Au lancement, reste silencieux pendant la calibration de salle.";
  }

  return "Lis la consigne. Au lancement, reste silencieux pendant la calibration de salle.";
}

function createRuntimeHomeMessage(diagnostics: RuntimeDiagnostics): string {
  if (diagnostics.status === "blocked") {
    return diagnostics.primaryAction;
  }

  if (diagnostics.status === "limited") {
    return `Mode local limité. ${diagnostics.primaryAction}`;
  }

  return "Prêt. La prochaine phrase cible les zones encore peu couvertes.";
}

function isSupportedTextFile(file: File): boolean {
  const extension = file.name.toLowerCase().split(".").at(-1) ?? "";

  return (
    file.type.startsWith("text/") ||
    ["txt", "md", "markdown", "srt", "vtt"].includes(extension)
  );
}

function isSupportedAudioFile(file: File): boolean {
  const extension = file.name.toLowerCase().split(".").at(-1) ?? "";

  return (
    file.type.startsWith("audio/") ||
    ["wav", "mp3", "m4a", "aac", "ogg", "flac"].includes(extension)
  );
}

function createMemoryOnlyWorkspaceMessage(): string {
  return "Session temporaire: les données restent dans cet onglet. Télécharge les exports avant de fermer.";
}

function canCreateWorkspaceAfterOpenFailure(
  error: WorkspaceOpenError,
): boolean {
  return (
    error === "workspace-not-found" || error === "workspace-storage-unavailable"
  );
}

function isDefaultHomeMessage(message: string): boolean {
  return (
    message ===
      "Sélectionne une voix, confirme l'environnement, puis lance une session courte." ||
    message.startsWith("Prêt.") ||
    message.startsWith("Mode local limité.")
  );
}

function formatRuntimeStatus(
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

function formatSaveTarget(
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

function formatCaptureMode(mode: CaptureMode): string {
  if (mode === "training") {
    return "Dataset ML";
  }

  if (mode === "dubbing") {
    return "Doublage";
  }

  return "Master audio";
}

function explainPromptChoice(
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

function createTakeCoachNote(
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

  return nextRecommendation ?? "Prise utilisable. Passe à la phrase suivante.";
}

function formatPace(pace: PromptDefinition["delivery"]["pace"]): string {
  const labels: Record<PromptDefinition["delivery"]["pace"], string> = {
    slow: "lent",
    medium_slow: "plutôt lent",
    natural: "naturel",
    medium_fast: "plutôt rapide",
    fast: "rapide",
  };

  return labels[pace];
}

function formatEnergy(energy: PromptDefinition["delivery"]["energy"]): string {
  const labels: Record<PromptDefinition["delivery"]["energy"], string> = {
    low: "basse",
    medium_low: "modérée basse",
    medium: "moyenne",
    medium_high: "modérée haute",
    high: "haute",
  };

  return labels[energy];
}

function formatCoveragePace(pace: string): string {
  if (isPromptPace(pace)) {
    return formatPace(pace);
  }

  return pace;
}

function formatCoverageEnergy(energy: string): string {
  if (isPromptEnergy(energy)) {
    return formatEnergy(energy);
  }

  return energy;
}

function formatCoverageIntent(intent: string): string {
  const prompt = canonicalCorpus.scenarios
    .flatMap((scenario) => scenario.prompts)
    .find((candidate) => candidate.intention.primary === intent);

  return prompt?.intention.label ?? intent.replace(/_/g, " ");
}

function formatPhoneticTarget(target: string): string {
  return target
    .replace(/^fr_/, "FR ")
    .replace(/^en_/, "EN ")
    .replace(/_/g, " ");
}

function isPromptPace(
  value: string,
): value is PromptDefinition["delivery"]["pace"] {
  return ["slow", "medium_slow", "natural", "medium_fast", "fast"].includes(
    value,
  );
}

function isPromptEnergy(
  value: string,
): value is PromptDefinition["delivery"]["energy"] {
  return ["low", "medium_low", "medium", "medium_high", "high"].includes(value);
}

function Score(input: { readonly label: string; readonly value: number }) {
  return (
    <div>
      <span>{input.label}</span>
      <strong>{input.value}/100</strong>
    </div>
  );
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function createRoomToneCalibration(
  metrics: PcmRecordingMetrics,
): RoomToneCalibration {
  return {
    durationMs: metrics.durationMs,
    peakDbfs: metrics.peakDbfs,
    noiseFloorDbfs: metrics.noiseFloorDbfs,
    integratedLufs: metrics.integratedLufs,
  };
}

function formatDurationSeconds(durationMs: number): string {
  return `${Math.max(0, durationMs / 1000).toFixed(1)} s`;
}

function formatSpeechRecognitionLanguage(language: LanguageCode): string {
  return language === "fr" ? "fr-FR" : "en-US";
}

function extractSpeechRecognitionTranscript(
  event: SpeechRecognitionEventLike,
): string {
  const segments: string[] = [];

  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcript = result?.[0]?.transcript;

    if (transcript !== undefined) {
      segments.push(transcript);
    }
  }

  return segments.join(" ").trim();
}

function alignTranscriptToPrompt(
  promptWords: readonly string[],
  transcript: string,
): number {
  const promptTokens = promptWords.map(normalizeSpeechToken);
  const spokenTokens = tokenizeSpeech(transcript);
  let cursor = 0;
  let bestMatchIndex = 0;

  if (spokenTokens.length === 0 || promptTokens.length === 0) {
    return 0;
  }

  for (const spokenToken of spokenTokens) {
    let matchIndex = -1;
    const searchLimit = Math.min(promptTokens.length, cursor + 8);

    for (let index = cursor; index < searchLimit; index += 1) {
      if (speechTokensMatch(promptTokens[index], spokenToken)) {
        matchIndex = index;
        break;
      }
    }

    if (matchIndex === -1) {
      continue;
    }

    bestMatchIndex = matchIndex;
    cursor = matchIndex + 1;
  }

  return Math.min(promptWords.length - 1, bestMatchIndex);
}

function tokenizeSpeech(text: string): readonly string[] {
  return text
    .split(/\s+/)
    .map(normalizeSpeechToken)
    .filter((token) => token.length > 0);
}

function normalizeSpeechToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function speechTokensMatch(expected: string, actual: string): boolean {
  if (expected === actual) {
    return true;
  }

  if (expected.length < 3 || actual.length < 3) {
    return false;
  }

  if (
    (expected.length >= 5 && expected.endsWith(actual)) ||
    (actual.length >= 5 && actual.endsWith(expected))
  ) {
    return true;
  }

  if (
    Math.min(expected.length, actual.length) >= 5 &&
    (expected.startsWith(actual) || actual.startsWith(expected))
  ) {
    return true;
  }

  const allowedDistance = Math.min(expected.length, actual.length) >= 7 ? 2 : 1;

  return (
    levenshteinDistance(expected, actual, allowedDistance) <= allowedDistance
  );
}

function levenshteinDistance(
  left: string,
  right: string,
  maxDistance: number,
): number {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return maxDistance + 1;
  }

  const previousRow = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  const currentRow = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    currentRow[0] = leftIndex;
    let rowMinimum = currentRow[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const distance = Math.min(
        previousRow[rightIndex] + 1,
        currentRow[rightIndex - 1] + 1,
        previousRow[rightIndex - 1] + substitutionCost,
      );

      currentRow[rightIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    for (let index = 0; index < previousRow.length; index += 1) {
      previousRow[index] = currentRow[index];
    }
  }

  return previousRow[right.length];
}

function estimateSpeechGuideDurationMs(
  promptWords: readonly string[],
  prompt: PromptDefinition | undefined,
): number {
  const corpusEstimate =
    prompt === undefined
      ? promptWords.length * 560
      : (prompt.qa.minDurationMs + prompt.qa.maxDurationMs) / 2;
  const minimum = Math.max(1400, promptWords.length * 260);
  const maximum = Math.max(minimum + 900, promptWords.length * 980);

  return Math.min(maximum, Math.max(minimum, corpusEstimate));
}

function sumWordWeights(words: readonly string[]): number {
  return words.reduce(
    (total, word) => total + estimateSpeechWordWeight(word),
    0,
  );
}

function wordIndexFromSpeechProgress(
  words: readonly string[],
  progressWeight: number,
): number {
  let accumulatedWeight = 0;

  for (let index = 0; index < words.length; index += 1) {
    accumulatedWeight += estimateSpeechWordWeight(words[index]);

    if (progressWeight <= accumulatedWeight) {
      return index;
    }
  }

  return Math.max(0, words.length - 1);
}

function estimateSpeechWordWeight(word: string): number {
  const normalizedLength = Math.max(1, normalizeSpeechToken(word).length);

  return Math.min(2.35, Math.max(0.72, normalizedLength / 5));
}

function createTranscriptPreview(transcript: string): string {
  const tokens = transcript.trim().split(/\s+/).filter(Boolean).slice(-10);

  return tokens.length === 0 ? "" : tokens.join(" ");
}

function formatDatasetReadiness(
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

function HomeScreen(input: {
  readonly backingAudioRef: RefObject<HTMLAudioElement | null>;
  readonly backingTrack: BackingTrack | null;
  readonly backingTrackLoop: boolean;
  readonly backingTrackVolume: number;
  readonly captureProfile: CaptureProfile | undefined;
  readonly captureMode: CaptureMode;
  readonly coverage: CoverageSummary | null;
  readonly customCorpusSourceName: string | null;
  readonly customCorpusText: string;
  readonly diagnostics: RuntimeDiagnostics;
  readonly folderName: string | null;
  readonly language: LanguageCode;
  readonly localCorpusSummary: LocalTextCorpusSummary | null;
  readonly message: string;
  readonly onBackingTrackChange: (file: File) => void;
  readonly onBackingTrackClear: () => void;
  readonly onBackingTrackLoopChange: (loop: boolean) => void;
  readonly onBackingTrackVolumeChange: (volume: number) => void;
  readonly onCaptureModeChange: (mode: CaptureMode) => void;
  readonly onChooseFolder: () => void;
  readonly onCustomCorpusFile: (file: File) => void;
  readonly onCustomCorpusTextChange: (text: string) => void;
  readonly onLanguageChange: (language: LanguageCode) => void;
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
  const ModeIcon = modeContent.icon;
  const localCorpusReady =
    input.captureMode === "training" || input.localCorpusSummary !== null;
  const recordingReady = input.diagnostics.canRecord && localCorpusReady;
  const folderSelected = input.folderName !== null;
  const setupLabel = !input.diagnostics.canRecord
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
    input.captureMode === "training"
      ? readiness
      : input.localCorpusSummary === null
        ? "Texte local attendu"
        : `${input.localCorpusSummary.promptCount} segment${
            input.localCorpusSummary.promptCount > 1 ? "s" : ""
          }`;
  const corpusRecommendation =
    input.captureMode === "training"
      ? (input.coverage?.nextRecommendation ??
        "Commence par un silence de pièce, puis deux prises neutres.")
      : input.localCorpusSummary === null
        ? "Colle un script ou charge un fichier texte."
        : `${input.localCorpusSummary.wordCount} mots chargés${
            input.localCorpusSummary.sourceName === null
              ? ""
              : ` depuis ${input.localCorpusSummary.sourceName}`
          }.`;

  return (
    <div className="home-card">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="premium-pill">
          <ModeIcon aria-hidden="true" size={16} />
          <span>{modeContent.pill}</span>
        </div>
        <div>
          <p className="soft-label">{modeContent.kicker}</p>
          <h1 id="home-title">{modeContent.headline}</h1>
          <p className="plain-text" aria-live="polite">
            {input.message}
          </p>
        </div>
        <div className="status-strip" aria-label="État de la session">
          <div>
            <HardDrive aria-hidden="true" size={18} />
            <span>{storageStatus}</span>
          </div>
          <div>
            <Timer aria-hidden="true" size={18} />
            <span>
              {input.savedSessions} session{input.savedSessions > 1 ? "s" : ""}
            </span>
          </div>
          <div>
            <Check aria-hidden="true" size={18} />
            <span>
              {input.captureMode === "training"
                ? `${formatPercent(coveragePercent)} couvert`
                : corpusStatus}
            </span>
          </div>
        </div>
      </section>

      <section
        className="home-workbench"
        aria-label="Préparation de la session"
      >
        <div className="workbench-header">
          <div>
            <p className="soft-label">Démarrage</p>
            <h2>{modeContent.workbenchTitle}</h2>
          </div>
          <span className={`setup-pill is-${setupTone}`}>
            <BadgeCheck aria-hidden="true" size={16} />
            {setupLabel}
          </span>
        </div>

        <CaptureModeSelector
          mode={input.captureMode}
          onChange={input.onCaptureModeChange}
        />

        <SessionFlowGuide
          captureMode={input.captureMode}
          diagnostics={input.diagnostics}
          folderName={input.folderName}
          localCorpusReady={localCorpusReady}
          localCorpusSummary={input.localCorpusSummary}
        />

        <div className="coverage-console">
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

        <SystemHealthPanel
          diagnostics={input.diagnostics}
          onRefresh={input.onRefreshDiagnostics}
        />

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

        <VoiceManager
          language={input.language}
          onLanguageChange={input.onLanguageChange}
          onSpeakerChange={input.onSpeakerChange}
          onSpeakerCreate={input.onSpeakerCreate}
          selectedSpeaker={input.selectedSpeaker}
          selectedSpeakerId={input.selectedSpeakerId}
          speakers={input.speakers}
        />

        {input.captureMode !== "training" && (
          <LocalCorpusEditor
            mode={input.captureMode}
            onFile={input.onCustomCorpusFile}
            onTextChange={input.onCustomCorpusTextChange}
            sourceName={input.customCorpusSourceName}
            summary={input.localCorpusSummary}
            text={input.customCorpusText}
          />
        )}

        {input.captureMode === "mastering" && (
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
        )}

        <div className="primary-actions">
          <button
            className="folder-button"
            onClick={input.onChooseFolder}
            type="button"
          >
            <FolderOpen aria-hidden="true" size={19} />
            <span>{input.folderName ?? "Choisir un dossier d'export"}</span>
          </button>

          <button
            className="launch-button"
            disabled={!input.diagnostics.canRecord || !localCorpusReady}
            onClick={input.onStart}
            type="button"
          >
            <Play aria-hidden="true" size={20} />
            <span>
              {!input.diagnostics.canRecord
                ? "Enregistrement indisponible"
                : !localCorpusReady
                  ? "Ajouter un texte"
                  : folderSelected
                    ? "Lancer la session"
                    : "Lancer avec téléchargement"}
            </span>
          </button>
        </div>

        <p className={`action-hint${folderSelected ? " is-ready" : ""}`}>
          {folderSelected
            ? `Les WAV et JSON seront enregistrés dans ${input.folderName}.`
            : "Sans dossier local, garde les boutons WAV et JSON après chaque prise."}
        </p>

        {input.captureProfile !== undefined && (
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
      </section>
    </div>
  );
}

function VoiceManager(input: {
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

      <form className="voice-create" onSubmit={submitSpeaker}>
        <label className="voice-name-field">
          <span>Nouvelle voix</span>
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
    </section>
  );
}

const captureModeOptions: readonly {
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

function getCaptureModeContent(mode: CaptureMode) {
  return (
    captureModeOptions.find((option) => option.mode === mode) ??
    captureModeOptions[0]
  );
}

function CaptureModeSelector(input: {
  readonly mode: CaptureMode;
  readonly onChange: (mode: CaptureMode) => void;
}) {
  return (
    <section className="capture-mode-grid" aria-label="Modes de capture">
      {captureModeOptions.map((option) => {
        const Icon = option.icon;

        return (
          <button
            aria-pressed={input.mode === option.mode}
            className={`capture-mode-option${input.mode === option.mode ? " is-active" : ""}`}
            key={option.mode}
            onClick={() => input.onChange(option.mode)}
            type="button"
          >
            <Icon aria-hidden="true" size={20} />
            <span>
              <strong>{option.title}</strong>
              <small>{option.summary}</small>
            </span>
          </button>
        );
      })}
    </section>
  );
}

type SessionFlowStepStatus = "done" | "current" | "blocked";

function SessionFlowGuide(input: {
  readonly captureMode: CaptureMode;
  readonly diagnostics: RuntimeDiagnostics;
  readonly folderName: string | null;
  readonly localCorpusReady: boolean;
  readonly localCorpusSummary: LocalTextCorpusSummary | null;
}) {
  const modeContent = getCaptureModeContent(input.captureMode);
  const corpusDetail =
    input.captureMode === "training"
      ? "Corpus intégré prêt"
      : input.localCorpusReady && input.localCorpusSummary !== null
        ? `${input.localCorpusSummary.promptCount} segment${
            input.localCorpusSummary.promptCount > 1 ? "s" : ""
          } prêt${input.localCorpusSummary.promptCount > 1 ? "s" : ""}`
        : "Colle un texte ou charge un fichier";
  const exportDetail =
    input.folderName ??
    (input.diagnostics.canExportFolder
      ? "Dossier conseillé ou WAV/JSON"
      : "Téléchargement WAV/JSON");
  const steps: readonly {
    readonly detail: string;
    readonly icon: typeof Mic;
    readonly label: string;
    readonly status: SessionFlowStepStatus;
  }[] = [
    {
      detail: formatCaptureMode(input.captureMode),
      icon: modeContent.icon,
      label: "Mode",
      status: "done",
    },
    {
      detail: corpusDetail,
      icon: FileText,
      label: input.captureMode === "training" ? "Corpus" : "Texte",
      status: input.localCorpusReady ? "done" : "blocked",
    },
    {
      detail: exportDetail,
      icon: FolderOpen,
      label: "Export",
      status:
        input.folderName !== null || !input.diagnostics.canExportFolder
          ? "done"
          : "current",
    },
    {
      detail: input.diagnostics.canRecord
        ? "Silence 3 s, puis lecture"
        : input.diagnostics.primaryAction,
      icon: Mic,
      label: "Prise",
      status: input.diagnostics.canRecord ? "current" : "blocked",
    },
  ];

  return (
    <section className="session-flow-guide" aria-label="Déroulé de session">
      {steps.map((step, index) => {
        const Icon = step.icon;

        return (
          <div className={`flow-step is-${step.status}`} key={step.label}>
            <span className="flow-index">{index + 1}</span>
            <Icon aria-hidden="true" size={17} />
            <span>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </span>
          </div>
        );
      })}
    </section>
  );
}

function LocalCorpusEditor(input: {
  readonly mode: LocalCorpusMode;
  readonly onFile: (file: File) => void;
  readonly onTextChange: (text: string) => void;
  readonly sourceName: string | null;
  readonly summary: LocalTextCorpusSummary | null;
  readonly text: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modeLabel = input.mode === "dubbing" ? "Script" : "Texte master";

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

function BackingTrackPanel(input: {
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
          <p className="soft-label">Retour casque</p>
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
        <label>
          <span>Volume casque</span>
          <input
            aria-label="Volume du retour casque"
            max={1}
            min={0}
            onChange={(event) =>
              input.onVolumeChange(Number(event.target.value))
            }
            step={0.01}
            type="range"
            value={input.volume}
          />
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
        Utilise un casque fermé. La piste sert de retour, le WAV exporté reste
        une prise voix.
      </p>
    </section>
  );
}

function SystemHealthPanel(input: {
  readonly diagnostics: RuntimeDiagnostics;
  readonly onRefresh: () => void;
}) {
  const visibleChecks = input.diagnostics.checks.filter((check) =>
    [
      "microphone",
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

function SystemCheckItem(input: { readonly check: RuntimeCheck }) {
  return (
    <div className={`system-check is-${input.check.status}`}>
      <span>{input.check.label}</span>
      <strong>{formatRuntimeStatus(input.check.status)}</strong>
    </div>
  );
}

function CaptureProfileEditor(input: {
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

function PermissionScreen(input: {
  readonly diagnostics: RuntimeDiagnostics;
  readonly insight: string | null;
  readonly isSpeakingReference: boolean;
  readonly message: string;
  readonly onAllow: () => void;
  readonly onBack: () => void;
  readonly onReference: () => void;
  readonly prompt: PromptDefinition | undefined;
}) {
  return (
    <div className="director-panel">
      <div className="director-heading">
        <div className="section-icon">
          <ShieldCheck aria-hidden="true" size={28} />
        </div>
        <div>
          <p className="soft-label">Seuil de prise</p>
          <h1>La surface attend ta voix.</h1>
        </div>
      </div>
      <p aria-live="polite">{input.message}</p>
      {!input.diagnostics.canRecord && (
        <p className="coach-note danger">{input.diagnostics.primaryAction}</p>
      )}
      {input.insight !== null && <p className="coach-note">{input.insight}</p>}
      {input.prompt !== undefined && (
        <article className="prompt-direction">
          <p className="soft-label">Phrase</p>
          <blockquote>{input.prompt.text}</blockquote>
          <dl>
            <div>
              <dt>Intention</dt>
              <dd>{input.prompt.intention.label}</dd>
            </div>
            <div>
              <dt>Situation</dt>
              <dd>{input.prompt.direction.context}</dd>
            </div>
            <div>
              <dt>Rythme</dt>
              <dd>{formatPace(input.prompt.delivery.pace)}</dd>
            </div>
            <div>
              <dt>Énergie</dt>
              <dd>{formatEnergy(input.prompt.delivery.energy)}</dd>
            </div>
            <div>
              <dt>Pause</dt>
              <dd>{input.prompt.direction.pauseInstruction}</dd>
            </div>
            <div>
              <dt>À souligner</dt>
              <dd>{input.prompt.direction.emphasis.join(", ")}</dd>
            </div>
            <div>
              <dt>Évite</dt>
              <dd>{input.prompt.direction.avoid.join(", ")}</dd>
            </div>
          </dl>
        </article>
      )}
      <ul className="prep-checklist" aria-label="Avant de lancer">
        <li>
          <ShieldCheck aria-hidden="true" size={17} />
          <span>Garde trois secondes de silence pour mesurer la pièce.</span>
        </li>
        <li>
          <Mic aria-hidden="true" size={17} />
          <span>
            Reste à la même distance du micro pendant toute la phrase.
          </span>
        </li>
        <li>
          <Download aria-hidden="true" size={17} />
          <span>Vérifie les liens WAV et JSON dès que la prise est finie.</span>
        </li>
      </ul>
      <div className="stacked-actions">
        <button
          className="folder-button"
          disabled={input.prompt === undefined}
          onClick={input.onReference}
          type="button"
        >
          <Volume2 aria-hidden="true" size={19} />
          <span>
            {input.isSpeakingReference
              ? "Arrêter la référence"
              : "Écouter la référence"}
          </span>
        </button>
        <button
          className="launch-button"
          disabled={!input.diagnostics.canRecord}
          onClick={input.onAllow}
          type="button"
        >
          <Mic aria-hidden="true" size={20} />
          <span>Démarrer la prise</span>
        </button>
        <button
          className="quiet-button standalone"
          onClick={input.onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={17} />
          <span>Retour</span>
        </button>
      </div>
    </div>
  );
}

function RoomToneCalibrationScreen(input: {
  readonly audioLevel: number;
  readonly progress: number;
  readonly totalMs: number;
}) {
  const remainingMs = Math.max(
    0,
    Math.ceil(input.totalMs * (1 - input.progress)),
  );

  return (
    <div className="room-tone-screen" aria-live="polite">
      <div className="recording-topbar">
        <div className="recording-dot">Calibration salle</div>
        <div className="recording-meter" aria-label="Niveau de salle">
          <Volume2 aria-hidden="true" size={18} />
          <span>
            <i
              style={
                {
                  "--meter-scale": formatMeterScale(input.audioLevel),
                } as CSSProperties
              }
            />
          </span>
        </div>
      </div>
      <div className="room-tone-core" aria-hidden="true">
        <span style={{ transform: `scale(${1 + input.audioLevel * 0.36})` }} />
      </div>
      <div className="room-tone-copy">
        <p className="soft-label">
          {formatDurationSeconds(remainingMs)} restantes
        </p>
        <h1>Silence de pièce.</h1>
        <p>Ne parle pas. Le niveau de base est mesuré avant la phrase.</p>
      </div>
      <dl className="room-tone-readout">
        <div>
          <dt>Niveau actuel</dt>
          <dd>{formatPercent(input.audioLevel * 100)}</dd>
        </div>
        <div>
          <dt>Durée</dt>
          <dd>{formatDurationSeconds(input.totalMs)}</dd>
        </div>
      </dl>
      <div
        className="read-progress"
        aria-label="Progression de la calibration"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(input.progress * 100)}
        role="progressbar"
      >
        <span style={{ width: formatPercent(input.progress * 100) }} />
      </div>
    </div>
  );
}

function KaraokeScreen(input: {
  readonly activeWordIndex: number;
  readonly audioLevel: number;
  readonly currentPromptIndex: number;
  readonly isFinalizing: boolean;
  readonly language: LanguageCode;
  readonly onStop: () => void;
  readonly prompt: PromptDefinition | undefined;
  readonly readingGuideMode: ReadingGuideMode;
  readonly recognizedTranscript: string;
  readonly roomTone: RoomToneCalibration | null;
  readonly totalPrompts: number;
  readonly words: readonly string[];
}) {
  const progress =
    input.words.length === 0
      ? 0
      : ((input.activeWordIndex + 1) / input.words.length) * 100;
  const guideLabel =
    input.readingGuideMode === "speech-recognition"
      ? "Suivi des mots"
      : "Suivi vocal";
  const alignmentPreview = useMemo(
    () =>
      input.prompt === undefined
        ? null
        : alignPromptToPhonemes({
            durationMs: Math.round(
              (input.prompt.qa.minDurationMs + input.prompt.qa.maxDurationMs) /
                2,
            ),
            language: input.language,
            text: input.prompt.spokenText ?? input.prompt.text,
          }),
    [input.language, input.prompt],
  );
  const activeWordAlignment =
    alignmentPreview?.words[input.activeWordIndex] ?? null;

  return (
    <div className="karaoke-screen" aria-busy={input.isFinalizing}>
      <div className="recording-topbar">
        <div className="recording-dot" aria-live="polite">
          {input.isFinalizing ? "Finalisation" : "REC"} · Phrase{" "}
          {input.currentPromptIndex + 1}/{Math.max(input.totalPrompts, 1)}
        </div>
        <div className="recording-meter" aria-label="Niveau micro">
          <Volume2 aria-hidden="true" size={18} />
          <span>
            <i
              style={
                {
                  "--meter-scale": formatMeterScale(input.audioLevel),
                } as CSSProperties
              }
            />
          </span>
        </div>
        <div className="recording-cue">
          <Mic aria-hidden="true" size={18} />
          <span>{guideLabel}</span>
        </div>
        {input.roomTone !== null && (
          <div className="recording-cue">
            <ShieldCheck aria-hidden="true" size={18} />
            <span>Salle {input.roomTone.noiseFloorDbfs} dBFS</span>
          </div>
        )}
        <button
          className="stop-button"
          disabled={input.isFinalizing}
          onClick={input.onStop}
          type="button"
        >
          <Square aria-hidden="true" size={16} />
          <span>{input.isFinalizing ? "Finalisation..." : "Stop"}</span>
        </button>
      </div>
      {input.prompt !== undefined && (
        <div className="recording-cue">
          <SlidersHorizontal aria-hidden="true" size={18} />
          <span>{input.prompt.delivery.tone}</span>
        </div>
      )}
      <KaraokeText
        activeWordIndex={input.activeWordIndex}
        words={input.words}
      />
      {activeWordAlignment !== null && (
        <div className="phoneme-ribbon" aria-label="Phonèmes du mot actif">
          {activeWordAlignment.phonemes.map((phoneme, index) => (
            <span key={`${phoneme.phoneme}-${index}`}>{phoneme.phoneme}</span>
          ))}
        </div>
      )}
      <p className="recording-assist" aria-live="polite">
        {input.isFinalizing
          ? "Ne ferme pas l'onglet. Le WAV et les métadonnées sont en préparation."
          : "Lis naturellement. La prise se ferme automatiquement à la fin de la phrase."}
      </p>
      {input.readingGuideMode === "speech-recognition" &&
        input.recognizedTranscript.trim().length > 0 && (
          <p className="speech-follow-line">
            {createTranscriptPreview(input.recognizedTranscript)}
          </p>
        )}
      <div
        className="read-progress"
        aria-label="Progression de lecture"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(progress)}
        role="progressbar"
      >
        <span style={{ width: formatPercent(progress) }} />
      </div>
    </div>
  );
}

const KaraokeText = memo(function KaraokeText(input: {
  readonly activeWordIndex: number;
  readonly words: readonly string[];
}) {
  const lineRef = useRef<HTMLParagraphElement | null>(null);
  const charRefs = useRef<readonly HTMLElement[]>([]);
  const waveCenterRef = useRef(0);
  const waveTargetRef = useRef(0);
  const visualLines = useMemo(
    () => createKaraokeVisualLines(input.words),
    [input.words],
  );
  const wordStartIndexes = useMemo(() => {
    let nextIndex = 0;

    return input.words.map((word) => {
      const startIndex = nextIndex;
      nextIndex += word.length + 1;

      return startIndex;
    });
  }, [input.words]);

  useEffect(() => {
    const activeStart = wordStartIndexes[input.activeWordIndex] ?? 0;
    const activeWordLength = Math.max(
      1,
      input.words[input.activeWordIndex]?.length ?? 1,
    );

    waveTargetRef.current = activeStart + activeWordLength * 0.5;
  }, [input.activeWordIndex, input.words, wordStartIndexes]);

  useEffect(() => {
    const line = lineRef.current;

    if (line === null || input.words.length === 0) {
      return;
    }

    const currentLine = line;
    const chars = Array.from(
      currentLine.querySelectorAll<HTMLElement>(".karaoke-char"),
    );
    const initialStart = wordStartIndexes[input.activeWordIndex] ?? 0;
    const initialWordLength = Math.max(
      1,
      input.words[input.activeWordIndex]?.length ?? 1,
    );
    const initialCenter = initialStart + initialWordLength * 0.5;

    charRefs.current = chars;
    waveCenterRef.current = initialCenter;
    waveTargetRef.current = initialCenter;

    let frameId = 0;

    function animate() {
      const app = currentLine.closest<HTMLElement>(".simple-app");
      const energy =
        Number.parseFloat(
          getComputedStyle(app ?? document.documentElement).getPropertyValue(
            "--audio-level",
          ),
        ) || 0;
      const target = waveTargetRef.current;
      const current =
        waveCenterRef.current + (target - waveCenterRef.current) * 0.14;
      const sigma = 5.8 + energy * 1.1;

      waveCenterRef.current = current;

      for (const char of charRefs.current) {
        const index = Number(char.dataset.charIndex ?? 0);
        const distance = Math.abs(index - current);
        const wave = Math.exp(-(distance * distance) / (2 * sigma * sigma));
        const trail =
          index < current ? Math.max(0, 1 - distance / 26) * 0.14 : 0;
        const motion = Math.min(1, 0.38 + wave * 0.28 + trail);
        const detail = Math.min(
          1,
          0.34 + wave * 0.24 + trail * 0.24 + energy * 0.06,
        );

        char.style.setProperty("--motion-wave", motion.toFixed(3));
        char.style.setProperty("--detail-wave", detail.toFixed(3));
      }

      frameId = window.requestAnimationFrame(animate);
    }

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
      charRefs.current = [];
    };
  }, [input.words, wordStartIndexes]);

  return (
    <p
      className="karaoke-line"
      aria-label={input.words.join(" ")}
      ref={lineRef}
    >
      {visualLines.map((line, lineIndex) => (
        <span className="karaoke-visual-line" key={`line-${lineIndex}`}>
          {line.map(({ word, wordIndex }) => (
            <span
              className="karaoke-word"
              key={`${word}-${wordIndex}`}
              style={
                {
                  "--word-delay": `${wordIndex * 14}ms`,
                } as CSSProperties
              }
            >
              {Array.from(word).map((character, letterIndex) => {
                const currentCharacterIndex =
                  (wordStartIndexes[wordIndex] ?? 0) + letterIndex;

                return (
                  <span
                    aria-hidden="true"
                    className="karaoke-char"
                    data-char-index={currentCharacterIndex}
                    key={`${character}-${letterIndex}`}
                  >
                    {character}
                  </span>
                );
              })}
            </span>
          ))}
        </span>
      ))}
    </p>
  );
});

type KaraokeVisualWord = {
  readonly word: string;
  readonly wordIndex: number;
};

function createKaraokeVisualLines(
  words: readonly string[],
): readonly (readonly KaraokeVisualWord[])[] {
  const lines: KaraokeVisualWord[][] = [];
  let currentLine: KaraokeVisualWord[] = [];
  let currentLength = 0;
  const maxLineLength = 28;
  const softLineLength = 18;

  words.forEach((word, wordIndex) => {
    const nextLength =
      currentLength === 0 ? word.length : currentLength + 1 + word.length;
    const previousWord = currentLine.at(-1)?.word ?? "";
    const shouldBreakAfterPunctuation =
      currentLine.length > 0 &&
      /[.:;!?]$/.test(previousWord) &&
      currentLength >= 12;
    const shouldBreakBeforeWord =
      currentLine.length > 0 && nextLength > maxLineLength;
    const shouldBreakForBalance =
      currentLine.length >= 3 &&
      currentLength >= softLineLength &&
      nextLength > maxLineLength - 5;

    if (
      shouldBreakAfterPunctuation ||
      shouldBreakBeforeWord ||
      shouldBreakForBalance
    ) {
      lines.push(currentLine);
      currentLine = [];
      currentLength = 0;
    }

    currentLine.push({ word, wordIndex });
    currentLength =
      currentLength === 0 ? word.length : currentLength + 1 + word.length;
  });

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

function ListeningReviewSurface(input: {
  readonly audioUrl: string | null;
  readonly fileName: string | null;
  readonly onEnergyChange: (level: number) => void;
  readonly onProgressChange: (progress: number) => void;
  readonly take: RecordedTake | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onEnergyChangeRef = useRef(input.onEnergyChange);
  const onProgressChangeRef = useRef(input.onProgressChange);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    Math.max(0, (input.take?.durationMs ?? 0) / 1000),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(1);
  const wordTimings = useMemo(
    () => createReviewWordTimings(input.take),
    [input.take],
  );
  const waveformBars = useMemo(
    () =>
      Array.from({ length: 92 }, (_, index) => {
        const primary = Math.abs(Math.sin(index * 0.43));
        const secondary = Math.abs(Math.sin(index * 0.17 + 1.4));
        const center = 1 - Math.abs(index / 91 - 0.5) * 1.24;

        return Math.max(
          18,
          (0.3 + primary * 0.48 + secondary * 0.22) * 100 * center,
        );
      }),
    [input.take?.id],
  );
  const durationSeconds = Math.max(
    duration,
    (input.take?.durationMs ?? 0) / 1000,
  );
  const playbackProgress =
    durationSeconds <= 0
      ? 0
      : Math.max(0, Math.min(1, currentTime / durationSeconds));
  const loopStartTime = loopStart * durationSeconds;
  const loopEndTime = loopEnd * durationSeconds;
  const activeWordIndex = findActiveReviewWordIndex(
    wordTimings,
    currentTime * 1000,
  );

  useEffect(() => {
    onEnergyChangeRef.current = input.onEnergyChange;
    onProgressChangeRef.current = input.onProgressChange;
  }, [input.onEnergyChange, input.onProgressChange]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(Math.max(0, (input.take?.durationMs ?? 0) / 1000));
    setIsPlaying(false);
    setLoopEnabled(false);
    setLoopStart(0);
    setLoopEnd(1);
    onProgressChangeRef.current(0);
    onEnergyChangeRef.current(0);
  }, [input.audioUrl, input.take]);

  useEffect(() => {
    if (!isPlaying) {
      onEnergyChangeRef.current(0.04);
      return;
    }

    let frameId = 0;

    function animatePlaybackEnergy() {
      const audio = audioRef.current;
      const progress =
        audio === null || durationSeconds <= 0
          ? playbackProgress
          : audio.currentTime / durationSeconds;
      const wordPulse = Math.abs(
        Math.sin(progress * Math.PI * Math.max(2, wordTimings.length)),
      );
      const phrasePulse = Math.abs(Math.sin(progress * Math.PI * 2.2));

      onEnergyChangeRef.current(
        Math.min(1, 0.08 + wordPulse * 0.34 + phrasePulse * 0.18),
      );
      frameId = window.requestAnimationFrame(animatePlaybackEnergy);
    }

    frameId = window.requestAnimationFrame(animatePlaybackEnergy);

    return () => window.cancelAnimationFrame(frameId);
  }, [durationSeconds, isPlaying, playbackProgress, wordTimings.length]);

  function updateTime(nextTime: number) {
    const boundedTime = Math.max(0, Math.min(durationSeconds, nextTime));

    setCurrentTime(boundedTime);
    onProgressChangeRef.current(
      durationSeconds <= 0
        ? 0
        : Math.max(0, Math.min(1, boundedTime / durationSeconds)),
    );
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;
    const nextDuration =
      audio === null || !Number.isFinite(audio.duration)
        ? Math.max(0, (input.take?.durationMs ?? 0) / 1000)
        : audio.duration;

    setDuration(nextDuration);
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;

    if (audio === null) {
      return;
    }

    let nextTime = audio.currentTime;

    if (
      loopEnabled &&
      durationSeconds > 0 &&
      loopEndTime - loopStartTime > 0.24 &&
      nextTime >= loopEndTime
    ) {
      audio.currentTime = loopStartTime;
      nextTime = loopStartTime;
    }

    updateTime(nextTime);
  }

  function seekToProgress(nextProgress: number) {
    const audio = audioRef.current;
    const nextTime = Math.max(0, Math.min(1, nextProgress)) * durationSeconds;

    if (audio !== null) {
      audio.currentTime = nextTime;
    }

    updateTime(nextTime);
  }

  function seekToWord(index: number) {
    const timing = wordTimings[index];

    if (timing === undefined) {
      return;
    }

    seekToProgress(
      durationSeconds <= 0 ? 0 : timing.startMs / 1000 / durationSeconds,
    );
  }

  function handleWaveformSeek(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();

    if (bounds.width === 0) {
      return;
    }

    seekToProgress((event.clientX - bounds.left) / bounds.width);
  }

  function handleWaveformKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.1 : 0.025;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekToProgress(playbackProgress - step);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      seekToProgress(playbackProgress + step);
    }

    if (event.key === "Home") {
      event.preventDefault();
      seekToProgress(0);
    }

    if (event.key === "End") {
      event.preventDefault();
      seekToProgress(1);
    }
  }

  async function togglePlayback() {
    const audio = audioRef.current;

    if (audio === null) {
      return;
    }

    if (isPlaying) {
      audio.pause();
      return;
    }

    if (loopEnabled && currentTime >= loopEndTime) {
      audio.currentTime = loopStartTime;
    }

    await audio.play().catch(() => undefined);
  }

  function replay() {
    const audio = audioRef.current;
    const startTime = loopEnabled ? loopStartTime : 0;

    if (audio !== null) {
      audio.currentTime = startTime;
      void audio.play().catch(() => undefined);
    }

    updateTime(startTime);
  }

  if (input.take === null) {
    return (
      <section className="listening-review" aria-label="Écoute de la prise">
        <p className="soft-label">Écoute</p>
        <p className="empty-export-state">
          La prise apparaîtra ici quand le fichier audio sera disponible.
        </p>
      </section>
    );
  }

  return (
    <section className="listening-review" aria-label="Écoute de la prise">
      {input.audioUrl !== null && (
        <audio
          onEnded={() => {
            setIsPlaying(false);
            onEnergyChangeRef.current(0);
          }}
          onLoadedMetadata={handleLoadedMetadata}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onTimeUpdate={handleTimeUpdate}
          ref={audioRef}
          src={input.audioUrl}
        />
      )}
      <div className="listening-header">
        <div>
          <p className="soft-label">Écoute</p>
          <h2>{input.fileName ?? input.take.fileName}</h2>
        </div>
        <span>
          {formatPlaybackTime(currentTime)} /{" "}
          {formatPlaybackTime(durationSeconds)}
        </span>
      </div>
      <div
        aria-label="Surface de lecture de la prise"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(playbackProgress * 100)}
        className="playback-waveform"
        onKeyDown={handleWaveformKeyboard}
        onPointerDown={handleWaveformSeek}
        role="slider"
        tabIndex={0}
      >
        <span
          aria-hidden="true"
          className="loop-region"
          style={{
            left: `${loopStart * 100}%`,
            width: `${Math.max(0, loopEnd - loopStart) * 100}%`,
          }}
        />
        {waveformBars.map((height, index) => (
          <i
            aria-hidden="true"
            className={
              index / Math.max(1, waveformBars.length - 1) <= playbackProgress
                ? "is-played"
                : ""
            }
            key={index}
            style={{ "--bar-height": `${height}%` } as CSSProperties}
          />
        ))}
        <span
          aria-hidden="true"
          className="review-playhead"
          style={{ left: `${playbackProgress * 100}%` }}
        />
      </div>
      <div className="playback-controls">
        <button
          className="launch-button compact"
          disabled={input.audioUrl === null}
          onClick={() => void togglePlayback()}
          type="button"
        >
          {isPlaying ? (
            <Pause aria-hidden="true" size={18} />
          ) : (
            <Play aria-hidden="true" size={18} />
          )}
          <span>{isPlaying ? "Pause" : "Replay"}</span>
        </button>
        <button
          className="folder-button compact"
          disabled={input.audioUrl === null}
          onClick={replay}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={17} />
          <span>Reprendre</span>
        </button>
        <label className="inline-toggle loop-toggle">
          <input
            checked={loopEnabled}
            onChange={(event) => setLoopEnabled(event.target.checked)}
            type="checkbox"
          />
          <span>Boucle</span>
        </label>
      </div>
      <div className="loop-editor" aria-label="Section de boucle">
        <label>
          <span>Début</span>
          <input
            max={Math.max(0, loopEnd - 0.04)}
            min={0}
            onChange={(event) =>
              setLoopStart(Math.min(Number(event.target.value), loopEnd - 0.04))
            }
            step={0.01}
            type="range"
            value={loopStart}
          />
        </label>
        <label>
          <span>Fin</span>
          <input
            max={1}
            min={Math.min(1, loopStart + 0.04)}
            onChange={(event) =>
              setLoopEnd(Math.max(Number(event.target.value), loopStart + 0.04))
            }
            step={0.01}
            type="range"
            value={loopEnd}
          />
        </label>
      </div>
      <div className="review-transcript" aria-label="Transcript synchronisé">
        {wordTimings.map((timing, index) => (
          <button
            className={[
              "review-word",
              index === activeWordIndex ? "is-active" : "",
              index < activeWordIndex ? "is-spoken" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={`${timing.word}-${index}`}
            onClick={() => seekToWord(index)}
            type="button"
          >
            {timing.word}
          </button>
        ))}
      </div>
    </section>
  );
}

function createReviewWordTimings(take: RecordedTake | null): readonly {
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
}[] {
  if (take === null) {
    return [];
  }

  if (take.timing.words.length > 0) {
    return take.timing.words;
  }

  const words = take.transcript.spokenText.split(/\s+/).filter(Boolean);
  const durationMs = Math.max(1, take.durationMs);

  return words.map((word, index) => ({
    word,
    startMs: Math.round((durationMs / Math.max(1, words.length)) * index),
    endMs: Math.round((durationMs / Math.max(1, words.length)) * (index + 1)),
  }));
}

function findActiveReviewWordIndex(
  wordTimings: readonly { readonly startMs: number; readonly endMs: number }[],
  currentTimeMs: number,
): number {
  if (wordTimings.length === 0) {
    return -1;
  }

  const exactIndex = wordTimings.findIndex(
    (timing) =>
      currentTimeMs >= timing.startMs && currentTimeMs <= timing.endMs,
  );

  if (exactIndex >= 0) {
    return exactIndex;
  }

  const nextIndex = wordTimings.findIndex(
    (timing) => currentTimeMs < timing.startMs,
  );

  return nextIndex === -1 ? wordTimings.length - 1 : Math.max(0, nextIndex - 1);
}

function formatPlaybackTime(seconds: number): string {
  const boundedSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(boundedSeconds / 60);
  const remainingSeconds = Math.floor(boundedSeconds % 60);

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function DoneScreen(input: {
  readonly downloadUrl: string | null;
  readonly fileName: string | null;
  readonly hasNextPrompt: boolean;
  readonly location: string | null;
  readonly metadataDownloadUrl: string | null;
  readonly message: string;
  readonly nextRecommendation: string | null;
  readonly onAgain: () => void;
  readonly onHome: () => void;
  readonly onNext: () => void;
  readonly onPlaybackEnergyChange: (level: number) => void;
  readonly onPlaybackProgressChange: (progress: number) => void;
  readonly onRetake: () => void;
  readonly progressLabel: string | null;
  readonly take: RecordedTake | null;
}) {
  const isKeeper = input.take?.quality.verdict === "pass";

  return (
    <div className="focus-card" aria-live="polite">
      <div className="result-mark is-listening">
        <Volume2 aria-hidden="true" size={28} />
      </div>
      <div className="result-heading">
        {input.progressLabel !== null && (
          <p className="soft-label">{input.progressLabel}</p>
        )}
        <h1>Écoute la prise.</h1>
      </div>
      <p>{input.message}</p>
      <ListeningReviewSurface
        audioUrl={input.downloadUrl}
        fileName={input.fileName}
        onEnergyChange={input.onPlaybackEnergyChange}
        onProgressChange={input.onPlaybackProgressChange}
        take={input.take}
      />
      {input.take !== null && (
        <details className="take-score progressive-review">
          <summary>
            <strong>Qualité et détails de prise</strong>
            <span>{isKeeper ? "Utilisable" : "À reprendre"}</span>
          </summary>
          <span>
            {input.take.quality.verdict === "pass"
              ? "Utilisable"
              : "À reprendre"}
          </span>
          <p>{input.take.review.directorNotes}</p>
          <p className="coach-note">
            {createTakeCoachNote(input.take, input.nextRecommendation)}
          </p>
          <dl>
            <div>
              <dt>Pic</dt>
              <dd>{input.take.quality.technical.peakDbfs} dBFS</dd>
            </div>
            <div>
              <dt>LUFS</dt>
              <dd>{input.take.quality.technical.integratedLufs}</dd>
            </div>
            <div>
              <dt>SNR</dt>
              <dd>{input.take.quality.technical.snrDb} dB</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>
                {input.take.quality.technical.sampleRateHz / 1000} kHz /{" "}
                {input.take.quality.technical.bitDepth}-bit
              </dd>
            </div>
            <div>
              <dt>Transcript</dt>
              <dd>
                {formatPercent(
                  input.take.quality.performance.transcriptMatch * 100,
                )}
              </dd>
            </div>
            <div>
              <dt>Alignement</dt>
              <dd>
                {formatPercent(
                  (input.take.quality.performance.alignmentConfidence ?? 0) *
                    100,
                )}
              </dd>
            </div>
            <div>
              <dt>Phonèmes</dt>
              <dd>
                {input.take.quality.performance.phonemeInventoryCount ?? 0}
              </dd>
            </div>
            <div>
              <dt>Liens mot/phonème</dt>
              <dd>
                {formatPercent(
                  (input.take.quality.performance.wordPhonemeLinkRate ?? 0) *
                    100,
                )}
              </dd>
            </div>
          </dl>
          <div>
            {input.take.quality.gates.map((gate) => (
              <small className={`gate-${gate.status}`} key={gate.id}>
                {gate.label}: {gate.status}
              </small>
            ))}
          </div>
        </details>
      )}
      {(input.location !== null || input.fileName !== null) && (
        <div className="file-receipt">
          <Database aria-hidden="true" size={18} />
          <div>
            {input.location !== null && <strong>{input.location}</strong>}
            {input.fileName !== null && <span>{input.fileName}</span>}
          </div>
        </div>
      )}
      <div className="result-action-grid">
        <section className="next-step-panel" aria-label="Prochaine action">
          <div>
            <p className="soft-label">Prochaine action</p>
            <p>
              {isKeeper
                ? input.hasNextPrompt
                  ? "Continue avec la phrase suivante tant que la posture et le niveau sont stables."
                  : "La session est prête à être clôturée ou relancée."
                : "Refais cette phrase avant de continuer la collecte."}
            </p>
          </div>
          <div className="stacked-actions">
            {isKeeper && input.hasNextPrompt && (
              <button
                className="launch-button"
                onClick={input.onNext}
                type="button"
              >
                <StepForward aria-hidden="true" size={19} />
                <span>Phrase suivante</span>
              </button>
            )}
            {isKeeper && !input.hasNextPrompt && (
              <button
                className="launch-button"
                onClick={input.onAgain}
                type="button"
              >
                <Play aria-hidden="true" size={19} />
                <span>Nouvelle session</span>
              </button>
            )}
            {!isKeeper && (
              <button
                className="launch-button"
                onClick={input.onRetake}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={19} />
                <span>Refaire cette prise</span>
              </button>
            )}
            {isKeeper && (
              <button
                className="folder-button"
                onClick={input.onRetake}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={19} />
                <span>Refaire cette prise</span>
              </button>
            )}
            {input.hasNextPrompt && (
              <button
                className="folder-button"
                onClick={input.onAgain}
                type="button"
              >
                <Play aria-hidden="true" size={19} />
                <span>Nouvelle session</span>
              </button>
            )}
            {!isKeeper && (
              <button
                className="folder-button"
                onClick={input.onAgain}
                type="button"
              >
                <Play aria-hidden="true" size={19} />
                <span>Nouvelle session</span>
              </button>
            )}
            <button
              className="quiet-button standalone"
              onClick={input.onHome}
              type="button"
            >
              <Home aria-hidden="true" size={17} />
              <span>Accueil</span>
            </button>
          </div>
        </section>

        <section className="export-panel" aria-label="Exports de la prise">
          <div>
            <p className="soft-label">Exports</p>
            <p>Conserve le WAV et le JSON ensemble pour retrouver la prise.</p>
          </div>
          <div className="export-actions">
            {input.downloadUrl !== null && input.fileName !== null && (
              <a
                className="download-action"
                download={input.fileName}
                href={input.downloadUrl}
              >
                <Download aria-hidden="true" size={18} />
                <span>Télécharger le WAV</span>
              </a>
            )}
            {input.metadataDownloadUrl !== null && (
              <a
                className="folder-button"
                download="voice.capture_session.json"
                href={input.metadataDownloadUrl}
              >
                <Download aria-hidden="true" size={18} />
                <span>Télécharger le JSON</span>
              </a>
            )}
            {input.downloadUrl === null &&
              input.metadataDownloadUrl === null && (
                <p className="empty-export-state">
                  Les liens de téléchargement apparaissent ici quand le
                  navigateur ne peut pas écrire directement dans le dossier.
                </p>
              )}
          </div>
        </section>
      </div>
    </div>
  );
}

function TechnicalPage(input: {
  readonly captureMode: CaptureMode;
  readonly corpusId: CorpusManifest["id"] | null;
  readonly corpusVersion: CorpusManifest["version"] | null;
  readonly coverage: CoverageSummary | null;
  readonly coveragePercent: number;
  readonly datasetExportState: DatasetExportState;
  readonly diagnostics: RuntimeDiagnostics;
  readonly folderName: string | null;
  readonly onBack: () => void;
  readonly onDownloadDataset: () => void;
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
      {input.coverage !== null && (
        <div className="dataset-score">
          <h2>Qualité vocale</h2>
          <div className="score-grid">
            <Score label="Audio" value={input.coverage.technicalQuality} />
            <Score label="Texte" value={input.coverage.transcriptAccuracy} />
            <Score label="Intentions" value={input.coverage.intentCoverage} />
            <Score label="Rythme" value={input.coverage.prosodyDiversity} />
            <Score label="Sons" value={input.coverage.phoneticCoverage} />
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
            {input.datasetExportState.keeperCount} prise(s) gardée(s)
            incluse(s).
            {input.datasetExportState.missingAudioFiles.length > 0
              ? ` ${input.datasetExportState.missingAudioFiles.length} fichier(s) audio introuvable(s) dans le cache navigateur.`
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

function Gap(input: {
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
