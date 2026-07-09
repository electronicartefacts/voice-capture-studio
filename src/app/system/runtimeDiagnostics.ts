export type RuntimeStatus = "ready" | "limited" | "blocked";

export type RuntimeCheck = {
  readonly id:
    | "secure-context"
    | "microphone"
    | "audio-engine"
    | "workspace-storage"
    | "recording-storage"
    | "folder-export"
    | "downloads"
    | "screen-lock";
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
    storageEstimate: null,
  });
}

export async function inspectRuntime(): Promise<RuntimeDiagnostics> {
  const [microphonePermission, storageEstimate] = await Promise.all([
    inspectMicrophonePermission(),
    inspectStorageEstimate(),
  ]);

  return buildDiagnostics({
    microphonePermission,
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
  ];
  const blockingCheck = checks.find((check) => check.status === "blocked");
  const limitedCount = checks.filter(
    (check) => check.status === "limited",
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
