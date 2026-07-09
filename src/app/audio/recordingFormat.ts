export type BrowserRecordingFormat = {
  readonly extension: "webm" | "mp4" | "ogg";
  readonly mimeType: string;
};

const preferredFormats: readonly BrowserRecordingFormat[] = [
  { mimeType: "audio/webm;codecs=opus", extension: "webm" },
  { mimeType: "audio/webm", extension: "webm" },
  { mimeType: "audio/mp4", extension: "mp4" },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
];

export function chooseBrowserRecordingFormat(): BrowserRecordingFormat | null {
  if (!("MediaRecorder" in window)) {
    return null;
  }

  return (
    preferredFormats.find((format) =>
      MediaRecorder.isTypeSupported(format.mimeType),
    ) ?? {
      mimeType: "",
      extension: "webm",
    }
  );
}
