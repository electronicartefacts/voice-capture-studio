export type RuntimeStatus = "ready" | "limited" | "blocked";

export type RuntimeCheck = {
  readonly id:
    | "secure-context"
    | "microphone"
    | "input-devices"
    | "audio-engine"
    | "workspace-storage"
    | "recording-storage"
    | "folder-export"
    | "downloads"
    | "screen-lock"
    | "speech-recognition"
    | "speech-synthesis"
    | "background-processing"
    | "hardware-rendering"
    | "motion-preference";
  readonly label: string;
  readonly status: RuntimeStatus;
  readonly detail: string;
  readonly action: string;
};

export type RuntimeDiagnostics = {
  readonly canRecord: boolean;
  readonly canPersistWorkspace: boolean;
  readonly canPersistRecordings: boolean;
  readonly canExportFolder: boolean;
  readonly canDownloadFallback: boolean;
  readonly recordingInputCount: number | null;
  readonly supportsLocalSpeechRecognition: boolean;
  readonly supportsSpeechSynthesis: boolean;
  readonly supportsBackgroundProcessing: boolean;
  readonly supportsHardwareRendering: boolean;
  readonly primaryAction: string;
  readonly primaryRisk: string | null;
  readonly status: RuntimeStatus;
  readonly storageEstimate: StorageEstimate | null;
  readonly checks: readonly RuntimeCheck[];
};

type StorageEstimate = {
  readonly quotaMb: number | null;
  readonly usageMb: number | null;
};

type WindowWithAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
    showDirectoryPicker?: unknown;
  };

type NavigatorWithWakeLock = Navigator & {
  readonly wakeLock?: unknown;
};

export function createRuntimeDiagnosticsSnapshot(): RuntimeDiagnostics {
  return buildDiagnostics({
    microphonePermission: null,
    recordingInputCount: null,
    storageEstimate: null,
  });
}

export async function inspectRuntime(): Promise<RuntimeDiagnostics> {
  const [microphonePermission, recordingInputCount, storageEstimate] =
    await Promise.all([
      inspectMicrophonePermission(),
      inspectAudioInputCount(),
      inspectStorageEstimate(),
    ]);

  return buildDiagnostics({
    microphonePermission,
    recordingInputCount,
    storageEstimate,
  });
}

export function getCaptureBlocker(
  diagnostics: RuntimeDiagnostics,
): string | null {
  const blockedCheck = diagnostics.checks.find(
    (check) =>
      check.status === "blocked" &&
      ["secure-context", "microphone", "audio-engine"].includes(check.id),
  );

  if (blockedCheck === undefined) {
    return null;
  }

  return `${blockedCheck.detail} ${blockedCheck.action}`;
}

export function createMicrophoneErrorMessage(error: unknown): string {
  if (!(error instanceof DOMException)) {
    return "Micro refusé ou indisponible. Vérifie l'entrée audio puis réessaie.";
  }

  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "Accès micro bloqué. Autorise le micro pour ce site, puis relance la prise.";
  }

  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "Aucun micro détecté. Branche une entrée audio ou change de navigateur.";
  }

  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "Le micro est déjà utilisé par une autre app. Ferme l'autre capture puis réessaie.";
  }

  if (error.name === "OverconstrainedError") {
    return "Le navigateur refuse cette configuration audio. Réessaie avec le micro par défaut.";
  }

  return "Micro refusé ou indisponible. Vérifie l'entrée audio puis réessaie.";
}

