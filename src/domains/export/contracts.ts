import type { Result } from "@shared/index";
import type { VoiceWorkspace } from "@domains/workspace";
import type { VoiceArchiveExportManifest } from "./types";

export type Exporter = {
  readonly createArchiveManifest: (
    workspace: VoiceWorkspace,
  ) => Promise<Result<VoiceArchiveExportManifest, "export-not-implemented">>;
};
