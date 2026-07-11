import type {
  UnsupportedWorkspaceSchemaError,
  VoiceWorkspace,
  WorkspaceDurability,
  WorkspaceId,
  WorkspaceRepository,
} from "../../domains/workspace";
import { normalizeWorkspacePayload } from "../../domains/workspace";
import {
  RECORDINGS_STORE_NAME,
  WORKSPACE_STORE_NAME,
  isIndexedDbAvailable,
  openDatabase,
  readStoreValue,
  requestPersistentStorage,
  transactionDone,
  writeStoreValue,
} from "./indexedDb";
import { getBrowserRecording } from "./browserRecordingStorage";
import { sha256Blob } from "./sha256";

const STORAGE_KEY = "voice-capture-studio.workspace.v1";

export type BrowserWorkspaceRepository = WorkspaceRepository & {
  readonly restoreArchive: (input: {
    readonly workspace: VoiceWorkspace;
    readonly recordings: readonly {
      readonly fileName: string;
      readonly blob: Blob;
      readonly sha256: string;
    }[];
  }) => ReturnType<WorkspaceRepository["save"]>;
};

export function createBrowserWorkspaceRepository(): BrowserWorkspaceRepository {
  let inMemoryWorkspace: VoiceWorkspace | null = null;
  let inMemoryDurability: WorkspaceDurability = "memory-only";

  return {
    async open(id: WorkspaceId): ReturnType<WorkspaceRepository["open"]> {
      if (inMemoryWorkspace !== null) {
        return {
          ok: true,
          value: {
            workspace: inMemoryWorkspace,
            durability: inMemoryDurability,
          },
        };
      }

      let payload: unknown;
      let source: "indexed-db" | "local-storage" | null = null;

      if (isIndexedDbAvailable()) {
        try {
          payload = await readStoreValue<unknown>(
            WORKSPACE_STORE_NAME,
            STORAGE_KEY,
          );

          if (payload !== undefined) {
            source = "indexed-db";
          }
        } catch {
          // IndexedDB can be blocked at runtime; fall back to localStorage.
        }
      }

      if (source === null) {
        let rawWorkspace: string | null;

        try {
          rawWorkspace = window.localStorage.getItem(STORAGE_KEY);
        } catch {
          rawWorkspace = null;
        }

        if (rawWorkspace !== null) {
          try {
            payload = JSON.parse(rawWorkspace);
            source = "local-storage";
          } catch {
            return {
              ok: false,
              error: "workspace-unreadable",
              message: `La progression locale ${id} est illisible dans le navigateur.`,
            };
          }
        }
      }

      if (source === null) {
        return {
          ok: false,
          error: "workspace-not-found",
          message: `Aucune progression locale n'a été trouvée pour ${id}.`,
        };
      }

      let workspace: VoiceWorkspace;

      try {
        workspace = normalizeWorkspacePayload(payload, { workspaceId: id });
      } catch (error) {
        if (isUnsupportedWorkspaceSchemaError(error)) {
          return {
            ok: false,
            error: "workspace-unsupported-schema",
            message: error.message,
          };
        }

        return {
          ok: false,
          error: "workspace-unreadable",
          message: `La progression locale ${id} est illisible dans le navigateur.`,
        };
      }

      inMemoryWorkspace = workspace;
      inMemoryDurability = "persistent";

      if (source === "local-storage" && isIndexedDbAvailable()) {
        // Legacy localStorage workspaces move to IndexedDB on first open. The
        // localStorage copy stays behind as a read-only fallback in case
        // IndexedDB becomes unavailable later.
        try {
          await writeStoreValue(WORKSPACE_STORE_NAME, STORAGE_KEY, workspace);
        } catch {
          // Migration is opportunistic; the next save retries it.
        }
      }

      return {
        ok: true,
        value: {
          workspace,
          durability: "persistent",
        },
      };
    },

    async save(
      workspace: VoiceWorkspace,
    ): ReturnType<WorkspaceRepository["save"]> {
      inMemoryWorkspace = workspace;

      if (isIndexedDbAvailable()) {
        try {
          await writeStoreValue(WORKSPACE_STORE_NAME, STORAGE_KEY, workspace);
          inMemoryDurability = "persistent";
          requestPersistentStorage();

          return {
            ok: true,
            value: {
              workspace,
              durability: "persistent",
            },
          };
        } catch {
          // Fall back to localStorage below.
        }
      }

      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
        inMemoryDurability = "persistent";
        requestPersistentStorage();

        return {
          ok: true,
          value: {
            workspace,
            durability: "persistent",
          },
        };
      } catch {
        inMemoryDurability = "memory-only";

        return {
          ok: true,
          value: {
            workspace,
            durability: "memory-only",
          },
        };
      }
    },

    async restoreArchive(input): ReturnType<WorkspaceRepository["save"]> {
      if (!isIndexedDbAvailable()) {
        throw new Error(
          "Ce navigateur ne peut pas restaurer les WAV sans stockage local fiable.",
        );
      }

      let database: IDBDatabase;
      try {
        database = await openDatabase();
      } catch {
        throw new Error(
          "Le stockage local est indisponible; la restauration est annulée pour préserver l'archive.",
        );
      }

      try {
        const recordingsToAdd = [] as (typeof input.recordings)[number][];
        for (const recording of input.recordings) {
          const existing = await getBrowserRecording(recording.fileName);
          if (existing === undefined) {
            recordingsToAdd.push(recording);
            continue;
          }
          if ((await sha256Blob(existing)) !== recording.sha256) {
            throw new Error(
              `Un WAV différent utilise déjà le nom ${recording.fileName}; restauration annulée.`,
            );
          }
        }

        const transaction = database.transaction(
          [RECORDINGS_STORE_NAME, WORKSPACE_STORE_NAME],
          "readwrite",
        );
        const recordings = transaction.objectStore(RECORDINGS_STORE_NAME);

        for (const recording of recordingsToAdd) {
          recordings.add(
            {
              fileName: recording.fileName,
              blob: recording.blob,
              savedAt: new Date().toISOString(),
            },
            recording.fileName,
          );
        }
        transaction
          .objectStore(WORKSPACE_STORE_NAME)
          .put(input.workspace, STORAGE_KEY);
        await transactionDone(transaction);
      } finally {
        database.close();
      }

      inMemoryWorkspace = input.workspace;
      inMemoryDurability = "persistent";
      requestPersistentStorage();

      return {
        ok: true,
        value: {
          workspace: input.workspace,
          durability: "persistent",
        },
      };
    },
  };
}

function isUnsupportedWorkspaceSchemaError(
  error: unknown,
): error is UnsupportedWorkspaceSchemaError {
  return (
    error instanceof Error && error.name === "UnsupportedWorkspaceSchemaError"
  );
}
