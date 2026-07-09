import type { CaptureSession } from "@domains/sessions";
import type { CorpusManifest, PromptId, ScenarioId } from "@domains/corpus";
import type { IsoDateTime } from "@shared/index";
import type { CorpusProgressSnapshot, VoiceWorkspace } from "./types";

type ProgressAccumulator = {
  readonly corpusId: CorpusProgressSnapshot["corpusId"];
  readonly speakerId: CorpusProgressSnapshot["speakerId"];
  readonly language: CorpusProgressSnapshot["language"];
  completedPrompts: PromptId[];
};

export function completePlannedSession(
  workspace: VoiceWorkspace,
  corpus: CorpusManifest,
  session: CaptureSession,
  now: Date,
): VoiceWorkspace {
  const completedAt = now.toISOString() as IsoDateTime;

  return reconcileWorkspaceProgress(
    {
      ...workspace,
      updatedAt: completedAt,
      sessions: mergeUnique(workspace.sessions, [session.id]),
      capturedSessions: upsertSession(workspace.capturedSessions ?? [], {
        ...session,
        completedAt,
      }),
    },
    corpus,
  );
}

export function reconcileWorkspaceProgress(
  workspace: VoiceWorkspace,
  corpus: CorpusManifest,
): VoiceWorkspace {
  const existingProgress = workspace.corpusProgress.filter(isProgressSnapshot);
  const nextCorpusProgress = [
    ...existingProgress.filter((progress) => progress.corpusId !== corpus.id),
    ...rebuildProgressForCorpus(workspace, corpus, existingProgress),
  ];

  if (areProgressSnapshotsEqual(workspace.corpusProgress, nextCorpusProgress)) {
    return workspace;
  }

  return {
    ...workspace,
    corpusProgress: nextCorpusProgress,
  };
}

function upsertSession(
  sessions: readonly CaptureSession[],
  incomingSession: CaptureSession,
): readonly CaptureSession[] {
  return [
    ...sessions.filter((session) => session.id !== incomingSession.id),
    incomingSession,
  ];
}

function rebuildProgressForCorpus(
  workspace: VoiceWorkspace,
  corpus: CorpusManifest,
  existingProgress: readonly CorpusProgressSnapshot[],
): readonly CorpusProgressSnapshot[] {
  const accumulators = new Map<string, ProgressAccumulator>();
  const accumulatorKeys: string[] = [];

  for (const progress of existingProgress) {
    if (progress.corpusId !== corpus.id) {
      continue;
    }

    const accumulator = getProgressAccumulator(
      accumulators,
      accumulatorKeys,
      progress,
    );
    accumulator.completedPrompts = mergeUnique(
      accumulator.completedPrompts,
      progress.completedPrompts.filter(isNonEmptyString) as PromptId[],
    );
  }

  for (const session of workspace.capturedSessions) {
    if (!isSessionProgressSource(session, corpus.id)) {
      continue;
    }

    const accumulator = getProgressAccumulator(
      accumulators,
      accumulatorKeys,
      session,
    );
    accumulator.completedPrompts = mergeUnique(
      accumulator.completedPrompts,
      session.takes.filter(isKeeperTake).map((take) => take.promptId),
    );
  }

  return accumulatorKeys.map((key) => {
    const accumulator = accumulators.get(key);

    if (accumulator === undefined) {
      throw new Error(`Missing progress accumulator ${key}`);
    }

    return {
      corpusId: accumulator.corpusId,
      corpusVersionSeen: corpus.version,
      speakerId: accumulator.speakerId,
      language: accumulator.language,
      completedScenarios: computeCompletedScenarios(
        corpus,
        accumulator.completedPrompts,
      ),
      completedPrompts: accumulator.completedPrompts,
    };
  });
}

function getProgressAccumulator(
  accumulators: Map<string, ProgressAccumulator>,
  accumulatorKeys: string[],
  source: Pick<CorpusProgressSnapshot, "corpusId" | "speakerId" | "language">,
): ProgressAccumulator {
  const key = createProgressKey(source);
  const existing = accumulators.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const accumulator: ProgressAccumulator = {
    corpusId: source.corpusId,
    speakerId: source.speakerId,
    language: source.language,
    completedPrompts: [],
  };

  accumulators.set(key, accumulator);
  accumulatorKeys.push(key);

  return accumulator;
}

function createProgressKey(
  source: Pick<CorpusProgressSnapshot, "corpusId" | "speakerId" | "language">,
): string {
  return `${source.corpusId}\u0000${source.speakerId}\u0000${source.language}`;
}

function computeCompletedScenarios(
  corpus: CorpusManifest,
  completedPromptIds: readonly PromptId[],
): readonly ScenarioId[] {
  return corpus.scenarios
    .filter((scenario) =>
      scenario.prompts.every((prompt) =>
        completedPromptIds.includes(prompt.id),
      ),
    )
    .map((scenario) => scenario.id);
}

function mergeUnique<TValue>(
  existing: readonly TValue[],
  incoming: readonly TValue[],
) {
  return Array.from(new Set([...existing, ...incoming]));
}

function isProgressSnapshot(value: unknown): value is CorpusProgressSnapshot {
  return (
    isRecord(value) &&
    isNonEmptyString(value.corpusId) &&
    isNonEmptyString(value.corpusVersionSeen) &&
    isNonEmptyString(value.speakerId) &&
    isNonEmptyString(value.language) &&
    Array.isArray(value.completedScenarios) &&
    Array.isArray(value.completedPrompts)
  );
}

function isSessionProgressSource(
  value: unknown,
  corpusId: CorpusManifest["id"],
): value is Pick<CaptureSession, "corpusId" | "speakerId" | "language"> & {
  readonly takes: readonly unknown[];
} {
  return (
    isRecord(value) &&
    value.corpusId === corpusId &&
    isNonEmptyString(value.speakerId) &&
    isNonEmptyString(value.language) &&
    Array.isArray(value.takes)
  );
}

function isKeeperTake(value: unknown): value is {
  readonly promptId: PromptId;
  readonly review: { readonly rating: "keeper" };
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.promptId) &&
    isRecord(value.review) &&
    value.review.rating === "keeper"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function areProgressSnapshotsEqual(
  left: readonly CorpusProgressSnapshot[],
  right: readonly CorpusProgressSnapshot[],
): boolean {
  return (
    left.length === right.length &&
    left.every((leftSnapshot, index) => {
      const rightSnapshot = right[index];

      return (
        isProgressSnapshot(leftSnapshot) &&
        rightSnapshot !== undefined &&
        leftSnapshot.corpusId === rightSnapshot.corpusId &&
        leftSnapshot.corpusVersionSeen === rightSnapshot.corpusVersionSeen &&
        leftSnapshot.speakerId === rightSnapshot.speakerId &&
        leftSnapshot.language === rightSnapshot.language &&
        areArraysEqual(
          leftSnapshot.completedScenarios,
          rightSnapshot.completedScenarios,
        ) &&
        areArraysEqual(
          leftSnapshot.completedPrompts,
          rightSnapshot.completedPrompts,
        )
      );
    })
  );
}

function areArraysEqual<TValue>(
  left: readonly TValue[],
  right: readonly TValue[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
