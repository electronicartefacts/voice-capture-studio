import type { CaptureProfile, WorkspaceSettings } from "./types";

export const DEFAULT_CAPTURE_PROFILE: CaptureProfile = {
  microphoneName: "Micro non renseigne",
  audioInterface: "Interface non renseignee",
  mouthToMicDistanceCm: 15,
  roomDescription: "Piece calme, non documentee",
  roomToneCaptured: false,
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  preferredSessionMinutes: 5,
  storageMode: "browser-private-storage",
  captureProfile: DEFAULT_CAPTURE_PROFILE,
};
