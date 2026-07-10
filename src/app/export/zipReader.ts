import { crc32 } from "./zipWriter";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_COUNT = 5000;
const MAX_COMMENT_BYTES = 65_535;

export async function readStoredZipEntries(
  archive: Blob,
): Promise<ReadonlyMap<string, Blob>> {
  if (archive.size > MAX_ARCHIVE_BYTES) {
    throw new Error("Archive exceeds the 1 GiB import limit.");
  }

  const bytes = new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntryCount = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);

  if (diskNumber !== 0 || centralDisk !== 0 || diskEntryCount !== entryCount) {
    throw new Error("Multi-volume ZIP archives are not supported.");
  }

  if (entryCount > MAX_ENTRY_COUNT) {
    throw new Error(`Archive contains more than ${MAX_ENTRY_COUNT} entries.`);
  }

  if (centralOffset + centralSize > endOffset) {
    throw new Error("ZIP central directory exceeds the archive bounds.");
  }

  const entries = new Map<string, Blob>();
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    ensureAvailable(bytes, offset, 46, "central directory header");
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("ZIP central directory signature is invalid.");
    }

    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const pathLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const entryDisk = view.getUint16(offset + 34, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const centralEntryLength = 46 + pathLength + extraLength + commentLength;

    ensureAvailable(
      bytes,
      offset,
      centralEntryLength,
      "central directory entry",
    );
    if ((flags & 0x1) !== 0) {
      throw new Error("Encrypted ZIP entries are not supported.");
    }
    if ((flags & 0x8) !== 0) {
      throw new Error("ZIP data descriptors are not supported.");
    }
    if (compressionMethod !== 0 || compressedSize !== uncompressedSize) {
      throw new Error("Only uncompressed ZIP entries are supported.");
    }
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new Error("ZIP entry exceeds the 256 MiB import limit.");
    }
    if (entryDisk !== 0) {
      throw new Error("Multi-volume ZIP entries are not supported.");
    }

    const path = decodePath(
      bytes.subarray(offset + 46, offset + 46 + pathLength),
    );

    assertSafeArchivePath(path);
    if (entries.has(path)) {
      throw new Error(`Duplicate ZIP entry: ${path}`);
    }

    const data = readLocalEntry({
      bytes,
      view,
      localHeaderOffset,
      path,
      expectedCrc,
      expectedSize: uncompressedSize,
    });

    entries.set(path, new Blob([copyBuffer(data)]));
    offset += centralEntryLength;
  }

  if (offset !== centralOffset + centralSize) {
    throw new Error("ZIP central directory size is inconsistent.");
  }

  return entries;
}

function readLocalEntry(input: {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  readonly localHeaderOffset: number;
  readonly path: string;
  readonly expectedCrc: number;
  readonly expectedSize: number;
}): Uint8Array {
  ensureAvailable(
    input.bytes,
    input.localHeaderOffset,
    30,
    "local file header",
  );
  if (
    input.view.getUint32(input.localHeaderOffset, true) !==
    LOCAL_FILE_HEADER_SIGNATURE
  ) {
    throw new Error(`Local ZIP header is invalid for ${input.path}.`);
  }

  const flags = input.view.getUint16(input.localHeaderOffset + 6, true);
  const method = input.view.getUint16(input.localHeaderOffset + 8, true);
  const localCrc = input.view.getUint32(input.localHeaderOffset + 14, true);
  const localCompressedSize = input.view.getUint32(
    input.localHeaderOffset + 18,
    true,
  );
  const localSize = input.view.getUint32(input.localHeaderOffset + 22, true);
  const pathLength = input.view.getUint16(input.localHeaderOffset + 26, true);
  const extraLength = input.view.getUint16(input.localHeaderOffset + 28, true);
  const dataOffset = input.localHeaderOffset + 30 + pathLength + extraLength;
  const dataEnd = dataOffset + input.expectedSize;

  ensureAvailable(
    input.bytes,
    input.localHeaderOffset,
    30 + pathLength + extraLength + input.expectedSize,
    "local ZIP entry",
  );

  const localPath = decodePath(
    input.bytes.subarray(
      input.localHeaderOffset + 30,
      input.localHeaderOffset + 30 + pathLength,
    ),
  );
  if (localPath !== input.path) {
    throw new Error(`ZIP path mismatch for ${input.path}.`);
  }
  if (
    flags !== 0 ||
    method !== 0 ||
    localCrc !== input.expectedCrc ||
    localCompressedSize !== input.expectedSize ||
    localSize !== input.expectedSize
  ) {
    throw new Error(`ZIP headers disagree for ${input.path}.`);
  }

  const data = input.bytes.subarray(dataOffset, dataEnd);
  if (crc32(data) !== input.expectedCrc) {
    throw new Error(`ZIP checksum mismatch for ${input.path}.`);
  }

  return data;
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimumOffset = Math.max(0, view.byteLength - 22 - MAX_COMMENT_BYTES);

  for (
    let offset = view.byteLength - 22;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }

    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) {
      return offset;
    }
  }

  throw new Error("ZIP end-of-central-directory record was not found.");
}

function assertSafeArchivePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > 512 ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    hasControlCharacter(path) ||
    path
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe ZIP entry path: ${path}`);
  }
}

function decodePath(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("ZIP entry path is not valid UTF-8.");
  }
}

function ensureAvailable(
  bytes: Uint8Array,
  offset: number,
  length: number,
  label: string,
): void {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(`ZIP ${label} exceeds the archive bounds.`);
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}
