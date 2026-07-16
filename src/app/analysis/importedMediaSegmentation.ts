import { encodeWav24 } from "../audio/pcmAudio";
import { createZipBlobOffThread } from "../export/zipService";
import type { ZipEntryInput } from "../export/zipWriter";
import { detectFocusedVocalActivity } from "./focusedVocalActivity";
import {
  analyzeDecodedAudio,
  decodeAudioToVocalSignals16k,
} from "./localTakeAnalysis";
import { separateVocalsOffThread } from "./localSpectralVocalSeparation";
import {
  applyVocalActivityMask,
  mergeVocalActivitySegments,
} from "./vocalActivityMask";
import {
  buildLexicalConsensus,
  transcriptAgreement,
  type LexicalHypothesis,
  type LexicalHypothesisKind,
} from "./lexicalConsensus";
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
import { createImportedAnalysisPlan } from "./adaptiveAnalysis";

export const SEGMENTATION_SAMPLE_RATE = 16_000;
const ADAPTIVE_VOCAL_RETRY_MAX_DURATION_MS = 5 * 60_000;

export type ImportedMediaSegmentationResult = {
  readonly archive: Blob;
  readonly fileName: string;
  readonly manifest: WordSegmentationManifest;
};

export type WordSegmentationManifest = {
  readonly schemaVersion: "voice.word_segmentation.v6";
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
    readonly executionProvider: "wasm" | "webgpu" | "mixed";
    readonly modelAssets: "same-origin-cache-first";
    readonly sourceSeparation:
      | "not_needed"
      | "spectral_mid_side_residual"
      | "skipped_for_length"
      | "skipped_for_budget";
    readonly separationMetrics: {
      readonly centerEnergyRatio: number;
      readonly residualEnergyRatio: number;
    } | null;
    readonly vocalIsolation:
      | "mono_vocal_band"
      | "stereo_center_transient_reduction"
      | "spectral_mid_side_residual";
    readonly transcriptionPasses: 1 | 2 | 3 | 4;
    readonly selectedSignal: "original" | "vocal_focus" | "spectral_vocal";
    readonly vocalFocus:
      | "not_needed"
      | "selected"
      | "not_selected"
      | "skipped_for_length"
      | "skipped_for_budget";
    readonly adaptiveStrategy: {
      readonly scene:
        | "clean_voice"
        | "constrained_voice"
        | "sung_voice"
        | "music_mix"
        | "uncertain";
      readonly depth: "fast" | "verified" | "deep";
      readonly hypothesisBudget: 1 | 2 | 3 | 4;
    };
    readonly hypotheses: readonly {
      readonly kind: LexicalHypothesisKind;
      readonly model: "tiny" | "base";
      readonly signal: "original" | "vocal_focus" | "spectral_vocal";
      readonly wordCount: number;
      readonly provider: "wasm" | "webgpu";
      readonly decoding: "greedy" | "beam";
      readonly activityMaskApplied: boolean;
      readonly activityCoverage: number;
    }[];
    readonly consensus: {
      readonly strategy: "temporal_fuzzy_majority";
      readonly recoveredWordCount: number;
      readonly rejectedSingletonCount: number;
      readonly fuzzyMatchedWordCount: number;
    };
  };
  readonly transcription: {
    readonly engine: "whisper-tiny-secondary" | "whisper-base-music";
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
  readonly evidence: "speech_vad" | "transcriber_only" | "multi_pass_consensus";
  readonly confidence: number;
  readonly consensusVotes: number;
  readonly audioPath: string;
};

