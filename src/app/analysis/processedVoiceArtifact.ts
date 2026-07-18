import { encodeWav24 } from "../audio/pcmAudio";
import { decodeAudioToVocalSignals16k } from "./localTakeAnalysis";
import { separateVocalsOffThread } from "./localSpectralVocalSeparation";

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
  };
};

/** Creates a derived voice-first signal while the immutable 48 kHz raw WAV stays intact. */
export async function createProcessedVoiceArtifact(input: {
  readonly audioBlob: Blob;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progressPercent: number) => void;
}): Promise<ProcessedVoiceArtifact> {
  const signals = await decodeAudioToVocalSignals16k(input.audioBlob);
  let output = signals.vocalFocus;
  let method: ProcessedVoiceArtifact["metadata"]["method"] =
    "vocal_band_transient_reduction";
  let centerEnergyRatio: number | null = null;
  let residualEnergyRatio: number | null = null;

  if (signals.spectralInput !== null) {
    try {
      const separated = await separateVocalsOffThread({
        ...signals.spectralInput,
        onProgress: input.onProgress ?? (() => undefined),
        signal: input.signal,
      });
      output = separated.signal;
      method = "spectral_mid_side_residual_vocal_band";
      centerEnergyRatio = separated.centerEnergyRatio;
      residualEnergyRatio = separated.residualEnergyRatio;
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
    },
  };
}
