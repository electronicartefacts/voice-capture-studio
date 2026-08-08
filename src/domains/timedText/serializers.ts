import type { TimedTextDocument } from "./types";

export type TimedTextExportFormat =
  "lrc" | "enhanced-lrc" | "srt" | "vtt" | "csv";

export function serializeTimedText(
  document: TimedTextDocument,
  format: TimedTextExportFormat,
): string {
  if (format === "lrc") return serializeLrc(document, false);
  if (format === "enhanced-lrc") return serializeLrc(document, true);
  if (format === "srt") return serializeSrt(document);
  if (format === "vtt") return serializeVtt(document);
  return serializeCsv(document);
}

export function serializeLrc(
  document: TimedTextDocument,
  enhanced: boolean,
): string {
  const metadata = [
    document.title === null ? null : `[ti:${sanitizeMetadata(document.title)}]`,
    "[by:Voice Capture Studio]",
    `[offset:${Math.round(document.offsetMs)}]`,
  ].filter((line): line is string => line !== null);
  const lyrics = document.lines.map((line) => {
    const lineTimestamp = `[${formatLrcTimestamp(line.startMs)}]`;
    if (!enhanced) return `${lineTimestamp}${line.text}`;
    return `${lineTimestamp}${line.words
      .map((word) => `<${formatLrcTimestamp(word.startMs)}>${word.text}`)
      .join(" ")}`;
  });
  return `${[...metadata, "", ...lyrics].join("\n")}\n`;
}

export function serializeSrt(document: TimedTextDocument): string {
  return `${document.lines
    .map(
      (line, index) =>
        `${index + 1}\n${formatSubtitleTimestamp(line.startMs, ",")} --> ${formatSubtitleTimestamp(line.endMs, ",")}\n${line.text}`,
    )
    .join("\n\n")}\n`;
}

export function serializeVtt(document: TimedTextDocument): string {
  const cues = document.lines.map(
    (line) =>
      `${formatSubtitleTimestamp(line.startMs, ".")} --> ${formatSubtitleTimestamp(line.endMs, ".")}\n${line.text}`,
  );
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export function serializeCsv(document: TimedTextDocument): string {
  const rows = [
    "line_index,word_index,text,start_ms,end_ms,confidence,timing_source",
  ];
  document.lines.forEach((line, lineIndex) => {
    line.words.forEach((word, wordIndex) => {
      rows.push(
        [
          lineIndex + 1,
          wordIndex + 1,
          csvCell(word.text),
          word.startMs,
          word.endMs,
          word.confidence ?? "",
          document.source,
        ].join(","),
      );
    });
  });
  return `${rows.join("\n")}\n`;
}

function formatLrcTimestamp(milliseconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(milliseconds / 10));
  const minutes = Math.floor(totalCentiseconds / 6_000);
  const seconds = Math.floor((totalCentiseconds % 6_000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function formatSubtitleTimestamp(
  milliseconds: number,
  separator: "," | ".",
): string {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const remainder = total % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(remainder).padStart(3, "0")}`;
}

function sanitizeMetadata(value: string): string {
  return value
    .replace(/[\u005b\u005d\r\n]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function csvCell(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`;
}