function buildDiagnostics(input: {
  readonly microphonePermission: PermissionState | null;
  readonly recordingInputCount: number | null;
  readonly storageEstimate: StorageEstimate | null;
}): RuntimeDiagnostics {
  const secureContext = window.isSecureContext || isLocalDevelopmentOrigin();
  const microphoneApiAvailable =
    navigator.mediaDevices?.getUserMedia !== undefined;
  const audioEngineAvailable =
    window.AudioContext !== undefined ||
    (window as WindowWithAudioContext).webkitAudioContext !== undefined;
  const workspaceStorage = canUseLocalStorage();
  const recordingStorage = canUseIndexedDb();
  const folderExport =
    (window as WindowWithAudioContext).showDirectoryPicker !== undefined;
  const downloadFallback = canUseDownloadFallback();
  const screenLock =
    (navigator as NavigatorWithWakeLock).wakeLock !== undefined;
  const speechRecognition =
    "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
  const speechSynthesis = "speechSynthesis" in window;
  const backgroundProcessing = "Worker" in window;
  const hardwareRendering = "gpu" in navigator || canCreateWebGlContext();
  const reducedMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const microphoneBlockedByPermission = input.microphonePermission === "denied";
  const canRecord =
    secureContext &&
    microphoneApiAvailable &&
    audioEngineAvailable &&
    !microphoneBlockedByPermission;
  const canPersistWorkspace = workspaceStorage;
  const canPersistRecordings =
    recordingStorage || folderExport || downloadFallback;
  const checks: RuntimeCheck[] = [
    {
      id: "secure-context",
      label: "Contexte sécurisé",
      status: secureContext ? "ready" : "blocked",
      detail: secureContext
        ? "La page peut accéder aux APIs audio du navigateur."
        : "Le micro est bloqué hors HTTPS ou localhost.",
      action: secureContext
        ? "Aucune action requise."
        : "Ouvre l'app en HTTPS ou sur localhost.",
    },
    {
      id: "microphone",
      label: "Micro",
      status:
        !microphoneApiAvailable || microphoneBlockedByPermission
          ? "blocked"
          : "ready",
      detail: microphoneBlockedByPermission
        ? "Le navigateur a refusé le micro pour ce site."
        : microphoneApiAvailable
          ? "Capture micro disponible."
          : "Ce navigateur ne fournit pas getUserMedia.",
      action: microphoneBlockedByPermission
        ? "Change la permission du site."
        : microphoneApiAvailable
          ? "Autorise le micro au lancement."
          : "Utilise Chrome, Edge, Safari récent ou Firefox récent.",
    },
    {
      id: "input-devices",
      label: "Entrées audio",
      status: getInputDeviceStatus({
        microphoneApiAvailable,
        recordingInputCount: input.recordingInputCount,
      }),
      detail: describeAudioInputs(input.recordingInputCount),
      action:
        input.recordingInputCount === 0
          ? "Branche ou sélectionne un microphone, puis vérifie à nouveau."
          : "Le navigateur utilisera l'entrée choisie par défaut.",
    },
    {
      id: "audio-engine",
      label: "Audio WAV",
      status: audioEngineAvailable ? "ready" : "blocked",
      detail: audioEngineAvailable
        ? "Encodage PCM WAV disponible."
        : "AudioContext est absent.",
      action: audioEngineAvailable
        ? "La prise sera exportée en WAV local."
        : "Change de navigateur ou de WebView.",
    },
    {
      id: "workspace-storage",
      label: "Progression locale",
      status: workspaceStorage ? "ready" : "limited",
      detail: workspaceStorage
        ? "Préférences et progression conservées sur cet appareil."
        : "Stockage navigateur bloqué; l'onglet garde une session temporaire.",
      action: workspaceStorage
        ? "Aucune action requise."
        : "Télécharge les exports avant de fermer l'onglet.",
    },
    {
      id: "recording-storage",
      label: "Cache audio",
      status: recordingStorage ? "ready" : "limited",
      detail: recordingStorage
        ? formatStorageEstimate(input.storageEstimate)
        : "IndexedDB indisponible; l'app bascule sur dossier ou téléchargement.",
      action: recordingStorage
        ? "Les derniers WAV restent accessibles dans Qualité."
        : "Télécharge chaque prise dès qu'elle est finalisée.",
    },
    {
      id: "folder-export",
      label: "Dossier local",
      status: folderExport ? "ready" : "limited",
      detail: folderExport
        ? "Export direct vers un dossier supporté."
        : "Le sélecteur de dossier n'est pas supporté ici.",
      action: folderExport
        ? "Choisis un dossier pour enregistrer les exports."
        : "Utilise les téléchargements WAV/JSON.",
    },
    {
      id: "downloads",
      label: "Téléchargements",
      status: downloadFallback ? "ready" : "limited",
      detail: downloadFallback
        ? "Téléchargement WAV/JSON disponible."
        : "Téléchargements automatiques limités.",
      action: downloadFallback
        ? "Garde les boutons WAV et JSON disponibles."
        : "Utilise un navigateur complet si l'export échoue.",
    },
    {
      id: "screen-lock",
      label: "Écran actif",
      status: screenLock ? "ready" : "limited",
      detail: screenLock
        ? "L'app peut demander à garder l'écran allumé pendant la prise."
        : "Wake Lock absent; certains mobiles peuvent verrouiller l'écran.",
      action: screenLock
        ? "La prise demandera le verrouillage écran si possible."
        : "Désactive le verrouillage automatique pendant une session longue.",
    },
    {
      id: "speech-recognition",
      label: "Guidage de transcription",
      status: speechRecognition ? "ready" : "limited",
      detail: speechRecognition
        ? "Guidage de transcription disponible via le moteur du navigateur."
        : "Le guidage de transcription n'est pas exposé par ce navigateur.",
      action: speechRecognition
        ? "Cette aide reste facultative; l'analyse Whisper reste exécutée localement après la prise."
        : "La capture, l'analyse et les exports restent disponibles.",
    },
    {
      id: "speech-synthesis",
      label: "Référence vocale",
      status: speechSynthesis ? "ready" : "limited",
      detail: speechSynthesis
        ? "Lecture de référence disponible dans le navigateur."
        : "La lecture de référence n'est pas disponible ici.",
      action: speechSynthesis
        ? "Utilise-la uniquement comme repère de lecture."
        : "Lis directement la direction de prise affichée.",
    },
    {
      id: "background-processing",
      label: "Traitements en arrière-plan",
      status: backgroundProcessing ? "ready" : "limited",
      detail: backgroundProcessing
        ? "Le navigateur peut déléguer les calculs compatibles hors de l'interface."
        : "Les traitements restent sur le fil principal de cette session.",
      action: backgroundProcessing
        ? "L'interface privilégie la réactivité pendant la prise."
        : "Les fonctions essentielles restent disponibles.",
    },
    {
      id: "hardware-rendering",
      label: "Rendu accéléré",
      status: hardwareRendering ? "ready" : "limited",
      detail: hardwareRendering
        ? "WebGL ou WebGPU est détecté pour les surfaces compatibles."
        : "Le rendu Canvas de compatibilité reste actif.",
      action: hardwareRendering
        ? "Le rendu s'adapte automatiquement au navigateur."
        : "Les visualisations restent fonctionnelles avec une qualité adaptée.",
    },
    {
      id: "motion-preference",
      label: "Confort visuel",
      status: reducedMotion ? "limited" : "ready",
      detail: reducedMotion
        ? "Les animations sont réduites selon la préférence système."
        : "Les animations peuvent accompagner le retour visuel.",
      action: reducedMotion
        ? "La capture et le signal audio ne sont pas affectés."
        : "La préférence système reste prioritaire.",
    },
  ];
  const blockingCheck = checks.find((check) => check.status === "blocked");
  const limitedCount = checks.filter(
    (check) =>
      check.status === "limited" &&
      ![
        "speech-recognition",
        "speech-synthesis",
        "background-processing",
        "hardware-rendering",
        "motion-preference",
      ].includes(check.id),
  ).length;
  const status: RuntimeStatus =
    blockingCheck !== undefined
      ? "blocked"
      : limitedCount > 0
        ? "limited"
        : "ready";
  return {
    canRecord,
    canPersistWorkspace,
    canPersistRecordings,
    canExportFolder: folderExport,
    canDownloadFallback: downloadFallback,
    recordingInputCount: input.recordingInputCount,
    supportsLocalSpeechRecognition: speechRecognition,
    supportsSpeechSynthesis: speechSynthesis,
    supportsBackgroundProcessing: backgroundProcessing,
    supportsHardwareRendering: hardwareRendering,
    primaryAction: createPrimaryAction({
      canRecord,
      canPersistRecordings,
      folderExport,
      workspaceStorage,
    }),
    primaryRisk:
      blockingCheck?.detail ??
      (limitedCount > 0
        ? (checks.find((check) => check.status === "limited")?.detail ?? null)
        : null),
    status,
    storageEstimate: input.storageEstimate,
    checks,
  };
}

