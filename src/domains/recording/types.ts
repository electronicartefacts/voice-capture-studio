import type { PromptId } from "@domains/corpus";
import type { TakeId } from "@domains/sessions";

export type RecordingState =
  "idle" | "armed" | "recording" | "stopped" | "failed";

export type RecordingDraft = {
  readonly promptId: PromptId;
  readonly state: RecordingState;
  readonly currentTakeId?: TakeId;
};
