import type {
  UnsupportedWorkspaceSchemaError,
  VoiceWorkspace,
  WorkspaceDurability,
  WorkspaceId,
  WorkspaceRepository,
} from "../../domains/workspace";
import { normalizeWorkspacePayload } from "../../domains/workspace";
import {
  WORKSPACE_STORE_NAME,
  isIndexedDbAvailable,
  readStoreValue,
  requestPersistentStorage,
  writeStoreValue,
} from "./indexedDb";

const STORAGE_KEY = "voice-capture-studio.workspace.v1";

export function createBrowserWorkspaceRepository(): WorkspaceRepository {
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
  };
}

function isUnsupportedWorkspaceSchemaError(
  error: unknown,
): error is UnsupportedWorkspaceSchemaError {
  return (
    error instanceof Error && error.name === "UnsupportedWorkspaceSchemaError"
  );
}