export async function segmentImportedMedia(input: {
  readonly file: File;
  readonly language: string;
  readonly onProgress: (progress: LocalAnalysisProgress) => void;
  readonly now?: Date;
  readonly signal?: AbortSignal;
}): Promise<ImportedMediaSegmentationResult> {
  throwIfAborted(input.signal);
  assertImportedMediaWithinLimits({ sizeBytes: input.file.size });
  const metadataDurationMs = await probeMediaDurationMs(
    input.file,
    input.signal,
  );
  assertImportedMediaWithinLimits({
    sizeBytes: input.file.size,
    durationMs: metadataDurationMs,
  });

  let audio: Float32Array;
  let vocalFocusSignal: Float32Array;
  let stereoCenterUsed: boolean;
  let spectralInput: {
    readonly left: Float32Array;
    readonly right: Float32Array | null;
  } | null;
  try {
    const signals = await decodeAudioToVocalSignals16k(input.file);
    audio = signals.mono;
    vocalFocusSignal = signals.vocalFocus;
    stereoCenterUsed = signals.stereoCenterUsed;
    spectralInput = signals.spectralInput;
  } catch {
    throw new Error(
      "La piste audio de ce média n'est pas décodable ici. Essaie un WAV, MP3, M4A, MP4 ou WebM compatible avec ce navigateur.",
    );
  }
  throwIfAborted(input.signal);
  const durationMs = Math.round(
    (audio.length / SEGMENTATION_SAMPLE_RATE) * 1000,
  );
  assertImportedMediaWithinLimits({
    sizeBytes: input.file.size,
    durationMs,
  });
  const processingProfile = detectProcessingProfile(durationMs);
  const tinyAnalysis = await analyzeDecodedAudio({
    audio: audio.slice(),
    expectedText: "",
    language: input.language,
    processingProfile,
    onProgress: input.onProgress,
    signal: input.signal,
  });
  input.onProgress({ stage: "validating-result" });
  const tinyAssessment = assessLexicalSegmentation({
    timings: tinyAnalysis.whisperWords,
    speechSegments: tinyAnalysis.speechSegments,
  });
  const hypotheses: LexicalHypothesis[] = [
    {
      kind: "original_tiny",
      model: "tiny",
      signal: "original",
      analysis: tinyAnalysis,
      assessment: tinyAssessment,
      decodingStrategy: "greedy",
      activityMaskApplied: false,
      activityCoverage: segmentCoverage(
        tinyAnalysis.speechSegments,
        durationMs,
      ),
    },
  ];
  const focusDifference = normalizedSignalDifference(audio, vocalFocusSignal);
  const focusedActivity = detectFocusedVocalActivity(vocalFocusSignal);
  const adaptivePlan = createImportedAnalysisPlan({
    durationMs,
    profile: processingProfile,
    initialStatus: tinyAssessment.quality.status,
    speechCoverage: segmentCoverage(tinyAnalysis.speechSegments, durationMs),
    focusedCoverage: segmentCoverage(focusedActivity, durationMs),
    focusDifference,
    stereoCenterUsed,
  });
  let sourceSeparation:
    | "not_needed"
    | "spectral_mid_side_residual"
    | "skipped_for_length"
    | "skipped_for_budget" =
    durationMs <= ADAPTIVE_VOCAL_RETRY_MAX_DURATION_MS
      ? "not_needed"
      : "skipped_for_length";
  let separationMetrics: {
    readonly centerEnergyRatio: number;
    readonly residualEnergyRatio: number;
  } | null = null;
  let vocalFocus:
    | "not_needed"
    | "selected"
    | "not_selected"
    | "skipped_for_length"
    | "skipped_for_budget" =
    durationMs > ADAPTIVE_VOCAL_RETRY_MAX_DURATION_MS
      ? "skipped_for_length"
      : "not_needed";

  if (adaptivePlan.runBaseOriginal) {
    input.onProgress({ stage: "enhancing-vocals" });
    const baseOriginalAnalysis = await analyzeDecodedAudio({
      audio: audio.slice(),
      expectedText: "",
      language: input.language,
      processingProfile,
      transcriptionModel: "base",
      decodingStrategy: processingProfile === "balanced" ? "beam" : "greedy",
      onProgress: input.onProgress,
      signal: input.signal,
    });
    input.onProgress({ stage: "validating-result" });
    const baseOriginalAssessment = assessLexicalSegmentation({
      timings: baseOriginalAnalysis.whisperWords,
      speechSegments: baseOriginalAnalysis.speechSegments,
    });
    hypotheses.push({
      kind: "original_base",
      model: "base",
      signal: "original",
      analysis: baseOriginalAnalysis,
      assessment: baseOriginalAssessment,
      decodingStrategy: processingProfile === "balanced" ? "beam" : "greedy",
      activityMaskApplied: false,
      activityCoverage: segmentCoverage(
        baseOriginalAnalysis.speechSegments,
        durationMs,
      ),
    });

    const needsMusicalEnsemble =
      adaptivePlan.scene === "music_mix" ||
      tinyAssessment.quality.status === "insufficient" ||
      baseOriginalAssessment.quality.status === "insufficient" ||
      transcriptAgreement(
        tinyAnalysis.transcript,
        baseOriginalAnalysis.transcript,
      ) < 0.9 ||
      focusDifference > 0.08;

    if (
      needsMusicalEnsemble &&
      adaptivePlan.allowVocalFocus &&
      focusDifference > 0.015
    ) {
      input.onProgress({ stage: "enhancing-vocals" });
      const combinedActivity = mergeVocalActivitySegments(
        [tinyAnalysis.speechSegments, focusedActivity],
        durationMs,
      );
      const vocalMask = applyVocalActivityMask({
        signal: vocalFocusSignal,
        segments: combinedActivity,
      });
      const vocalFocusAnalysis = await analyzeDecodedAudio({
        audio: vocalMask.signal,
        expectedText: "",
        language: input.language,
        processingProfile,
        transcriptionModel: "base",
        decodingStrategy: "greedy",
        onProgress: input.onProgress,
        signal: input.signal,
      });
      const vocalFocusAssessment = assessLexicalSegmentation({
        timings: vocalFocusAnalysis.whisperWords,
        speechSegments: mergeVocalActivitySegments(
          [vocalFocusAnalysis.speechSegments, combinedActivity],
          durationMs,
          30,
          120,
        ),
      });
      hypotheses.push({
        kind: "vocal_focus_base",
        model: "base",
        signal: "vocal_focus",
        analysis: vocalFocusAnalysis,
        assessment: vocalFocusAssessment,
        decodingStrategy: "greedy",
        activityMaskApplied: vocalMask.applied,
        activityCoverage: vocalMask.retainedRatio,
      });
      vocalFocus = "not_selected";
    } else if (needsMusicalEnsemble && !adaptivePlan.allowVocalFocus) {
      vocalFocus = "skipped_for_budget";
    }

    if (
      needsMusicalEnsemble &&
      adaptivePlan.allowSpectralSeparation &&
      spectralInput !== null
    ) {
      input.onProgress({ stage: "separating-vocals", progressPercent: 0 });
      try {
        const separated = await separateVocalsOffThread({
          ...spectralInput,
          signal: input.signal,
          onProgress: (progressPercent) =>
            input.onProgress({ stage: "separating-vocals", progressPercent }),
        });
        sourceSeparation = "spectral_mid_side_residual";
        separationMetrics = {
          centerEnergyRatio: separated.centerEnergyRatio,
          residualEnergyRatio: separated.residualEnergyRatio,
        };
        if (normalizedSignalDifference(audio, separated.signal) > 0.015) {
          const spectralActivity = detectFocusedVocalActivity(separated.signal);
          const combinedActivity = mergeVocalActivitySegments(
            [tinyAnalysis.speechSegments, spectralActivity],
            durationMs,
          );
          const spectralMask = applyVocalActivityMask({
            signal: separated.signal,
            segments: combinedActivity,
          });
          const spectralAnalysis = await analyzeDecodedAudio({
            audio: spectralMask.signal,
            expectedText: "",
            language: input.language,
            processingProfile,
            transcriptionModel: "base",
            decodingStrategy: "greedy",
            onProgress: input.onProgress,
            signal: input.signal,
          });
          const spectralAssessment = assessLexicalSegmentation({
            timings: spectralAnalysis.whisperWords,
            speechSegments: mergeVocalActivitySegments(
              [spectralAnalysis.speechSegments, combinedActivity],
              durationMs,
              30,
              120,
            ),
          });
          hypotheses.push({
            kind: "spectral_vocal_base",
            model: "base",
            signal: "spectral_vocal",
            analysis: spectralAnalysis,
            assessment: spectralAssessment,
            decodingStrategy: "greedy",
            activityMaskApplied: spectralMask.applied,
            activityCoverage: spectralMask.retainedRatio,
          });
        }
      } catch (error) {
        if (input.signal?.aborted) throw error;
        sourceSeparation = "not_needed";
        separationMetrics = null;
      }
    } else if (needsMusicalEnsemble && !adaptivePlan.allowSpectralSeparation) {
      sourceSeparation = "skipped_for_budget";
    }
  }

  input.onProgress({ stage: "validating-result" });
  const consensus = buildLexicalConsensus(hypotheses);
  const analysis = consensus.selected.analysis;
  const acceptedTimings = consensus.acceptedTimings;
  const quality: LexicalSegmentationQuality = {
    ...consensus.selected.assessment.quality,
    meanWordConfidence: consensus.meanConfidence,
    multiPassAgreementRate: consensus.agreementRate,
    warnings:
      consensus.agreementRate < 0.5 && hypotheses.length > 1
        ? [
            ...consensus.selected.assessment.quality.warnings,
            "Les différentes écoutes locales s'accordent peu; vérifie attentivement les paroles.",
          ]
        : consensus.selected.assessment.quality.warnings,
  };
  const selectedSignal = consensus.selected.signal;
  const selectedTranscriptionModel = consensus.selected.model;
  if (selectedSignal === "vocal_focus") vocalFocus = "selected";

  if (acceptedTimings.length === 0) {
    throw new Error(
      "Aucun mot exploitable n'a été proposé. Vérifie la langue ou essaie un passage où la voix est plus présente.",
    );
  }

  const words = createWordAudioSegments(acceptedTimings, durationMs);
  const supportedTranscript = words.map((word) => word.word).join(" ");
  const createdAt = (input.now ?? new Date()).toISOString();
  const manifest: WordSegmentationManifest = {
    schemaVersion: "voice.word_segmentation.v6",
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
      executionProvider:
        consensus.executionProviders.length > 1
          ? "mixed"
          : consensus.executionProviders[0],
      modelAssets: "same-origin-cache-first",
      sourceSeparation,
      separationMetrics,
      vocalIsolation:
        selectedSignal === "spectral_vocal"
          ? "spectral_mid_side_residual"
          : stereoCenterUsed
            ? "stereo_center_transient_reduction"
            : "mono_vocal_band",
      transcriptionPasses: asPassCount(hypotheses.length),
      selectedSignal,
      vocalFocus,
      adaptiveStrategy: {
        scene: adaptivePlan.scene,
        depth:
          hypotheses.length >= 3
            ? "deep"
            : hypotheses.length === 2
              ? "verified"
              : "fast",
        hypothesisBudget: adaptivePlan.maximumHypotheses,
      },
      hypotheses: hypotheses.map((hypothesis) => ({
        kind: hypothesis.kind,
        model: hypothesis.model,
        signal: hypothesis.signal,
        wordCount: hypothesis.assessment.acceptedTimings.length,
        provider: hypothesis.analysis.executionProvider,
        decoding: hypothesis.decodingStrategy,
        activityMaskApplied: hypothesis.activityMaskApplied,
        activityCoverage: hypothesis.activityCoverage,
      })),
      consensus: {
        strategy: "temporal_fuzzy_majority",
        recoveredWordCount: consensus.recoveredWordCount,
        rejectedSingletonCount: consensus.rejectedSingletonCount,
        fuzzyMatchedWordCount: consensus.fuzzyMatchedWordCount,
      },
    },
    transcription: {
      engine:
        selectedTranscriptionModel === "base"
          ? "whisper-base-music"
          : "whisper-tiny-secondary",
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
  throwIfAborted(input.signal);

  const archive = await createZipBlobOffThread(entries, input.signal);
  throwIfAborted(input.signal);

  return {
    archive,
    fileName: `${fileStem(input.file.name)}.decoupe-lexicale.zip`,
    manifest,
  };
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

  if (
    candidate.quality.evidenceMode === "transcriber_only" &&
    current.quality.evidenceMode === "transcriber_only"
  ) {
    const minimumUsefulGain =
      current.quality.acceptedWordCount === 0
        ? 1
        : Math.max(2, Math.ceil(current.quality.acceptedWordCount * 0.15));

    return (
      candidate.quality.acceptedWordCount >=
        current.quality.acceptedWordCount + minimumUsefulGain &&
      candidate.quality.timingAcceptanceRate >=
        current.quality.timingAcceptanceRate - 0.05 &&
      candidate.quality.wordsPerSpeechMinute <= 360
    );
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
      confidence: "confidence" in timing ? (timing.confidence ?? 0.5) : 0.5,
      consensusVotes:
        "consensusVotes" in timing ? (timing.consensusVotes ?? 1) : 1,
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
      word.confidence,
      word.consensusVotes,
      csvCell(word.audioPath),
    ].join(","),
  );

  return [
    "index,word,start_ms,end_ms,duration_ms,clip_start_ms,clip_end_ms,acoustic_support,evidence,confidence,consensus_votes,audio_path",
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

async function probeMediaDurationMs(
  file: File,
  signal?: AbortSignal,
): Promise<number | null> {
  throwIfAborted(signal);
  if (
    typeof Audio === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }

  const media = new Audio();
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      media.removeAttribute("src");
      media.load();
      URL.revokeObjectURL(objectUrl);
    };
    const finish = (durationMs: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(durationMs);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(getAbortReason(signal));
    };
    const timeoutId = window.setTimeout(() => finish(null), 5_000);

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw getAbortReason(signal);
}

function getAbortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Analyse locale annulée.", "AbortError");
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

function normalizedSignalDifference(
  original: Float32Array,
  candidate: Float32Array,
): number {
  if (original.length === 0 || original.length !== candidate.length) return 1;
  const stride = Math.max(1, Math.floor(original.length / 48_000));
  let originalEnergy = 0;
  let candidateEnergy = 0;
  let crossEnergy = 0;

  for (let index = 0; index < original.length; index += stride) {
    const source = Number.isFinite(original[index]) ? original[index] : 0;
    const processed = Number.isFinite(candidate[index]) ? candidate[index] : 0;
    originalEnergy += source ** 2;
    candidateEnergy += processed ** 2;
    crossEnergy += source * processed;
  }

  const correlation =
    Math.abs(crossEnergy) /
    Math.sqrt(Math.max(originalEnergy * candidateEnergy, 1e-8));
  return Math.min(1, Math.max(0, 1 - correlation ** 2));
}

function asPassCount(value: number): 1 | 2 | 3 | 4 {
  return Math.min(4, Math.max(1, value)) as 1 | 2 | 3 | 4;
}

function segmentCoverage(
  segments: readonly { readonly startMs: number; readonly endMs: number }[],
  durationMs: number,
): number {
  const activeDurationMs = segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  return (
    Math.round(
      Math.min(1, activeDurationMs / Math.max(durationMs, 1)) * 1_000,
    ) / 1_000
  );
}

function fileStem(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  return safePathPart(stem) || "media";
}
