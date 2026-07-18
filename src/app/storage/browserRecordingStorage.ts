import {
  RECORDINGS_STORE_NAME,
  openDatabase,
  requestResult,
  transactionDone,
} from "./indexedDb";

export type StoredRecording = {
  readonly blob: Blob;
  readonly fileName: string;
  readonly savedAt: string;
  readonly metadata?: Record<string, unknown>;
};

export async function saveBrowserRecordingMetadata(
  fileName: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      RECORDINGS_STORE_NAME,
      "readwrite",
    );
    const store = transaction.objectStore(RECORDINGS_STORE_NAME);
    const existing = await requestResult<StoredRecording | undefined>(
      store.get(fileName),
    );
    if (existing === undefined) {
      throw new Error(`Recording ${fileName} does not exist.`);
    }
    store.put({ ...existing, metadata }, fileName);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function saveRecordingToBrowserStorage(
  fileName: string,
  audioBlob: Blob,
): Promise<void> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(
      RECORDINGS_STORE_NAME,
      "readwrite",
    );
    const store = transaction.objectStore(RECORDINGS_STORE_NAME);
    const existing = await requestResult<StoredRecording | undefined>(
      store.get(fileName),
    );
    if (existing !== undefined) {
      throw new Error(
        `Recording ${fileName} already exists and will not be replaced.`,
      );
    }
    store.put(
      {
        fileName,
        blob: audioBlob,
        savedAt: new Date().toISOString(),
      },
      fileName,
    );

    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function saveRecordingsToBrowserStorage(
  recordings: readonly { readonly fileName: string; readonly blob: Blob }[],
): Promise<void> {
  if (recordings.length === 0) {
    return;
  }

  const fileNames = new Set<string>();
  for (const recording of recordings) {
    if (fileNames.has(recording.fileName)) {
      throw new Error(`Duplicate recording import: ${recording.fileName}.`);
    }
    fileNames.add(recording.fileName);
  }

  const database = await openDatabase();

  try {
    const transaction = database.transaction(
      RECORDINGS_STORE_NAME,
      "readwrite",
    );
    const store = transaction.objectStore(RECORDINGS_STORE_NAME);
    const savedAt = new Date().toISOString();

    for (const recording of recordings) {
      store.add(
        {
          fileName: recording.fileName,
          blob: recording.blob,
          savedAt,
        } satisfies StoredRecording,
        recording.fileName,
      );
    }

    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function listBrowserRecordings(): Promise<
  readonly StoredRecording[]
> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(RECORDINGS_STORE_NAME, "readonly");
    const request = transaction.objectStore(RECORDINGS_STORE_NAME).getAll();
    const recordings = await requestResult<StoredRecording[]>(request);

    await transactionDone(transaction);

    return recordings.sort((left, right) =>
      right.savedAt.localeCompare(left.savedAt),
    );
  } finally {
    database.close();
  }
}

export async function getBrowserRecording(
  fileName: string,
): Promise<Blob | undefined> {
  let database: IDBDatabase;

  try {
    database = await openDatabase();
  } catch {
    return undefined;
  }

  try {
    const transaction = database.transaction(RECORDINGS_STORE_NAME, "readonly");
    const request = transaction
      .objectStore(RECORDINGS_STORE_NAME)
      .get(fileName);
    const recording = await requestResult<StoredRecording | undefined>(request);

    await transactionDone(transaction);

    return recording?.blob;
  } finally {
    database.close();
  }
}
