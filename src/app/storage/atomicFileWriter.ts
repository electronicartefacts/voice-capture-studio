export type WritableFileDirectory = {
  removeEntry?: (name: string) => Promise<void>;
  getFileHandle?: (
    name: string,
    options?: { readonly create?: boolean },
  ) => Promise<{
    createWritable: () => Promise<{
      abort?: () => Promise<void>;
      close: () => Promise<void>;
      write: (data: Blob) => Promise<void>;
    }>;
  }>;
};

const EXPORT_COMPLETE_MARKER = "EXPORT_COMPLETE";
const EXPORT_INCOMPLETE_MARKER = "EXPORT_INCOMPLETE";

export async function beginMarkedAtomicExport(
  directory: WritableFileDirectory,
  signal?: AbortSignal,
): Promise<void> {
  await writeBlobAtomically(
    directory,
    EXPORT_INCOMPLETE_MARKER,
    new Blob([
      "Package creation started; absence of EXPORT_COMPLETE means incomplete.",
    ]),
    signal,
  );
  try {
    await removeEntryIfPresent(directory, EXPORT_COMPLETE_MARKER);
  } catch (error) {
    await removeEntryIfPresent(directory, EXPORT_INCOMPLETE_MARKER).catch(
      () => undefined,
    );
    throw error;
  }
}

export async function completeMarkedAtomicExport(
  directory: WritableFileDirectory,
  signal?: AbortSignal,
): Promise<void> {
  await writeBlobAtomically(
    directory,
    EXPORT_COMPLETE_MARKER,
    new Blob(["voice.capture.package.v1 complete"]),
    signal,
  );
  try {
    await removeEntryIfPresent(directory, EXPORT_INCOMPLETE_MARKER);
  } catch (error) {
    await removeEntryIfPresent(directory, EXPORT_COMPLETE_MARKER).catch(
      () => undefined,
    );
    throw error;
  }
}

/**
 * Uses the File System Access API's temporary writable. The destination is
 * committed only by close(); abort() discards a failed or interrupted write.
 */
export async function writeBlobAtomically(
  directory: WritableFileDirectory,
  fileName: string,
  blob: Blob,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (directory.getFileHandle === undefined) {
    throw new Error("File handles are not supported.");
  }

  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  const onAbort = () => void writable.abort?.().catch(() => undefined);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    throwIfAborted(signal);
    await writable.write(blob);
    throwIfAborted(signal);
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw signal?.aborted ? abortReason(signal) : error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Écriture annulée.", "AbortError");
}

async function removeEntryIfPresent(
  directory: WritableFileDirectory,
  name: string,
): Promise<void> {
  if (directory.removeEntry === undefined) {
    throw new Error("Atomic export markers are not supported.");
  }
  try {
    await directory.removeEntry(name);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "NotFoundError")
      throw error;
  }
}
