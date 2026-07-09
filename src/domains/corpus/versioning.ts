export type CorpusCompatibilityPolicy = {
  readonly stableIdsRequired: true;
  readonly workspaceStoresCorpusCopy: false;
  readonly breakingChangesRequireMajorVersion: true;
  readonly promptRemovalKeepsTombstone: true;
};

export const corpusCompatibilityPolicy: CorpusCompatibilityPolicy = {
  stableIdsRequired: true,
  workspaceStoresCorpusCopy: false,
  breakingChangesRequireMajorVersion: true,
  promptRemovalKeepsTombstone: true,
};
