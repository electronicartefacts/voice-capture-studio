import type { SessionId, TakeId } from "@domains/sessions";

export function createTakeId(recordedAt: Date): TakeId {
  void recordedAt;
  return `take.${createUuid()}` as TakeId;
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

function createUuid(): string {
  const randomUuid = globalThis.crypto?.randomUUID;

  if (randomUuid !== undefined) {
    return randomUuid.call(globalThis.crypto);
  }

  const bytes = new Uint8Array(16);

  if (globalThis.crypto?.getRandomValues !== undefined) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
