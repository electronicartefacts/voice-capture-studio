import { encodeWav24 } from "../audio/pcmAudio";
import { createZipBlobOffThread } from "../export/zipService";
import type { ZipEntryInput } from "../export/zipWriter";
import { analyzeDecodedAudio, decodeAudioToMono16k } from "./localTakeAnalysis";
import type { LocalAnalysisProgress, WhisperWordTiming } from "./types";

export const SEGMENTATION_SAMPLE_RATE = 16_000;

export type ImportedMediaSegmentationResult = {
  readonly archive: Blob;
  readonly fileName: string;
  readonly manifest: WordSegmentationManifest;
};

export type WordSegmentationManifest = {
  readonly schemaVersion: "voice.word_segmentation.v1";
  readonly createdAt: string;
  readonly source: {
    readonly fileName: string;
    readonly mediaType: string;
    readonly sizeBytes: number;
    readonly durationMs: number;
    readonly videoDiscarded: boolean;
  };
  readonly audio: {
    readonly sampleRateHz: 16000;
    readonly bitDepth: 24;
    readonly channels: 1;
    readonly format: "WAVE_PCM";
  };
  readonly transcription: {
    readonly engine: "whisper-tiny";
    readonly language: string;
    readonly transcript: string;
    readonly wordCount: number;
    readonly timingSource: "whisper_attention_timestamp";
  };
  readonly words: readonly WordAudioSegment[];
};

export type WordAudioSegment = {
  readonly index: number;
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  readonly audioPath: string;
};

export async function segmentImportedMedia(input: {
  readonly file: File;
  readonly language: string;
  readonly onProgress: (progress: LocalAnalysisProgress) => void;
  readonly now?: Date;
}): Promise<ImportedMediaSegmentationResult> {
  let audio: Float32Array;
  try {
    audio = await decodeAudioToMono16k(input.file);
  } catch {
    throw new Error(
      "La piste audio de ce média n'est pas décodable ici. Essaie un WAV, MP3, M4A, MP4 ou WebM compatible avec ce navigateur.",
    );
  }
  const durationMs = Math.round(
    (audio.length / SEGMENTATION_SAMPLE_RATE) * 1000,
  );
  const analysis = await analyzeDecodedAudio({
    audio: audio.slice(),
    expectedText: "",
    language: input.language,
    onProgress: input.onProgress,
  });

  if (analysis.whisperWords.length === 0) {
    throw new Error(
      "Aucun mot n'a pu être horodaté dans ce média. Vérifie la langue ou la présence d'une voix nette.",
    );
  }

  const words = createWordAudioSegments(analysis.whisperWords);
  const createdAt = (input.now ?? new Date()).toISOString();
  const manifest: WordSegmentationManifest = {
    schemaVersion: "voice.word_segmentation.v1",
    createdAt,
    source: {
      fileName: input.file.name,
      mediaType: input.file.type || "application/octet-stream",
      sizeBytes: input.file.size,
      durationMs,
      videoDiscarded: input.file.type.startsWith("video/"),
    },
    audio: {
      sampleRateHz: SEGMENTATION_SAMPLE_RATE,
      bitDepth: 24,
      channels: 1,
      format: "WAVE_PCM",
    },
    transcription: {
      engine: "whisper-tiny",
      language: input.language,
      transcript: analysis.transcript,
      wordCount: words.length,
      timingSource: "whisper_attention_timestamp",
    },
    words,
  };
  const entries: ZipEntryInput[] = [
    {
      path: "manifest.json",
      data: jsonBlob(manifest),
    },
    {
      path: "transcript.txt",
      data: new Blob([`${analysis.transcript.trim()}\n`], {
        type: "text/plain;charset=utf-8",
      }),
    },
    {
      path: "timeline.csv",
      data: new Blob([createTimelineCsv(words)], {
        type: "text/csv;charset=utf-8",
      }),
    },
    ...words.map((word) => ({
      path: word.audioPath,
      data: encodeWordSegment(audio, word),
    })),
  ];

  return {
    archive: await createZipBlobOffThread(entries),
    fileName: `${fileStem(input.file.name)}.decoupe-lexicale.zip`,
    manifest,
  };
}

export function createWordAudioSegments(
  timings: readonly WhisperWordTiming[],
): readonly WordAudioSegment[] {
  return timings.map((timing, index) => {
    const sequence = String(index + 1).padStart(4, "0");
    const word = safePathPart(timing.word) || "mot";

    return {
      index,
      word: timing.word,
      startMs: timing.startMs,
      endMs: timing.endMs,
      durationMs: timing.endMs - timing.startMs,
      audioPath: `audio/mots/${sequence}_${word}.wav`,
    };
  });
}

function encodeWordSegment(
  audio: Float32Array,
  segment: WordAudioSegment,
): Blob {
  const startSample = Math.max(
    0,
    Math.floor((segment.startMs / 1000) * SEGMENTATION_SAMPLE_RATE),
  );
  const endSample = Math.min(
    audio.length,
    Math.ceil((segment.endMs / 1000) * SEGMENTATION_SAMPLE_RATE),
  );

  return encodeWav24(
    audio.slice(startSample, endSample),
    SEGMENTATION_SAMPLE_RATE,
  );
}

function createTimelineCsv(words: readonly WordAudioSegment[]): string {
  const rows = words.map((word) =>
    [
      word.index,
      csvCell(word.word),
      word.startMs,
      word.endMs,
      word.durationMs,
      csvCell(word.audioPath),
    ].join(","),
  );

  return [
    "index,word,start_ms,end_ms,duration_ms,audio_path",
    ...rows,
    "",
  ].join("\n");
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function jsonBlob(value: unknown): Blob {
  return new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
}

function safePathPart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function fileStem(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  return safePathPart(stem) || "media";
}
