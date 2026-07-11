export type LiveReadingGuideSource =
  "idle" | "speech-recognition" | "voice-activity";

export type LiveReadingGuidePosition = {
  readonly source: LiveReadingGuideSource;
  readonly wordIndex: number;
  readonly wordProgress: number;
};

type LiveReadingGuideSignal = {
  source: LiveReadingGuideSource;
  updatedAt: number;
  wordIndex: number;
  wordProgress: number;
};

// The reading clock is intentionally kept outside React. Browser ASR and the
// audio/VAD loop can update it at their natural cadence while the text renderer
// samples one small mutable object from requestAnimationFrame.
export const liveReadingGuideSignal: LiveReadingGuideSignal = {
  source: "idle",
  updatedAt: 0,
  wordIndex: 0,
  wordProgress: 0,
};

export function setLiveReadingGuidePosition(
  position: LiveReadingGuidePosition,
): void {
  liveReadingGuideSignal.source = position.source;
  liveReadingGuideSignal.wordIndex = Math.max(
    0,
    Math.floor(position.wordIndex),
  );
  liveReadingGuideSignal.wordProgress = Math.max(
    0,
    Math.min(1, position.wordProgress),
  );
  liveReadingGuideSignal.updatedAt = performance.now();
}

export function resetLiveReadingGuidePosition(): void {
  setLiveReadingGuidePosition({
    source: "idle",
    wordIndex: 0,
    wordProgress: 0,
  });
}
