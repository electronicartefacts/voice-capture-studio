const DB_NAME = "voice-capture-studio";
const DB_VERSION = 3;

export const FOLDER_STORE_NAME = "workspace-folder";
export const RECORDINGS_STORE_NAME = "recordings";
export const WORKSPACE_STORE_NAME = "workspace";

const ALL_STORE_NAMES = [
  FOLDER_STORE_NAME,
  RECORDINGS_STORE_NAME,
  WORKSPACE_STORE_NAME,
] as const;

export function isIndexedDbAvailable(): boolean {
  return globalThis.indexedDB !== undefined;
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error("IndexedDB is not available."));
      return;
    }

    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      for (const storeName of ALL_STORE_NAMES) {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function requestResult<TValue>(
  request: IDBRequest<TValue>,
): Promise<TValue> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function readStoreValue<TValue>(
  storeName: string,
  key: string,
): Promise<TValue | undefined> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    const value = await requestResult<TValue | undefined>(request);

    await transactionDone(transaction);

    return value;
  } finally {
    database.close();
  }
}

export async function writeStoreValue(
  storeName: string,
  key: string,
  value: unknown,
): Promise<void> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value, key);

    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

let persistentStorageRequested = false;

/**
 * Ask the browser to protect this origin's storage from automatic eviction.
 * Best-effort: unsupported browsers and denied requests are silently ignored,
 * and the request is only issued once per session.
 */
export function requestPersistentStorage(): void {
  if (persistentStorageRequested) {
    return;
  }

  persistentStorageRequested = true;

  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // Storage manager unavailable; eviction protection stays best-effort.
  }
}