export function describeAudioInputs(
  recordingInputCount: number | null,
): string {
  if (recordingInputCount === null) {
    return "Le navigateur ne peut pas encore lister les entrées audio.";
  }

  if (recordingInputCount === 0) {
    return "Aucune entrée audio détectée.";
  }

  return `${recordingInputCount} entrée${recordingInputCount > 1 ? "s" : ""} audio détectée${recordingInputCount > 1 ? "s" : ""}.`;
}

function getInputDeviceStatus(input: {
  readonly microphoneApiAvailable: boolean;
  readonly recordingInputCount: number | null;
}): RuntimeStatus {
  if (!input.microphoneApiAvailable || input.recordingInputCount === 0) {
    return "blocked";
  }

  return input.recordingInputCount === null ? "limited" : "ready";
}

function canCreateWebGlContext(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return (
      canvas.getContext("webgl2") !== null ||
      canvas.getContext("webgl") !== null
    );
  } catch {
    return false;
  }
}

function createPrimaryAction(input: {
  readonly canRecord: boolean;
  readonly canPersistRecordings: boolean;
  readonly folderExport: boolean;
  readonly workspaceStorage: boolean;
}): string {
  if (!input.canRecord) {
    return "Corrige le micro ou le navigateur avant de lancer une session.";
  }

  if (input.folderExport) {
    return "Choisis un dossier local pour automatiser l'export, ou lance avec téléchargement.";
  }

  if (!input.canPersistRecordings || !input.workspaceStorage) {
    return "Mode local limité: télécharge le WAV et le JSON après chaque prise.";
  }

  return "Lance une session courte; le système choisira les phrases les plus utiles.";
}

