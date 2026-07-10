export type CaptureAudioMode = "free" | "training" | "dubbing" | "mastering";

export type AudioModePolicy = {
  readonly roomToneRequired: boolean;
  readonly minimumActiveSpeechRatio: number;
  readonly minimumSnrDb: number;
  readonly maximumRoomToneNoiseFloorDbfs: number;
};

const POLICIES: Record<Exclude<CaptureAudioMode, "free">, AudioModePolicy> = {
  training: {
    roomToneRequired: true,
    minimumActiveSpeechRatio: 0.25,
    minimumSnrDb: 24,
    maximumRoomToneNoiseFloorDbfs: -50,
  },
  dubbing: {
    roomToneRequired: true,
    minimumActiveSpeechRatio: 0.18,
    minimumSnrDb: 18,
    maximumRoomToneNoiseFloorDbfs: -46,
  },
  mastering: {
    roomToneRequired: true,
    minimumActiveSpeechRatio: 0.12,
    minimumSnrDb: 14,
    maximumRoomToneNoiseFloorDbfs: -42,
  },
};

export function getAudioModePolicy(
  mode: Exclude<CaptureAudioMode, "free"> = "training",
): AudioModePolicy {
  return POLICIES[mode];
}
