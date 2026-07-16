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
import { assertImportedMediaWithinLimits } from "./lexicalSegmentationPolicy";

export const SEGMENTATION_SAMPLE_RATE = 16_000;
const ADAPTIVE_VOCAL_RETRY_MAX_DURATION_MS = 5 * 60_000;

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
    readonly transcriptionPasses: 1 | 2;
    readonly selectedSignal: "original" | "vocal_focus";
    readonly vocalFocus:
      "not_needed" | "selected" | "not_selected" | "skipped_for_length";
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
  readonly evidence: "speech_vad" | "transcriber_only";
  readonly audioPath: string;
};

export async function segmentImportedMedia(input: {
  readonly file: File;
  readonly language: string;
  readonly onProgress: (progress: LocalAnalysisProgress) => void;
  readonly now?: Date;
}): Promise<ImportedMediaSegmentationResult> {
  assertImportedMediaWithinLimits({ sizeBytes: input.file.size });
  const metadataDurationMs = await probeMediaDurationMs(input.file);
  assertImportedMediaWithinLimits({
    sizeBytes: input.file.size,
    durationMs: metadataDurationMs,
  });

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
  assertImportedMediaWithinLimits({
    sizeBytes: input.file.size,
    durationMs,
  });
  const processingProfile = detectProcessingProfile(durationMs);
  let analysis = await analyzeDecodedAudio({
    audio: audio.slice(),
    expectedText: "",
    language: input.language,
    processingProfile,
    onProgress: input.onProgress,
  });
  input.onProgress({ stage: "validating-result" });
  let assessment = assessLexicalSegmentation({
    timings: analysis.whisperWords,
    speechSegments: analysis.speechSegments,
  });
  let transcriptionPasses: 1 | 2 = 1;
  let selectedSignal: "original" | "vocal_focus" = "original";
  let vocalFocus:
    "not_needed" | "selected" | "not_selected" | "skipped_for_length" =
    assessment.quality.status === "insufficient"
      ? "skipped_for_length"
      : "not_needed";

  if (
    assessment.quality.status === "insufficient" &&
    durationMs <= ADAPTIVE_VOCAL_RETRY_MAX_DURATION_MS
  ) {
    transcriptionPasses = 2;
    input.onProgress({ stage: "enhancing-vocals" });
    const vocalFocusAnalysis = await analyzeDecodedAudio({
      audio: createVocalFocusSignal(audio),
      expectedText: "",
      language: input.language,
      processingProfile,
      onProgress: input.onProgress,
    });
    input.onProgress({ stage: "validating-result" });
    const vocalFocusAssessment = assessLexicalSegmentation({
      timings: vocalFocusAnalysis.whisperWords,
      speechSegments: vocalFocusAnalysis.speechSegments,
    });

    if (shouldPreferLexicalAssessment(vocalFocusAssessment, assessment)) {
      analysis = vocalFocusAnalysis;
      assessment = vocalFocusAssessment;
      selectedSignal = "vocal_focus";
      vocalFocus = "selected";
    } else {
      vocalFocus = "not_selected";
    }
  }

  const { acceptedTimings, quality } = assessment;

  if (acceptedTimings.length === 0) {
    throw new Error(
      "Aucun mot exploitable n'a été proposé. Vérifie la langue ou essaie un passage où la voix est plus présente.",
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
      videoDiscarded: isVideoSource(input.file),
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
      transcriptionPasses,
      selectedSignal,
      vocalFocus,
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

export function createVocalFocusSignal(
  input: Float32Array,
  sampleRate = SEGMENTATION_SAMPLE_RATE,
): Float32Array {
  const output = new Float32Array(input.length);
  const highPassCutoffHz = 120;
  const lowPassCutoffHz = Math.min(6_500, sampleRate * 0.45);
  const timeStep = 1 / sampleRate;
  const highPassRc = 1 / (2 * Math.PI * highPassCutoffHz);
  const highPassAlpha = highPassRc / (highPassRc + timeStep);
  const lowPassRc = 1 / (2 * Math.PI * lowPassCutoffHz);
  const lowPassAlpha = timeStep / (lowPassRc + timeStep);
  let previousInput = 0;
  let highPassed = 0;
  let lowPassed = 0;
  let peak = 0;

  for (let index = 0; index < input.length; index += 1) {
    const sample = Number.isFinite(input[index]) ? input[index] : 0;
    highPassed = highPassAlpha * (highPassed + sample - previousInput);
    previousInput = sample;
    lowPassed += lowPassAlpha * (highPassed - lowPassed);
    output[index] = lowPassed;
    peak = Math.max(peak, Math.abs(lowPassed));
  }

  if (peak >= 0.01) {
    const gain = Math.min(4, 0.92 / peak);
    for (let index = 0; index < output.length; index += 1) {
      output[index] = Math.max(-1, Math.min(1, output[index] * gain));
    }
  }

  return output;
}

export function shouldPreferLexicalAssessment(
  candidate: ReturnType<typeof assessLexicalSegmentation>,
  current: ReturnType<typeof assessLexicalSegmentation>,
): boolean {
  if (
    candidate.quality.status === "review" &&
    current.quality.status === "insufficient"
  ) {
    return true;
  }

  if (candidate.quality.status !== current.quality.status) return false;

  if (
    candidate.quality.evidenceMode === "speech_vad" &&
    current.quality.evidenceMode === "transcriber_only"
  ) {
    return true;
  }

  return (
    candidate.quality.evidenceMode === current.quality.evidenceMode &&
    candidate.quality.acceptedWordCount >= current.quality.acceptedWordCount &&
    candidate.quality.speechOverlapRate >=
      current.quality.speechOverlapRate + 0.15
  );
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
      evidence: "evidence" in timing ? timing.evidence : "speech_vad",
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
      word.evidence,
      csvCell(word.audioPath),
    ].join(","),
  );

  return [
    "index,word,start_ms,end_ms,duration_ms,clip_start_ms,clip_end_ms,acoustic_support,evidence,audio_path",
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

async function probeMediaDurationMs(file: File): Promise<number | null> {
  if (
    typeof Audio === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }

  const media = new Audio();
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (durationMs: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      media.removeAttribute("src");
      media.load();
      URL.revokeObjectURL(objectUrl);
      resolve(durationMs);
    };
    const timeoutId = window.setTimeout(() => finish(null), 5_000);

    media.preload = "metadata";
    media.onloadedmetadata = () =>
      finish(
        Number.isFinite(media.duration) && media.duration > 0
          ? Math.round(media.duration * 1_000)
          : null,
      );
    media.onerror = () => finish(null);
    media.src = objectUrl;
    media.load();
  });
}

function isVideoSource(file: File): boolean {
  return (
    file.type.startsWith("video/") ||
    /\.(?:m4v|mov|mp4|ogv|webm)$/i.test(file.name)
  );
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
