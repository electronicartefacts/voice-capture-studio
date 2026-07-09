import type { Result } from "@shared/index";
import type { VoiceWorkspace, WorkspaceId } from "./types";

export type WorkspaceDurability = "persistent" | "memory-only";

export type WorkspaceReceipt = {
  readonly workspace: VoiceWorkspace;
  readonly durability: WorkspaceDurability;
};

export type WorkspaceOpenError =
  | "workspace-not-found"
  | "workspace-storage-unavailable"
  | "workspace-unreadable"
  | "workspace-unsupported-schema";

export type WorkspaceRepository = {
  readonly open: (
    id: WorkspaceId,
  ) => Promise<Result<WorkspaceReceipt, WorkspaceOpenError>>;
  readonly save: (
    workspace: VoiceWorkspace,
  ) => Promise<Result<WorkspaceReceipt, "workspace-save-failed">>;
};

export type WorkspacePort = {
  readonly repository: WorkspaceRepository;
};
