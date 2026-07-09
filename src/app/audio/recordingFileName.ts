import type { SessionId, TakeId } from "@domains/sessions";

export function createTakeId(recordedAt: Date): TakeId {
  return `take.${recordedAt.toISOString()}` as TakeId;
}

export function createRecordingFileName(input: {
  readonly extension: "wav";
  readonly sessionId: SessionId;
  readonly takeId: TakeId;
}): string {
  return `${sanitizeIdentifier(input.sessionId)}__${sanitizeIdentifier(input.takeId)}.${input.extension}`;
}

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
