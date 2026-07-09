import type { VoiceWorkspace } from "@domains/workspace";
import type { CorpusManifest } from "@domains/corpus";
import type { CoverageSnapshot } from "./types";

export type CoverageEngine = {
  readonly compute: (workspace: VoiceWorkspace, corpus: CorpusManifest) => CoverageSnapshot;
};
