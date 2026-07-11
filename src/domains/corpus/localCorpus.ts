import type { LanguageCode, Semver } from "@shared/index";
import type {
  CorpusId,
  CorpusManifest,
  IntentionId,
  PromptDefinition,
  PromptId,
  ScenarioId,
} from "./types";

export type LocalCorpusMode = "dubbing" | "mastering";

export type LocalTextCorpusInput = {
  readonly mode: LocalCorpusMode;
  readonly text: string;
  readonly language: LanguageCode;
  readonly sourceName?: string | null;
};

export type LocalTextCorpusSummary = {
  readonly promptCount: number;
  readonly sourceName: string | null;
  readonly timedPromptCount: number;
  readonly wordCount: number;
};

export type LocalTextCorpus = {
  readonly corpus: CorpusManifest;
  readonly summary: LocalTextCorpusSummary;
};

export type LocalCorpusSnapshot = {
  readonly corpusId: CorpusId;
  readonly mode: LocalCorpusMode;
  readonly language: LanguageCode;
  readonly sourceName: string | null;
  readonly text: string;
};

type PromptSegment = {
  readonly text: string;
  readonly sourceTiming?: {
    readonly startMs: number;
    readonly endMs: number;
  };
};

export function createLocalTextCorpus(
  input: LocalTextCorpusInput,
): LocalTextCorpus | null {
  const segments = createPromptSegmentsWithTiming(input.text, input.sourceName);

  if (segments.length === 0) {
    return null;
  }

  const normalizedText = normalizeCorpusText(input.text);
  const hash = hashCorpusText(
    `${input.mode}:${input.language}:${normalizedText}`,
  );
  const sourceName = normalizeSourceName(input.sourceName);
  const scenarioId =
    `scenario.${input.language}.${input.mode}.${hash}` as ScenarioId;
  const prompts = segments.map((segment, index) =>
    createPrompt({
      hash,
      index,
      language: input.language,
      mode: input.mode,
      text: segment.text,
      sourceTiming: segment.sourceTiming,
    }),
  );

  return {
    corpus: {
      id: `corpus.local.${input.mode}.${hash}` as CorpusId,
      version: "0.1.0" as Semver,
      languages: [input.language],
      scenarios: [
        {
          id: scenarioId,
          language: input.language,
          title:
            input.mode === "dubbing"
              ? "Script de doublage"
              : "Interprétation voix",
          description: sourceName ?? "Corpus local",
          prompts,
        },
      ],
    },
    summary: {
      promptCount: prompts.length,
      sourceName,
      timedPromptCount: prompts.filter(
        (prompt) => prompt.sourceTiming !== undefined,
      ).length,
      wordCount: segments.reduce(
        (total, segment) => total + countWords(segment.text),
        0,
      ),
    },
  };
}

export function createPromptSegments(
  text: string,
  sourceName?: string | null,
): readonly string[] {
  return createPromptSegmentsWithTiming(text, sourceName).map(
    (segment) => segment.text,
  );
}

function createPromptSegmentsWithTiming(
  text: string,
  sourceName?: string | null,
): readonly PromptSegment[] {
  const normalizedText = normalizeCorpusText(text);

  if (normalizedText.length === 0) {
    return [];
  }

  const subtitleSegments = isSubtitleText(normalizedText, sourceName)
    ? parseSubtitleSegments(normalizedText)
    : [];
  const lineSegments = (
    subtitleSegments.length > 0
      ? subtitleSegments
      : normalizedText.split("\n").map((segment) => ({ text: segment }))
  )
    .map((segment) => ({ ...segment, text: cleanSegment(segment.text) }))
    .filter((segment) => isUsableSegment(segment.text));
  const hasScriptLikeLineBreaks = lineSegments.length >= 3;
  const rawSegments: readonly PromptSegment[] =
    subtitleSegments.length > 0 || hasScriptLikeLineBreaks
      ? lineSegments
      : splitProseIntoSentences(normalizedText.replace(/\n+/g, " ")).map(
          (segment) => ({ text: segment }),
        );
  const strippedText = stripSpeakerLabels(
    rawSegments.map((segment) => segment.text),
  );

  return rawSegments.flatMap((segment, index) =>
    splitLongSegment(strippedText[index] ?? segment.text).map((text) => ({
      text,
      ...(segment.sourceTiming === undefined
        ? {}
        : { sourceTiming: segment.sourceTiming }),
    })),
  );
}

