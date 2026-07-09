import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceBackup } from "../src/app/storage/workspaceBackup";
import { canonicalCorpus } from "../src/domains/corpus";
import { initialSpeakers } from "../src/domains/speakers";
import { createEmptyWorkspace } from "../src/domains/workspace";

test("workspace backup wraps the current workspace with provenance", () => {
  const workspace = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-09T08:00:00.000Z"),
  });
  const backup = createWorkspaceBackup({
    now: new Date("2026-07-09T08:05:00.000Z"),
    workspace,
  });
  const parsed = JSON.parse(backup.contents) as {
    readonly backupFormat: string;
    readonly backupFormatVersion: string;
    readonly createdAt: string;
    readonly workspace: typeof workspace;
  };

  assert.equal(backup.mediaType, "application/json");
  assert.match(
    backup.fileName,
    /^voice-capture-studio\.workspace\.local\.main\./,
  );
  assert.equal(backup.fileName.includes(":"), false);
  assert.equal(parsed.backupFormat, "voice-capture-studio.workspace-backup");
  assert.equal(parsed.backupFormatVersion, "0.1.0");
  assert.equal(parsed.createdAt, "2026-07-09T08:05:00.000Z");
  assert.equal(parsed.workspace.workspaceId, workspace.workspaceId);
  assert.deepEqual(parsed.workspace.capturedSessions, []);
});
