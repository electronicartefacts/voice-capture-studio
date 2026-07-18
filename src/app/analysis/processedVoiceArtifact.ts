import { encodeWav24 } from "../audio/pcmAudio";
import {
  decodeAudioToMono16k,
  decodeAudioToVocalSignals16k,
  getAnalysisDurationMs,
} from "./localTakeAnalysis";
import { separateVocalsOffThread } from "./localSpectralVocalSeparation";
import {
  readRuntimePerformanceProfile,
  recordRuntimePerformanceObservation,
} from "./runtimePerformanceProfile";

const PROCESSED_SAMPLE_RATE = 16_000;

export type ProcessedVoiceArtifact = {
  readonly blob: Blob;
  readonly metadata: {
    readonly schemaVersion: "voice.processed_vocal.v1";
    readonly localOnly: true;
    readonly sampleRateHz: 16000;
    readonly bitDepth: 24;
    readonly channels: 1;
    readonly method:
      | "spectral_mid_side_residual_vocal_band"
      | "vocal_band_transient_reduction";
    readonly timingPreserved: true;
    readonly centerEnergyRatio: number | null;
    readonly residualEnergyRatio: number | null;
    readonly noiseReference: {
      readonly status: "used" | "unavailable" | "invalid";
      readonly sourceRef: string | null;
      readonly frameCount: number;
    };
    readonly measuredSeparationRealtimeFactor: number | null;
    readonly priorSeparationRealtimeFactor: number | null;
  };
};

/** Creates a derived voice-first signal while the immutable 48 kHz raw WAV stays intact. */
export async function createProcessedVoiceArtifact(input: {
  readonly audioBlob: Blob;
  readonly roomToneBlob?: Blob;
  readonly roomToneSourceRef?: string | null;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progressPercent: number) => void;
}): Promise<ProcessedVoiceArtifact> {
  const signals = await decodeAudioToVocalSignals16k(input.audioBlob);
  let noiseReference: Float32Array | null = null;
  let noiseReferenceStatus: "used" | "unavailable" | "invalid" =
    input.roomToneBlob === undefined ? "unavailable" : "invalid";
  if (input.roomToneBlob !== undefined) {
    noiseReference = await decodeAudioToMono16k(input.roomToneBlob).catch(
      () => null,
    );
  }
  let output = signals.vocalFocus;
  let method: ProcessedVoiceArtifact["metadata"]["method"] =
    "vocal_band_transient_reduction";
  let centerEnergyRatio: number | null = null;
  let residualEnergyRatio: number | null = null;
  let noiseReferenceFrameCount = 0;
  let measuredSeparationRealtimeFactor: number | null = null;
  const sourceDurationMs = getAnalysisDurationMs(signals.mono);
  const priorSeparationRealtimeFactor =
    readRuntimePerformanceProfile().separationRealtimeFactor;

  if (signals.spectralInput !== null) {
    try {
      const startedAt = performance.now();
      const separated = await separateVocalsOffThread({
        ...signals.spectralInput,
        noiseReference,
        onProgress: input.onProgress ?? (() => undefined),
        signal: input.signal,
      });
      output = separated.signal;
      method = "spectral_mid_side_residual_vocal_band";
      centerEnergyRatio = separated.centerEnergyRatio;
      residualEnergyRatio = separated.residualEnergyRatio;
      noiseReferenceFrameCount = separated.noiseReferenceFrameCount;
      noiseReferenceStatus = separated.noiseReferenceUsed
        ? "used"
        : noiseReferenceStatus;
      const elapsedMs = performance.now() - startedAt;
      measuredSeparationRealtimeFactor =
        sourceDurationMs > 0
          ? Math.round((elapsedMs / sourceDurationMs) * 1_000) / 1_000
          : null;
      recordRuntimePerformanceObservation({
        kind: "separation",
        elapsedMs,
        sourceDurationMs,
      });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      // The deterministic vocal-band pass remains available if a constrained
      // browser cannot allocate the spectral worker.
    }
  }

  return {
    blob: encodeWav24(output, PROCESSED_SAMPLE_RATE),
    metadata: {
      schemaVersion: "voice.processed_vocal.v1",
      localOnly: true,
      sampleRateHz: PROCESSED_SAMPLE_RATE,
      bitDepth: 24,
      channels: 1,
      method,
      timingPreserved: true,
      centerEnergyRatio,
      residualEnergyRatio,
      noiseReference: {
        status: noiseReferenceStatus,
        sourceRef: input.roomToneSourceRef ?? null,
        frameCount: noiseReferenceFrameCount,
      },
      measuredSeparationRealtimeFactor,
      priorSeparationRealtimeFactor,
    },
  };
}
