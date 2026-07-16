import type { LocalAnalysisProgress } from "../analysis/types";

export type LoadingWaveSnapshot = {
  readonly active: boolean;
  readonly key: string;
  readonly label: string;
  readonly progress: number;
  readonly opacity: number;
};

type LoadingWaveOperation = {
  readonly id: string;
  readonly label: string;
  readonly startedAt: number;
  sequence: number;
  updatedAt: number;
  progress: number | null;
  completedAt: number | null;
};

const COMPLETION_HOLD_MS = 900;
const operations = new Map<string, LoadingWaveOperation>();
let operationSequence = 0;

export function beginLoadingWave(
  id: string,
  label: string,
  progress: number | null = null,
): void {
  const now = nowMs();
  operations.set(id, {
    id,
    label,
    startedAt: now,
    sequence: ++operationSequence,
    updatedAt: now,
    progress: progress === null ? null : clampUnit(progress),
    completedAt: null,
  });
}

export function updateLoadingWave(
  id: string,
  progress: number | null,
  label?: string,
): void {
  const operation = operations.get(id);

  if (operation === undefined || operation.completedAt !== null) return;

  operation.updatedAt = nowMs();
  operation.sequence = ++operationSequence;
  operation.progress =
    progress === null
      ? operation.progress
      : Math.max(operation.progress ?? 0, clampUnit(progress));

  if (label !== undefined) {
    operations.set(id, { ...operation, label });
  }
}

export function finishLoadingWave(id: string): void {
  const operation = operations.get(id);

  if (operation === undefined) return;

  const now = nowMs();
  operation.updatedAt = now;
  operation.sequence = ++operationSequence;
  operation.progress = 1;
  operation.completedAt = now;
}

export function cancelLoadingWave(id: string): void {
  operations.delete(id);
}

export async function runWithLoadingWave<T>(
  id: string,
  label: string,
  task: () => Promise<T>,
): Promise<T> {
  beginLoadingWave(id, label);

  try {
    const result = await task();
    finishLoadingWave(id);
    return result;
  } catch (error) {
    cancelLoadingWave(id);
    throw error;
  }
}

export function getLoadingWaveSnapshot(now = nowMs()): LoadingWaveSnapshot {
  for (const [id, operation] of operations) {
    if (
      operation.completedAt !== null &&
      now - operation.completedAt > COMPLETION_HOLD_MS
    ) {
      operations.delete(id);
    }
  }

  const operation = [...operations.values()].sort(
    (left, right) =>
      right.updatedAt - left.updatedAt || right.sequence - left.sequence,
  )[0];

  if (operation === undefined) {
    return { active: false, key: "", label: "", progress: 0, opacity: 0 };
  }

  const progress =
    operation.progress ??
    Math.min(
      0.9,
      0.035 + (1 - Math.exp(-(now - operation.startedAt) / 7_500)) * 0.865,
    );
  const opacity =
    operation.completedAt === null
      ? 1
      : clampUnit(1 - (now - operation.completedAt) / COMPLETION_HOLD_MS);

  return {
    active: true,
    key: `${operation.id}:${operation.startedAt}`,
    label: operation.label,
    progress: clampUnit(progress),
    opacity,
  };
}

export function resetLoadingWaveForTests(): void {
  operations.clear();
  operationSequence = 0;
}

export function mapLocalAnalysisToLoadingProgress(
  progress: LocalAnalysisProgress,
): number {
  if (progress.stage === "loading-model") {
    return 0.04 + clampUnit(progress.progressPercent / 100) * 0.34;
  }
  if (progress.stage === "transcribing") return 0.52;
  if (progress.stage === "detecting-speech") return 0.76;
  if (progress.stage === "enhancing-vocals") return 0.82;
  return 0.94;
}

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
