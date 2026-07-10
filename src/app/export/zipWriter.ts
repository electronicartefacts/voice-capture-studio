export type ZipEntryInput = {
  readonly path: string;
  readonly data: Blob;
};

type PreparedEntry = {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly crc32: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly localHeaderOffset: number;
};

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION = 20;

export async function createZipBlob(
  entries: readonly ZipEntryInput[],
): Promise<Blob> {
  const now = new Date();
  const dosTime = toDosTime(now);
  const dosDate = toDosDate(now);
  const chunks: Uint8Array[] = [];
  const prepared: PreparedEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const bytes = new Uint8Array(await entry.data.arrayBuffer());
    const pathBytes = encodeUtf8(entry.path);
    const crc = crc32(bytes);
    const localHeader = buildLocalFileHeader({
      pathBytes,
      crc32: crc,
      size: bytes.byteLength,
      dosTime,
      dosDate,
    });

    prepared.push({
      path: entry.path,
      bytes,
      crc32: crc,
      dosTime,
      dosDate,
      localHeaderOffset: offset,
    });
    chunks.push(localHeader, bytes);
    offset += localHeader.byteLength + bytes.byteLength;
  }

  const centralDirectoryStart = offset;
  const centralDirectoryChunks: Uint8Array[] = [];

  for (const entry of prepared) {
    const centralHeader = buildCentralDirectoryHeader(entry);
    centralDirectoryChunks.push(centralHeader);
    offset += centralHeader.byteLength;
  }

  const centralDirectorySize = offset - centralDirectoryStart;
  const endRecord = buildEndOfCentralDirectory({
    entryCount: prepared.length,
    centralDirectorySize,
    centralDirectoryStart,
  });

  return new Blob(
    [...chunks, ...centralDirectoryChunks, endRecord].map(toBlobPart),
    { type: "application/zip" },
  );
}

function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function buildLocalFileHeader(input: {
  readonly pathBytes: Uint8Array;
  readonly crc32: number;
  readonly size: number;
  readonly dosTime: number;
  readonly dosDate: number;
}): Uint8Array {
  const header = new DataView(new ArrayBuffer(30));

  header.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
  header.setUint16(4, ZIP_VERSION, true);
  header.setUint16(6, 0, true);
  header.setUint16(8, 0, true);
  header.setUint16(10, input.dosTime, true);
  header.setUint16(12, input.dosDate, true);
  header.setUint32(14, input.crc32, true);
  header.setUint32(18, input.size, true);
  header.setUint32(22, input.size, true);
  header.setUint16(26, input.pathBytes.byteLength, true);
  header.setUint16(28, 0, true);

  return concatBytes(new Uint8Array(header.buffer), input.pathBytes);
}

function buildCentralDirectoryHeader(entry: PreparedEntry): Uint8Array {
  const pathBytes = encodeUtf8(entry.path);
  const header = new DataView(new ArrayBuffer(46));

  header.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
  header.setUint16(4, ZIP_VERSION, true);
  header.setUint16(6, ZIP_VERSION, true);
  header.setUint16(8, 0, true);
  header.setUint16(10, 0, true);
  header.setUint16(12, entry.dosTime, true);
  header.setUint16(14, entry.dosDate, true);
  header.setUint32(16, entry.crc32, true);
  header.setUint32(20, entry.bytes.byteLength, true);
  header.setUint32(24, entry.bytes.byteLength, true);
  header.setUint16(28, pathBytes.byteLength, true);
  header.setUint16(30, 0, true);
  header.setUint16(32, 0, true);
  header.setUint16(34, 0, true);
  header.setUint16(36, 0, true);
  header.setUint32(38, 0, true);
  header.setUint32(42, entry.localHeaderOffset, true);

  return concatBytes(new Uint8Array(header.buffer), pathBytes);
}

function buildEndOfCentralDirectory(input: {
  readonly entryCount: number;
  readonly centralDirectorySize: number;
  readonly centralDirectoryStart: number;
}): Uint8Array {
  const record = new DataView(new ArrayBuffer(22));

  record.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  record.setUint16(4, 0, true);
  record.setUint16(6, 0, true);
  record.setUint16(8, input.entryCount, true);
  record.setUint16(10, input.entryCount, true);
  record.setUint32(12, input.centralDirectorySize, true);
  record.setUint32(16, input.centralDirectoryStart, true);
  record.setUint16(20, 0, true);

  return new Uint8Array(record.buffer);
}

function toDosTime(date: Date): number {
  return (
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  );
}

function toDosDate(date: Date): number {
  return (
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  );
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable !== null) {
    return crcTable;
  }

  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i++) {
    let value = i;

    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[i] = value >>> 0;
  }

  crcTable = table;
  return table;
}

export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;

  for (let i = 0; i < bytes.byteLength; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
