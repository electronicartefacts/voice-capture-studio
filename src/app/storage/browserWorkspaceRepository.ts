import type {
  UnsupportedWorkspaceSchemaError,
  VoiceWorkspace,
  WorkspaceDurability,
  WorkspaceId,
  WorkspaceRepository,
} from "../../domains/workspace";
import { normalizeWorkspacePayload } from "../../domains/workspace";

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

      let rawWorkspace: string | null;

      try {
        rawWorkspace = window.localStorage.getItem(STORAGE_KEY);
      } catch {
        return {
          ok: false,
          error: "workspace-storage-unavailable",
          message: "Le stockage du navigateur n'est pas disponible.",
        };
      }

      if (rawWorkspace === null) {
        return {
          ok: false,
          error: "workspace-not-found",
          message: `Aucune progression locale n'a été trouvée pour ${id}.`,
        };
      }

      try {
        return {
          ok: true,
          value: {
            workspace: normalizeWorkspacePayload(JSON.parse(rawWorkspace), {
              workspaceId: id,
            }),
            durability: "persistent",
          },
        };
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
    },

    async save(
      workspace: VoiceWorkspace,
    ): ReturnType<WorkspaceRepository["save"]> {
      inMemoryWorkspace = workspace;

      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(workspace, null, 2),
        );
        inMemoryDurability = "persistent";

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
