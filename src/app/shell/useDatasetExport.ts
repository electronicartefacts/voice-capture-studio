import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { CorpusManifest } from "@domains/corpus";
import type { SpeakerId, SpeakerProfile } from "@domains/speakers";
import type { VoiceWorkspace } from "@domains/workspace";
import type { LanguageCode } from "@shared/index";
import type { VoiceCapturePackagePlan } from "../export/voiceCapturePackage";
import {
  getWorkspaceRecording,
  saveVoiceCapturePackageToWorkspaceFolder,
} from "../storage/workspaceFolder";
import type { DatasetExportState } from "./types";

type UseDatasetExportInput = {
  readonly corpus: CorpusManifest;
  readonly language: LanguageCode;
  readonly setMessage: (message: string) => void;
  readonly speakerId: SpeakerId;
  readonly speakerProfiles: readonly SpeakerProfile[];
  readonly workspace: VoiceWorkspace | null;
};

type DatasetExportResult = {
  readonly cancel: () => void;
  readonly download: () => Promise<void>;
  readonly reset: () => void;
  readonly state: DatasetExportState;
  readonly writeToFolder: () => Promise<void>;
};

export function useDatasetExport({
  corpus,
  language,
  setMessage,
  speakerId,
  speakerProfiles,
  workspace,
}: UseDatasetExportInput): DatasetExportResult {
  const [state, setState] = useState<DatasetExportState>({ status: "idle" });
  const abortControllerRef = useRef<AbortController | null>(null);
  const downloadUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      const abortController = abortControllerRef.current;
      abortControllerRef.current = null;
      abortController?.abort();
      revokeObjectUrl(downloadUrlRef.current);
    },
    [],
  );

  const cancel = useCallback(() => {
    const abortController = abortControllerRef.current;
    abortControllerRef.current = null;
    abortController?.abort(new DOMException("Export annulé.", "AbortError"));
    setState({ status: "idle" });
    setMessage("Export annulé. Aucun paquet incomplet n’a été proposé.");
  }, [setMessage]);

  const reset = useCallback(() => {
    const abortController = abortControllerRef.current;
    abortControllerRef.current = null;
    abortController?.abort(new DOMException("Export invalidé.", "AbortError"));
    setState({ status: "idle" });
  }, []);

  const download = useCallback(async () => {
    if (workspace === null) return;

    const abortController = beginExport(abortControllerRef, setState);

    try {
      const [packageModule, zipModule] = await Promise.all([
        import("../export/prepareVoiceCapturePackage"),
        import("../export/downloadDatasetPackage"),
      ]);
      const plan = await packageModule.prepareVoiceCapturePackage({
        corpus,
        getAudioBlob: getWorkspaceRecording,
        language,
        signal: abortController.signal,
        speakerId,
        speakerProfiles,
        workspace,
      });
      const zip = await zipModule.createVoiceCapturePackageZip({
        plan,
        signal: abortController.signal,
      });

      revokeObjectUrl(downloadUrlRef.current);
      const url = URL.createObjectURL(zip.blob);
      downloadUrlRef.current = url;
      triggerDownload(
        url,
        `voice-capture-package-${plan.manifest.package_id}.zip`,
      );
      setState(createCompletedState(plan));
    } catch (error) {
      handleExportFailure({
        abortController,
        abortControllerRef,
        error,
        fallbackMessage: "Le dataset n'a pas pu être généré.",
        setMessage,
        setState,
      });
    } finally {
      finishExport(abortControllerRef, abortController);
    }
  }, [corpus, language, setMessage, speakerId, speakerProfiles, workspace]);

  const writeToFolder = useCallback(async () => {
    if (workspace === null) return;

    const abortController = beginExport(abortControllerRef, setState);

    try {
      const packageModule =
        await import("../export/prepareVoiceCapturePackage");
      const plan = await packageModule.prepareVoiceCapturePackage({
        corpus,
        getAudioBlob: getWorkspaceRecording,
        language,
        signal: abortController.signal,
        speakerId,
        speakerProfiles,
        workspace,
      });
      const result = await saveVoiceCapturePackageToWorkspaceFolder({
        files: plan.files,
        packageId: plan.manifest.package_id,
        signal: abortController.signal,
      });

      if (!result.ok) {
        setState({ status: "error", message: result.message });
        return;
      }

      setState(createCompletedState(plan));
    } catch (error) {
      handleExportFailure({
        abortController,
        abortControllerRef,
        error,
        fallbackMessage: "Le dataset n'a pas pu être écrit dans ce dossier.",
        onAbort: () =>
          setMessage(
            "Export annulé. Le marqueur d’export incomplet reste explicite dans le dossier.",
          ),
        setMessage,
        setState,
      });
    } finally {
      finishExport(abortControllerRef, abortController);
    }
  }, [corpus, language, setMessage, speakerId, speakerProfiles, workspace]);

  return { cancel, download, reset, state, writeToFolder };
}

function beginExport(
  abortControllerRef: RefObject<AbortController | null>,
  setState: Dispatch<SetStateAction<DatasetExportState>>,
): AbortController {
  abortControllerRef.current?.abort();
  const abortController = new AbortController();
  abortControllerRef.current = abortController;
  setState({ status: "preparing" });
  return abortController;
}

function finishExport(
  abortControllerRef: RefObject<AbortController | null>,
  abortController: AbortController,
): void {
  if (abortControllerRef.current === abortController) {
    abortControllerRef.current = null;
  }
}

function handleExportFailure(input: {
  readonly abortController: AbortController;
  readonly abortControllerRef: RefObject<AbortController | null>;
  readonly error: unknown;
  readonly fallbackMessage: string;
  readonly onAbort?: () => void;
  readonly setMessage: (message: string) => void;
  readonly setState: Dispatch<SetStateAction<DatasetExportState>>;
}): void {
  if (input.abortControllerRef.current !== input.abortController) return;

  if (isAbortError(input.error) || input.abortController.signal.aborted) {
    input.setState({ status: "idle" });
    if (input.onAbort !== undefined) {
      input.onAbort();
    } else {
      input.setMessage(
        "Export annulé. Aucun paquet incomplet n’a été proposé.",
      );
    }
    return;
  }

  input.setState({
    status: "error",
    message:
      input.error instanceof Error
        ? input.error.message
        : input.fallbackMessage,
  });
}

function createCompletedState(
  plan: VoiceCapturePackagePlan,
): DatasetExportState {
  return {
    status: "done",
    keeperCount: plan.samples.length,
    missingAudioFiles: [],
    forgeReady: plan.forgeCompatibility.ready,
    blockingReasons: plan.forgeCompatibility.errors,
  };
}

function triggerDownload(url: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
}

function revokeObjectUrl(url: string | null): void {
  if (url !== null) URL.revokeObjectURL(url);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