function formatStorageEstimate(estimate: StorageEstimate | null): string {
  if (estimate?.quotaMb === null || estimate?.quotaMb === undefined) {
    return "Cache audio disponible.";
  }

  if (estimate.usageMb === null) {
    return `Cache audio disponible, quota estimé ${estimate.quotaMb} Mo.`;
  }

  return `Cache audio disponible, ${estimate.usageMb}/${estimate.quotaMb} Mo utilisés.`;
}

function isLocalDevelopmentOrigin(): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function canUseLocalStorage(): boolean {
  try {
    const key = "voice-capture-studio.storage-test";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function canUseIndexedDb(): boolean {
  return window.indexedDB !== undefined;
}

function canUseDownloadFallback(): boolean {
  return (
    URL.createObjectURL !== undefined &&
    typeof Blob !== "undefined" &&
    "download" in HTMLAnchorElement.prototype
  );
}

async function inspectMicrophonePermission(): Promise<PermissionState | null> {
  try {
    if (navigator.permissions?.query === undefined) {
      return null;
    }

    const permission = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });

    return permission.state;
  } catch {
    return null;
  }
}

async function inspectAudioInputCount(): Promise<number | null> {
  try {
    if (navigator.mediaDevices?.enumerateDevices === undefined) {
      return null;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audioinput").length;
  } catch {
    // Device enumeration can be withheld until permission is granted. The
    // capture path remains the source of truth in that case.
    return null;
  }
}

async function inspectStorageEstimate(): Promise<StorageEstimate | null> {
  try {
    if (navigator.storage?.estimate === undefined) {
      return null;
    }

    const estimate = await navigator.storage.estimate();

    return {
      quotaMb:
        estimate.quota === undefined
          ? null
          : Math.round(estimate.quota / 1024 / 1024),
      usageMb:
        estimate.usage === undefined
          ? null
          : Math.round(estimate.usage / 1024 / 1024),
    };
  } catch {
    return null;
  }
}