function createPrompt(input: {
  readonly hash: string;
  readonly index: number;
  readonly language: LanguageCode;
  readonly mode: LocalCorpusMode;
  readonly sourceTiming?: PromptSegment["sourceTiming"];
  readonly text: string;
}): PromptDefinition {
  const words = countWords(input.text);
  const modeLabel =
    input.mode === "dubbing" ? "Doublage" : "Interprétation voix";
  const promptId =
    `prompt.${input.language}.${input.mode}.${input.hash}.${String(input.index + 1).padStart(3, "0")}` as PromptId;
  const minDurationMs = Math.max(900, Math.round(words * 260));
  const maxDurationMs = Math.max(minDurationMs + 1100, Math.round(words * 920));

  return {
    id: promptId,
    text: input.text,
    ...(input.sourceTiming === undefined
      ? {}
      : { sourceTiming: input.sourceTiming }),
    intention: {
      id: `intent.${input.mode}.local_text` as IntentionId,
      primary:
        input.mode === "dubbing" ? "cinematic_dialogue" : "music_master_take",
      secondary:
        input.mode === "dubbing"
          ? ["sync", "scene_intent", "natural_acting"]
          : ["headphone_return", "steady_delivery", "music_context"],
      useCase: input.mode,
      label: modeLabel,
      emotion: {
        valence: 0,
        arousal: input.mode === "dubbing" ? 0.42 : 0.34,
        dominance: 0.48,
        labels:
          input.mode === "dubbing" ? ["scene", "dialogue"] : ["pose", "rythme"],
      },
    },
    delivery: {
      tone:
        input.mode === "dubbing"
          ? "jeu naturel, proche de la scène"
          : "voix stable avec retour musical au casque",
      pace: "natural",
      energy: "medium",
      articulation: input.mode === "dubbing" ? "clear_natural" : "precise",
      projection: input.mode === "dubbing" ? "conversational" : "presented",
      smile: "none",
      breathiness: "low",
      pauseStyle: input.mode === "dubbing" ? "thoughtful" : "structured",
    },
    direction: {
      context:
        input.mode === "dubbing"
          ? "Lecture d'un script local pour une prise de doublage."
          : "Lecture d'un texte local sur un retour musical au casque.",
      directorNote:
        input.mode === "dubbing"
          ? "Garde l'intention de la scène et évite la lecture plate."
          : "Reste calé sur le tempo sans laisser la musique repasser dans le micro.",
      pauseInstruction:
        input.mode === "dubbing"
          ? "Respecte les respirations naturelles du dialogue."
          : "Respire avant la phrase et garde une fin propre.",
      emphasis: createEmphasisHints(input.text),
      avoid:
        input.mode === "dubbing"
          ? ["surjeu", "diction artificielle", "rupture d'intention"]
          : ["repisse casque", "niveau instable", "attaque trop dure"],
    },
    prosody: {
      targetPace: "naturel",
      targetPitch: "natural",
      pitchVariation: input.mode === "dubbing" ? "high" : "medium",
      phraseAttack: "clean",
      sentenceEnding: "mixed",
      intimacy: input.mode === "dubbing" ? "close" : "neutral",
    },
    phonetics: {
      focus: ["diction", "respiration", "continuité"],
      coverage: createPhoneticCoverage(input.language, input.text),
      difficulty: words > 26 ? "high" : words > 14 ? "medium" : "low",
    },
    qa: {
      minDurationMs,
      maxDurationMs,
      rejectIf: [
        "clipping",
        "unstable_noise",
        "reverb",
        "electrical_hum",
        "variable_mic_distance",
        "truncated_phrase",
        "transcript_mismatch",
        "forced_voice",
        "intent_mismatch",
      ],
    },
    tags: ["local-corpus", input.mode],
  };
}

