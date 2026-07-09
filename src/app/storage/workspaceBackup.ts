import type { IsoDateTime } from "../../shared";
import type { VoiceWorkspace } from "../../domains/workspace";

export type WorkspaceBackupDocument = {
  readonly backupFormat: "voice-capture-studio.workspace-backup";
  readonly backupFormatVersion: "0.1.0";
  readonly createdAt: IsoDateTime;
  readonly workspace: VoiceWorkspace;
};

export type WorkspaceBackup = {
  readonly contents: string;
  readonly fileName: string;
  readonly mediaType: "application/json";
};

export function createWorkspaceBackup(input: {
  readonly now: Date;
  readonly workspace: VoiceWorkspace;
}): WorkspaceBackup {
  const createdAt = input.now.toISOString() as IsoDateTime;
  const document: WorkspaceBackupDocument = {
    backupFormat: "voice-capture-studio.workspace-backup",
    backupFormatVersion: "0.1.0",
    createdAt,
    workspace: input.workspace,
  };

  return {
    contents: JSON.stringify(document, null, 2),
    fileName: `voice-capture-studio.${sanitizeFileSegment(input.workspace.workspaceId)}.${sanitizeFileSegment(createdAt)}.workspace-backup.json`,
    mediaType: "application/json",
  };
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
