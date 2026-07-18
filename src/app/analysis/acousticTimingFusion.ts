import type {
  LocalAcousticAnalysis,
  PhraseTiming,
  RecordedTake,
  WordTiming,
} from "@domains/sessions";

type TimeAnchor = {
  readonly estimatedMs: number;
  readonly acousticMs: number;
};

/**
 * Promotes local acoustic evidence into the canonical take timing while
 * retaining prompt-derived token and phoneme links. Exact Whisper/Silero
 * matches become anchors; unmatched words and phonemes are time-warped between
 * those anchors instead of being discarded.
 */
export function applyLocalAcousticTiming(input: {
  readonly analysis: LocalAcousticAnalysis;
  readonly take: RecordedTake;
}): RecordedTake {
  const { analysis, take } = input;
  const anchors = createTimeAnchors(analysis, take.durationMs);
  const acousticByExpectedIndex = new Map(
    analysis.alignmentComparison.words.map((word) => [
      word.expectedIndex,
      { startMs: word.whisperStartMs, endMs: word.whisperEndMs },
    ]),
  );
  const words = take.timing.words.map((word, index) => {
    const exact = acousticByExpectedIndex.get(index);
    return mapWordTiming(word, exact, anchors, take.durationMs);
  });
  const phonemes = take.timing.phonemes?.map((phoneme) => ({
    ...phoneme,
    startMs: warpTime(phoneme.startMs, anchors, take.durationMs),
    endMs: warpTime(phoneme.endMs, anchors, take.durationMs),
  }));
  const alignment =
    take.timing.alignment === undefined
      ? undefined
      : {
          ...take.timing.alignment,
          words: take.timing.alignment.words.map((word, index) => {
            const timing = words[index];
            const wordPhonemes = word.phonemes.map((phoneme) => ({
              ...phoneme,
              startMs: warpTime(phoneme.startMs, anchors, take.durationMs),
              endMs: warpTime(phoneme.endMs, anchors, take.durationMs),
            }));
            return {
              ...word,
              startMs: timing?.startMs ?? word.startMs,
              endMs: timing?.endMs ?? word.endMs,
              phonemes: wordPhonemes,
            };
          }),
          phonemes: phonemes ?? take.timing.alignment.phonemes,
        };

  return {
    ...take,
    timing: {
      ...take.timing,
      words,
      ...(phonemes === undefined ? {} : { phonemes }),
      phrases: createAcousticPhraseTimings(
        take.transcript.spokenText,
        words,
        take.durationMs,
      ),
      ...(alignment === undefined ? {} : { alignment }),
      localAcousticAnalysis: analysis,
    },
  };
}

export function createAcousticPhraseTimings(
  text: string,
  words: readonly WordTiming[],
  durationMs: number,
): readonly PhraseTiming[] {
  const phrases = splitPhrases(text);
  if (phrases.length <= 1 || words.length === 0) {
    return [
      {
        text: text.trim(),
        startMs: words[0]?.startMs ?? 0,
        endMs: words.at(-1)?.endMs ?? durationMs,
      },
    ];
  }

  const counts = phrases.map((phrase) => countWords(phrase));
  const totalExpectedWords = counts.reduce((sum, count) => sum + count, 0);
  if (totalExpectedWords === 0) {
    return [{ text: text.trim(), startMs: 0, endMs: durationMs }];
  }

  let expectedOffset = 0;
  return phrases.map((phrase, phraseIndex) => {
    const startIndex = Math.min(
      words.length - 1,
      Math.round((expectedOffset / totalExpectedWords) * words.length),
    );
    expectedOffset += counts[phraseIndex];
    const endExclusive = Math.max(
      startIndex + 1,
      Math.round((expectedOffset / totalExpectedWords) * words.length),
    );
    const endIndex = Math.min(words.length - 1, endExclusive - 1);
    return {
      text: phrase,
      startMs: words[startIndex]?.startMs ?? 0,
      endMs: words[endIndex]?.endMs ?? durationMs,
    };
  });
}

function createTimeAnchors(
  analysis: LocalAcousticAnalysis,
  durationMs: number,
): readonly TimeAnchor[] {
  const firstSpeech = analysis.speechSegments[0];
  const lastSpeech = analysis.speechSegments.at(-1);
  const anchors: TimeAnchor[] = [
    {
      estimatedMs: 0,
      acousticMs: Math.max(0, (firstSpeech?.startMs ?? 0) - 55),
    },
    ...analysis.alignmentComparison.words.flatMap((word) => [
      {
        estimatedMs: word.estimatedStartMs,
        acousticMs: word.whisperStartMs,
      },
      {
        estimatedMs: word.estimatedEndMs,
        acousticMs: word.whisperEndMs,
      },
    ]),
    {
      estimatedMs: durationMs,
      acousticMs: Math.min(durationMs, (lastSpeech?.endMs ?? durationMs) + 45),
    },
  ];

  return anchors
    .sort((left, right) => left.estimatedMs - right.estimatedMs)
    .filter(
      (anchor, index, values) =>
        index === 0 || anchor.estimatedMs > values[index - 1].estimatedMs,
    );
}

function mapWordTiming(
  word: WordTiming,
  exact: { readonly startMs: number; readonly endMs: number } | undefined,
  anchors: readonly TimeAnchor[],
  durationMs: number,
): WordTiming {
  const startMs = clamp(
    Math.round(exact?.startMs ?? warpTime(word.startMs, anchors, durationMs)),
    0,
    durationMs,
  );
  const endMs = clamp(
    Math.round(exact?.endMs ?? warpTime(word.endMs, anchors, durationMs)),
    startMs,
    durationMs,
  );
  return {
    ...word,
    startMs,
    endMs,
    phonemes: word.phonemes?.map((phoneme) => ({
      ...phoneme,
      startMs: warpTime(phoneme.startMs, anchors, durationMs),
      endMs: warpTime(phoneme.endMs, anchors, durationMs),
    })),
  };
}

function warpTime(
  estimatedMs: number,
  anchors: readonly TimeAnchor[],
  durationMs: number,
): number {
  const nextIndex = anchors.findIndex(
    (anchor) => anchor.estimatedMs >= estimatedMs,
  );
  if (nextIndex <= 0)
    return clamp(anchors[0]?.acousticMs ?? estimatedMs, 0, durationMs);
  if (nextIndex === -1)
    return clamp(anchors.at(-1)?.acousticMs ?? estimatedMs, 0, durationMs);
  const previous = anchors[nextIndex - 1];
  const next = anchors[nextIndex];
  const span = next.estimatedMs - previous.estimatedMs;
  const progress = span <= 0 ? 0 : (estimatedMs - previous.estimatedMs) / span;
  return clamp(
    Math.round(
      previous.acousticMs + (next.acousticMs - previous.acousticMs) * progress,
    ),
    0,
    durationMs,
  );
}

function splitPhrases(text: string): readonly string[] {
  return (text.match(/[^.!?…]+(?:[.!?…]+|$)/gu) ?? [text])
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
