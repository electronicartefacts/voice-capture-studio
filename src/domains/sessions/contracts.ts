import type { CaptureSession } from "./types";

export type SessionPlannerInput = {
  readonly targetMinutes: number;
};

export type SessionPlanner = {
  readonly planNextSession: (
    input: SessionPlannerInput,
  ) => Promise<CaptureSession>;
};
