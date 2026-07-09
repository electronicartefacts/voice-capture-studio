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
  readonly wordCount: number;
};

export type LocalTextCorpus = {
  readonly corpus: CorpusManifest;
  readonly summary: LocalTextCorpusSummary;
};

export function createLocalTextCorpus(
  input: LocalTextCorpusInput,
): LocalTextCorpus | null {
  const segments = createPromptSegments(input.text);

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
      text: segment,
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
            input.mode === "dubbing" ? "Script de doublage" : "Master voix",
          description: sourceName ?? "Corpus local",
          prompts,
        },
      ],
    },
    summary: {
      promptCount: prompts.length,
      sourceName,
      wordCount: segments.reduce(
        (total, segment) => total + countWords(segment),
        0,
      ),
    },
  };
}

export function createPromptSegments(text: string): readonly string[] {
  const normalizedText = normalizeCorpusText(text);

  if (normalizedText.length === 0) {
    return [];
  }

  const lineSegments = normalizedText
    .split("\n")
    .map(cleanSegment)
    .filter(isUsableSegment);
  const hasScriptLikeLineBreaks = lineSegments.length >= 3;
  const rawSegments = hasScriptLikeLineBreaks
    ? lineSegments
    : splitProseIntoSentences(normalizedText.replace(/\n+/g, " "));

  return rawSegments.flatMap(splitLongSegment).slice(0, 80);
}

function createPrompt(input: {
  readonly hash: string;
  readonly index: number;
  readonly language: LanguageCode;
  readonly mode: LocalCorpusMode;
  readonly text: string;
}): PromptDefinition {
  const words = countWords(input.text);
  const modeLabel = input.mode === "dubbing" ? "Doublage" : "Master voix";
  const promptId =
    `prompt.${input.language}.${input.mode}.${input.hash}.${String(input.index + 1).padStart(3, "0")}` as PromptId;
  const minDurationMs = Math.max(900, Math.round(words * 260));
  const maxDurationMs = Math.max(minDurationMs + 1100, Math.round(words * 920));

  return {
    id: promptId,
    text: input.text,
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
    .replace(/\s+/g, " ")
    .trim();
}

function isUsableSegment(segment: string): boolean {
  return countWords(segment) >= 2;
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
