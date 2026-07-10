import { PCM_TARGET_BIT_DEPTH, PCM_TARGET_SAMPLE_RATE } from "./pcmAudio";

export type PcmWavValidation = {
  readonly byteLength: number;
  readonly dataByteLength: number;
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly bitDepth: number;
  readonly durationMs: number;
};

/**
 * Validates the complete container written by the recorder. This intentionally
 * accepts only the package's canonical PCM shape; a browser MIME type alone is
 * not evidence that a blob is a usable training sample.
 */
export async function validatePcmWavBlob(
  blob: Blob,
  expected: {
    readonly sampleRateHz?: number;
    readonly channels?: number;
    readonly bitDepth?: number;
  } = {},
): Promise<PcmWavValidation> {
  return validatePcmWavBytes(new Uint8Array(await blob.arrayBuffer()), {
    ...expected,
    byteLength: blob.size,
  });
}

export function validatePcmWavBytes(
  bytes: Uint8Array,
  expected: {
    readonly sampleRateHz?: number;
    readonly channels?: number;
    readonly bitDepth?: number;
    readonly byteLength?: number;
  } = {},
): PcmWavValidation {
  if (bytes.length < 44) {
    throw new Error("WAV is shorter than its canonical header.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") {
    throw new Error("Audio is not a RIFF/WAVE container.");
  }

  const riffSize = view.getUint32(4, true);
  if (riffSize + 8 !== bytes.length) {
    throw new Error("WAV RIFF size does not match the stored byte length.");
  }

  let offset = 12;
  let format: {
    readonly audioFormat: number;
    readonly channels: number;
    readonly sampleRateHz: number;
    readonly blockAlign: number;
    readonly bitDepth: number;
  } | null = null;
  let dataOffset = -1;
  let dataByteLength = -1;

  while (offset + 8 <= bytes.length) {
    const chunkId = ascii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > bytes.length) {
      throw new Error(`WAV chunk ${chunkId} exceeds the stored byte length.`);
    }

    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw new Error("WAV fmt chunk is incomplete.");
      }
      format = {
        audioFormat: view.getUint16(chunkStart, true),
        channels: view.getUint16(chunkStart + 2, true),
        sampleRateHz: view.getUint32(chunkStart + 4, true),
        blockAlign: view.getUint16(chunkStart + 12, true),
        bitDepth: view.getUint16(chunkStart + 14, true),
      };
    } else if (chunkId === "data" && dataOffset === -1) {
      dataOffset = chunkStart;
      dataByteLength = chunkSize;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (format === null || dataOffset < 0) {
    throw new Error("WAV must contain both fmt and data chunks.");
  }

  const sampleRateHz = expected.sampleRateHz ?? PCM_TARGET_SAMPLE_RATE;
  const channels = expected.channels ?? 1;
  const bitDepth = expected.bitDepth ?? PCM_TARGET_BIT_DEPTH;
  const bytesPerSample = bitDepth / 8;
  const expectedBlockAlign = channels * bytesPerSample;

  if (
    format.audioFormat !== 1 ||
    format.channels !== channels ||
    format.sampleRateHz !== sampleRateHz ||
    format.bitDepth !== bitDepth ||
    format.blockAlign !== expectedBlockAlign
  ) {
    throw new Error(
      `WAV format must be PCM ${channels}ch ${sampleRateHz}Hz ${bitDepth}bit.`,
    );
  }

  if (dataByteLength % expectedBlockAlign !== 0) {
    throw new Error("WAV data is not aligned to complete PCM samples.");
  }

  if (
    expected.byteLength !== undefined &&
    expected.byteLength !== bytes.length
  ) {
    throw new Error("WAV byte length changed while it was being read.");
  }

  return {
    byteLength: bytes.length,
    dataByteLength,
    sampleRateHz: format.sampleRateHz,
    channels: format.channels,
    bitDepth: format.bitDepth,
    durationMs: Math.round(
      (dataByteLength / expectedBlockAlign / format.sampleRateHz) * 1000,
    ),
  };
}

function ascii(view: DataView, offset: number, length: number): string {
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(offset + index)),
  ).join("");
}