function splitProseIntoSentences(text: string): readonly string[] {
  const matches = text.match(/[^.!?;:]+[.!?;:]?/g) ?? [text];
  const segments: string[] = [];
  let current = "";

  for (const match of matches) {
    const sentence = cleanSegment(match);

    if (!isUsableSegment(sentence)) {
      continue;
    }

    const candidate =
      current.length === 0 ? sentence : `${current} ${sentence}`;
    const candidateWordCount = countWords(candidate);

    if (candidateWordCount <= 24) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      segments.push(current);
    }

    current = sentence;
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

function splitLongSegment(segment: string): readonly string[] {
  const words = segment.split(/\s+/).filter(Boolean);

  if (words.length <= 32) {
    return [segment];
  }

  const chunks: string[] = [];

  for (let index = 0; index < words.length; index += 24) {
    chunks.push(words.slice(index, index + 24).join(" "));
  }

  return chunks;
}

function normalizeCorpusText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanSegment(segment: string): string {
  return segment
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsableSegment(segment: string): boolean {
  return countWords(segment) >= 1;
}

function isSubtitleText(text: string, sourceName?: string | null): boolean {
  const extension = sourceName?.toLowerCase().split(".").at(-1) ?? "";

  return (
    extension === "srt" ||
    extension === "vtt" ||
    /^WEBVTT(?:\s|$)/u.test(text) ||
    text.split("\n").some(isSubtitleTimingLine)
  );
}

function isSubtitleTimingLine(line: string): boolean {
  return /^\s*(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3}\s+-->\s+(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3}(?:\s|$)/u.test(
    line,
  );
}

function parseSubtitleSegments(text: string): readonly PromptSegment[] {
  const lines = text.replace(/^\uFEFF/u, "").split("\n");
  const segments: PromptSegment[] = [];
  let current: string[] = [];
  let currentTiming: PromptSegment["sourceTiming"];
  let inCue = false;
  let skipBlock = false;

  const flush = () => {
    const segment = cleanSubtitleText(current.join(" "));

    if (segment.length > 0) {
      segments.push({
        text: segment,
        ...(currentTiming === undefined ? {} : { sourceTiming: currentTiming }),
      });
    }

    current = [];
    currentTiming = undefined;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) {
      if (inCue) {
        flush();
      }
      inCue = false;
      skipBlock = false;
      continue;
    }

    if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/iu.test(line)) {
      flush();
      inCue = false;
      skipBlock = true;
      continue;
    }

    if (isSubtitleTimingLine(line)) {
      flush();
      inCue = true;
      skipBlock = false;
      currentTiming = parseSubtitleTiming(line) ?? undefined;
      continue;
    }

    if (!inCue || skipBlock) {
      continue;
    }

    current.push(line);
  }

  if (inCue) {
    flush();
  }

  return segments;
}

function parseSubtitleTiming(
  line: string,
): PromptSegment["sourceTiming"] | null {
  const [rawStart, rawEnd] = line.split("-->").map((part) => part.trim());
  const startMs = parseSubtitleTimestamp(rawStart ?? "");
  const endMs = parseSubtitleTimestamp((rawEnd ?? "").split(/\s+/u)[0] ?? "");

  return startMs === null || endMs === null || endMs <= startMs
    ? null
    : { startMs, endMs };
}

function parseSubtitleTimestamp(value: string): number | null {
  const match = value.match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{3})$/u);

  if (match === null) {
    return null;
  }

  const [, hours = "0", minutes = "0", seconds = "0", milliseconds = "0"] =
    match;

  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(milliseconds)
  );
}

function cleanSubtitleText(text: string): string {
  return decodeBasicEntities(
    text
      .replace(/<v(?:\s+[^>]*)?>/giu, "")
      .replace(/<\/?[^>]+>/gu, "")
      .trim(),
  );
}

function stripSpeakerLabels(segments: readonly string[]): readonly string[] {
  const labelCounts = new Map<string, number>();

  for (const segment of segments) {
    const label = readSpeakerLabel(segment);

    if (label !== null) {
      labelCounts.set(label.key, (labelCounts.get(label.key) ?? 0) + 1);
    }
  }

  return segments.map((segment) => {
    const label = readSpeakerLabel(segment);

    if (
      label === null ||
      !labelCounts.has(label.key) ||
      ((labelCounts.get(label.key) ?? 0) < 2 && !label.isUppercase)
    ) {
      return segment;
    }

    return segment.slice(label.endIndex).trim();
  });
}

function readSpeakerLabel(segment: string): {
  readonly endIndex: number;
  readonly isUppercase: boolean;
  readonly key: string;
} | null {
  const match = segment.match(
    /^\s*([\p{L}\p{N}][\p{L}\p{N} _-]{0,31})\s*:\s+/u,
  );

  if (match === null || match.index === undefined) {
    return null;
  }

  const label = match[1].trim();
  const letters = label.replace(/[^\p{L}]/gu, "");

  if (letters.length === 0) {
    return null;
  }

  return {
    endIndex: match.index + match[0].length,
    isUppercase: letters === letters.toLocaleUpperCase(),
    key: label.toLocaleLowerCase(),
  };
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'");
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function createEmphasisHints(text: string): readonly string[] {
  const words = text
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 5);

  return Array.from(new Set(words)).slice(0, 3);
}

function createPhoneticCoverage(
  language: LanguageCode,
  text: string,
): readonly string[] {
  const normalizedText = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const targets = [`${language}_custom_text`];

  if (/[aeiouy]/.test(normalizedText)) {
    targets.push(`${language}_vowels`);
  }

  if (/[szcj]/.test(normalizedText)) {
    targets.push(`${language}_sibilants`);
  }

  if (/[pbtdkg]/.test(normalizedText)) {
    targets.push(`${language}_plosives`);
  }

  if (/[mn]/.test(normalizedText)) {
    targets.push(`${language}_nasals`);
  }

  return targets;
}

function normalizeSourceName(
  sourceName: string | null | undefined,
): string | null {
  const trimmedName = sourceName?.trim() ?? "";

  return trimmedName.length === 0 ? null : trimmedName;
}

function hashCorpusText(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}
