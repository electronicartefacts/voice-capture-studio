import { encodeWav24 } from "../audio/pcmAudio";
import { createZipBlobOffThread } from "../export/zipService";
import type { ZipEntryInput } from "../export/zipWriter";
import { analyzeDecodedAudio, decodeAudioToMono16k } from "./localTakeAnalysis";
import type {
  LocalAnalysisProgress,
  LocalProcessingProfile,
  WhisperWordTiming,
} from "./types";
import {
  assessLexicalSegmentation,
  selectLexicalProcessingProfile,
  type LexicalSegmentationQuality,
  type SupportedWordTiming,
} from "./lexicalSegmentationQuality";

export const SEGMENTATION_SAMPLE_RATE = 16_000;

export type ImportedMediaSegmentationResult = {
  readonly archive: Blob;
  readonly fileName: string;
  readonly manifest: WordSegmentationManifest;
};

export type WordSegmentationManifest = {
  readonly schemaVersion: "voice.word_segmentation.v2";
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
    readonly clipContextMs: 60;
    readonly edgeFadeMs: 5;
  };
  readonly processing: {
    readonly localOnly: true;
    readonly profile: LocalProcessingProfile;
    readonly executionProvider: "wasm";
    readonly modelAssets: "same-origin-cache-first";
    readonly sourceSeparation: "not_available";
  };
  readonly transcription: {
    readonly engine: "whisper-tiny-secondary";
    readonly language: string;
    readonly transcript: string;
    readonly rawHypothesis: string;
    readonly wordCount: number;
    readonly timingSource: "whisper_attention_timestamp";
    readonly quality: LexicalSegmentationQuality;
  };
  readonly words: readonly WordAudioSegment[];
};

export type WordAudioSegment = {
  readonly index: number;
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  readonly clipStartMs: number;
  readonly clipEndMs: number;
  readonly acousticSupport: number;
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
  const processingProfile = detectProcessingProfile(durationMs);
  const analysis = await analyzeDecodedAudio({
    audio: audio.slice(),
    expectedText: "",
    language: input.language,
    processingProfile,
    onProgress: input.onProgress,
  });
  input.onProgress({ stage: "validating-result" });
  const { acceptedTimings, quality } = assessLexicalSegmentation({
    timings: analysis.whisperWords,
    speechSegments: analysis.speechSegments,
  });

  if (quality.status === "insufficient") {
    throw new Error(
      "Le signal ne permet pas de confirmer des mots assez fiables. Aucun faux découpage n'a été produit.",
    );
  }

  const words = createWordAudioSegments(acceptedTimings, durationMs);
  const supportedTranscript = words.map((word) => word.word).join(" ");
  const createdAt = (input.now ?? new Date()).toISOString();
  const manifest: WordSegmentationManifest = {
    schemaVersion: "voice.word_segmentation.v2",
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
      clipContextMs: 60,
      edgeFadeMs: 5,
    },
    processing: {
      localOnly: true,
      profile: processingProfile,
      executionProvider: "wasm",
      modelAssets: "same-origin-cache-first",
      sourceSeparation: "not_available",
    },
    transcription: {
      engine: "whisper-tiny-secondary",
      language: input.language,
      transcript: supportedTranscript,
      rawHypothesis: analysis.transcript,
      wordCount: words.length,
      timingSource: "whisper_attention_timestamp",
      quality,
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
      data: new Blob([`${supportedTranscript}\n`], {
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
  timings: readonly (WhisperWordTiming | SupportedWordTiming)[],
  totalDurationMs = Number.POSITIVE_INFINITY,
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
      clipStartMs: Math.max(0, timing.startMs - 60),
      clipEndMs: Math.min(totalDurationMs, timing.endMs + 60),
      acousticSupport: "acousticSupport" in timing ? timing.acousticSupport : 1,
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
    Math.floor((segment.clipStartMs / 1000) * SEGMENTATION_SAMPLE_RATE),
  );
  const endSample = Math.min(
    audio.length,
    Math.ceil((segment.clipEndMs / 1000) * SEGMENTATION_SAMPLE_RATE),
  );

  const samples = audio.slice(startSample, endSample);
  applyEdgeFade(samples, Math.round(SEGMENTATION_SAMPLE_RATE * 0.005));

  return encodeWav24(samples, SEGMENTATION_SAMPLE_RATE);
}

function applyEdgeFade(samples: Float32Array, requestedFadeSamples: number) {
  const fadeSamples = Math.min(
    requestedFadeSamples,
    Math.floor(samples.length / 2),
  );

  for (let index = 0; index < fadeSamples; index += 1) {
    const gain = (index + 1) / (fadeSamples + 1);
    samples[index] *= gain;
    samples[samples.length - 1 - index] *= gain;
  }
}

function createTimelineCsv(words: readonly WordAudioSegment[]): string {
  const rows = words.map((word) =>
    [
      word.index,
      csvCell(word.word),
      word.startMs,
      word.endMs,
      word.durationMs,
      word.clipStartMs,
      word.clipEndMs,
      word.acousticSupport,
      csvCell(word.audioPath),
    ].join(","),
  );

  return [
    "index,word,start_ms,end_ms,duration_ms,clip_start_ms,clip_end_ms,acoustic_support,audio_path",
    ...rows,
    "",
  ].join("\n");
}

function detectProcessingProfile(durationMs: number): LocalProcessingProfile {
  const navigatorWithGpu = navigator as Navigator & { gpu?: unknown };

  return selectLexicalProcessingProfile({
    durationMs,
    webGpuAvailable: navigatorWithGpu.gpu !== undefined,
    wasmThreadsAvailable:
      typeof SharedArrayBuffer !== "undefined" &&
      globalThis.crossOriginIsolated,
  });
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
