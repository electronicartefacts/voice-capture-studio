import type { LocalCorpusMode } from "@domains/corpus";
import type { VoiceWaveformScreen } from "../rendering/VoiceWaveformSurface";
import type { StoredRecording } from "../storage/browserRecordingStorage";

export type Screen = VoiceWaveformScreen;
export type CaptureMode =
  "free" | "training" | "lexical-segmentation" | LocalCorpusMode;
export type DownloadableRecording = StoredRecording & {
  readonly url: string;
};
export type BackingTrack = {
  readonly name: string;
  readonly url: string;
};
export type DubbingMediaSource =
  | {
      readonly kind: "local-video";
      readonly name: string;
      readonly url: string;
    }
  | {
      readonly kind: "youtube";
      readonly name: string;
      readonly url: string;
      readonly videoId: string;
    };
export type DatasetExportState =
  | { readonly status: "idle" }
  | { readonly status: "preparing" }
  | {
      readonly status: "done";
      readonly keeperCount: number;
      readonly missingAudioFiles: readonly string[];
      readonly forgeReady: boolean;
      readonly blockingReasons: readonly string[];
    }
  | { readonly status: "error"; readonly message: string };
export type ReadingGuideMode = "speech-recognition" | "voice-activity";
export type RitualStatus = "idle" | "requesting" | "denied";
export type RoomToneCalibration = {
  readonly durationMs: number;
  readonly peakDbfs: number;
  readonly noiseFloorDbfs: number;
  readonly integratedLufs: number;
};
