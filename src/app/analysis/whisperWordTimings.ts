import type { WhisperWordTiming } from "./types";

export function normalizeWhisperWordTimings(
  chunks: readonly {
    readonly text: string;
    readonly timestamp: readonly (number | null)[];
  }[],
  durationMs: number,
): readonly WhisperWordTiming[] {
  const timings: WhisperWordTiming[] = [];
  const boundedDurationMs = Math.max(0, Math.round(durationMs));
  let previousEndMs = 0;

  for (const chunk of chunks) {
    const word = chunk.text.trim();
    const rawStart = chunk.timestamp[0];
    const rawEnd = chunk.timestamp[1];

    if (
      word.length === 0 ||
      rawStart === null ||
      rawEnd === null ||
      !Number.isFinite(rawStart) ||
      !Number.isFinite(rawEnd)
    ) {
      continue;
    }

    const startMs = Math.max(
      previousEndMs,
      Math.min(boundedDurationMs, Math.round(rawStart * 1000)),
    );
    const endMs = Math.max(
      startMs,
      Math.min(boundedDurationMs, Math.round(rawEnd * 1000)),
    );

    if (endMs <= startMs) {
      continue;
    }

    timings.push({
      word,
      startMs,
      endMs,
      source: "whisper_attention_timestamp",
    });
    previousEndMs = endMs;
  }

  return timings;
}
