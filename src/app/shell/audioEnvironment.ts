export const INPUT_SENSITIVITY_STORAGE_KEY =
  "voice-capture-studio.input-sensitivity";
export const INPUT_SENSITIVITY_MIN = 0.5;
export const INPUT_SENSITIVITY_MAX = 3;
export const DEFAULT_INPUT_SENSITIVITY = 1.6;
export const REVIEW_WAVEFORM_BAR_COUNT = 92;
export const AUDIO_UI_UPDATE_INTERVAL_MS = 80;
export const KARAOKE_STYLE_UPDATE_INTERVAL_MS = 1000 / 30;

export type WindowWithAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export async function closeAmbientAudioContext(
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
