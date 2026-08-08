import {
  createTimedTextDocument,
  serializeTimedText,
  type TimedTextDocument,
  type TimedTextExportFormat,
  type TimedTextSource,
  type TimedTextWordInput,
} from "../../domains/timedText/index";
import type { RecordedTake } from "@domains/sessions";
import { createReviewWordTimings } from "../audio/reviewWordTimings";

export type TimedTextExportArtifact = {
  readonly format: TimedTextExportFormat;
  readonly label: string;
  readonly description: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly text: string;
};

export const TIMED_TEXT_EXPORT_FORMATS: readonly TimedTextExportFormat[] = [
  "lrc",
  "enhanced-lrc",
  "srt",
  "vtt",
  "csv",
];

export function createTakeTimedTextDocument(input: {
  readonly language: string;
  readonly take: RecordedTake;
}): TimedTextDocument | null {
  return createTimedTextDocument({
    language: input.language,
    source: takeTimingSource(input.take),
    title: fileStem(input.take.fileName),
    words: createReviewWordTimings(input.take).map((word) => ({
      word: word.word,
      startMs: word.startMs,
      endMs: word.endMs,
      confidence: findWordConfidence(input.take, word.word, word.startMs),
    })),
  });
}

export function createStandaloneTimedTextDocument(input: {
  readonly language: string;
  readonly metadata: Record<string, unknown> | null;
}): TimedTextDocument | null {
  if (input.metadata === null) return null;
  const timing = readObject(input.metadata.timing);
  const words = readTimedWords(timing?.words);
  if (words.length === 0) return null;
  const analysis = readObject(input.metadata.localAcousticAnalysis);
  const source: TimedTextSource =
    analysis !== null
      ? "local_acoustic_analysis"
      : timing?.source === "browser_live_alignment"
        ? "browser_live_alignment"
        : "text_derived_estimate";
  return createTimedTextDocument({
    language: input.language,
    source,
    title:
      typeof input.metadata.fileName === "string"
        ? fileStem(input.metadata.fileName)
        : null,
    words,
  });
}

export function createWordListTimedTextDocument(input: {
  readonly language: string;
  readonly title: string;
  readonly words: readonly TimedTextWordInput[];
}): TimedTextDocument | null {
  return createTimedTextDocument({
    language: input.language,
    source: "local_acoustic_analysis",
    title: fileStem(input.title),
    words: input.words,
  });
}

export function createTimedTextExportArtifact(input: {
  readonly baseName: string;
  readonly document: TimedTextDocument;
  readonly format: TimedTextExportFormat;
}): TimedTextExportArtifact {
  const definition = formatDefinition(input.format);
  return {
    format: input.format,
    label: definition.label,
    description: `${definition.description} · ${describeTimingSource(input.document.source)}`,
    fileName: `${safeFileStem(input.baseName)}.${definition.suffix}`,
    mimeType: definition.mimeType,
    text: serializeTimedText(input.document, input.format),
  };
}

export function describeTimingSource(source: TimedTextSource): string {
  if (source === "external_forced_alignment")
    return "alignement acoustique importé";
  if (source === "local_acoustic_analysis") return "analyse acoustique locale";
  if (source === "browser_live_alignment") return "suivi vocal en direct";
  if (source === "imported_source") return "repères de la source";
  return "timing estimé à vérifier";
}

function takeTimingSource(take: RecordedTake): TimedTextSource {
  if ((take.timing.forcedAlignment?.words.length ?? 0) > 0) {
    return "external_forced_alignment";
  }
  if ((take.timing.liveAlignment?.words.length ?? 0) > 0) {
    return "browser_live_alignment";
  }
  if ((take.timing.localAcousticAnalysis?.words.length ?? 0) > 0) {
    return "local_acoustic_analysis";
  }
  return "text_derived_estimate";
}

function findWordConfidence(
  take: RecordedTake,
  word: string,
  startMs: number,
): number | null {
  const candidates = [
    ...(take.timing.forcedAlignment?.words ?? []),
    ...(take.timing.liveAlignment?.words ?? []),
    ...take.timing.words,
  ];
  const match = candidates.find(
    (candidate) =>
      candidate.word === word && Math.abs(candidate.startMs - startMs) <= 40,
  );
  return match?.confidence ?? null;
}

function readTimedWords(value: unknown): readonly TimedTextWordInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const word = readObject(entry);
    if (
      word === null ||
      typeof word.word !== "string" ||
      typeof word.startMs !== "number" ||
      typeof word.endMs !== "number"
    ) {
      return [];
    }
    return [
      {
        word: word.word,
        startMs: word.startMs,
        endMs: word.endMs,
        confidence:
          typeof word.confidence === "number" ? word.confidence : null,
      },
    ];
  });
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatDefinition(format: TimedTextExportFormat): {
  readonly description: string;
  readonly label: string;
  readonly mimeType: string;
  readonly suffix: string;
} {
  if (format === "lrc") {
    return {
      label: "Paroles synchronisées",
      description: "LRC compatible, ligne par ligne",
      mimeType: "text/plain;charset=utf-8",
      suffix: "lrc",
    };
  }
  if (format === "enhanced-lrc") {
    return {
      label: "Karaoké mot par mot",
      description: "Enhanced LRC avec repères par mot",
      mimeType: "text/plain;charset=utf-8",
      suffix: "enhanced.lrc",
    };
  }
  if (format === "srt") {
    return {
      label: "Sous-titres SRT",
      description: "Sous-titres avec débuts et fins explicites",
      mimeType: "application/x-subrip;charset=utf-8",
      suffix: "srt",
    };
  }
  if (format === "vtt") {
    return {
      label: "Sous-titres WebVTT",
      description: "Sous-titres adaptés au web",
      mimeType: "text/vtt;charset=utf-8",
      suffix: "vtt",
    };
  }
  return {
    label: "Données d'analyse",
    description: "CSV mot par mot avec provenance du timing",
    mimeType: "text/csv;charset=utf-8",
    suffix: "timeline.csv",
  };
}

function safeFileStem(value: string): string {
  return (
    fileStem(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^a-zA-Z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 96) || "voice-capture"
  );
}

function fileStem(value: string): string {
  return value.replace(/\.[^.]+$/u, "");
}
