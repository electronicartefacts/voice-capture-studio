import type { Result } from "@shared/index";
import type { RecordingDraft } from "./types";

export type RecorderPort = {
  readonly prepare: () => Promise<
    Result<RecordingDraft, "recorder-unavailable">
  >;
};
