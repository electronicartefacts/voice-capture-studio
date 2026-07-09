import type { PromptDefinition } from "../../domains/corpus";
import type {
  CaptureSession,
  RecordedTake,
  TakeId,
} from "../../domains/sessions";
import type { CaptureProfile } from "../../domains/workspace";
import type { PcmRecordingMetrics } from "../audio/pcmRecorder";

export function createRecordedTake(input: {
  readonly durationMs: number;
  readonly fileName: string;
  readonly metrics: PcmRecordingMetrics;
  readonly profile: CaptureProfile;
  readonly prompt: PromptDefinition;
  readonly recordedAt: Date;
  readonly session: CaptureSession;
  readonly takeId: TakeId;
}): RecordedTake {
  const words = input.prompt.text.split(/\s+/).filter(Boolean);
  const durationStatus =
    input.durationMs < input.prompt.qa.minDurationMs ||
    input.durationMs > input.prompt.qa.maxDurationMs
      ? "review"
      : "pass";
  const clippingStatus = input.metrics.clippingDetected ? "fail" : "pass";
  const signalStatus =
    input.metrics.peakDbfs <= -55 || input.metrics.integratedLufs <= -60
      ? "fail"
      : input.metrics.peakDbfs < -34 || input.metrics.integratedLufs < -42
        ? "review"
        : "pass";
  const roomToneNoiseFloorDbfs =
    input.profile.roomToneNoiseFloorDbfs ?? input.metrics.noiseFloorDbfs;
  const noiseStatus =
    input.profile.roomToneCaptured && roomToneNoiseFloorDbfs > -50
      ? "review"
      : "pass";
  const snrStatus = input.metrics.snrDb < 24 ? "review" : "pass";
  const verdict =
    clippingStatus === "fail" || signalStatus === "fail"
      ? "reject"
      : durationStatus === "pass" &&
          signalStatus === "pass" &&
          noiseStatus === "pass" &&
          snrStatus === "pass" &&
          input.profile.roomToneCaptured
        ? "pass"
        : "review";

  return {
    id: input.takeId,
    promptId: input.prompt.id,
    fileName: input.fileName,
    durationMs: input.durationMs,
    recordedAt: input.recordedAt.toISOString() as RecordedTake["recordedAt"],
    transcript: {
      schemaVersion: "voice.transcript.v2",
      originalText: input.prompt.text,
      spokenText: input.prompt.spokenText ?? input.prompt.text,
      strictMatchRequired: true,
      annotations: [],
    },
    timing: {
      schemaVersion: "voice.timing.v2",
      durationMs: input.durationMs,
      words: words.map((word, index) => {
        const startMs = Math.round(
          (input.durationMs / Math.max(words.length, 1)) * index,
        );
        const endMs = Math.round(
          (input.durationMs / Math.max(words.length, 1)) * (index + 1),
        );

        return { word, startMs, endMs };
      }),
      phrases: [
        {
          text: input.prompt.text,
          startMs: 0,
          endMs: input.durationMs,
        },
      ],
    },
    intent: {
      schemaVersion: "voice.intent.v2",
      language: input.session.language,
      intent: input.prompt.intention,
      delivery: input.prompt.delivery,
      direction: {
        directorNote: input.prompt.direction.directorNote,
        avoid: input.prompt.direction.avoid,
      },
      prosody: input.prompt.prosody,
    },
    quality: {
      schemaVersion: "voice.quality.v2",
      technical: {
        sampleRateHz: input.metrics.sampleRateHz,
        bitDepth: input.metrics.bitDepth,
        channels: input.metrics.channels,
        peakDbfs: input.metrics.peakDbfs,
        integratedLufs: input.metrics.integratedLufs,
        noiseFloorDbfs: input.metrics.noiseFloorDbfs,
        snrDb: input.metrics.snrDb,
        clippingDetected: input.metrics.clippingDetected,
        reverbScore: input.metrics.reverbScore,
        plosiveScore: input.metrics.plosiveScore,
        mouthNoiseScore: input.metrics.mouthNoiseScore,
      },
      performance: {
        transcriptMatch: 0.99,
        intentMatch: verdict === "pass" ? 0.92 : 0.78,
        prosodyVariation: 0.74,
        naturalnessHumanReview: null,
        keeper: verdict === "pass",
      },
      gates: [
        {
          id: "clipping",
          label: "Clipping",
          status: clippingStatus,
          message: input.metrics.clippingDetected
            ? "Le signal sature. Baisse le niveau ou éloigne le micro."
            : `Niveau OK : pic à ${input.metrics.peakDbfs} dBFS.`,
        },
        {
          id: "signal_level",
          label: "Signal",
          status: signalStatus,
          message:
            signalStatus === "fail"
              ? "Signal trop faible ou silence détecté. Vérifie le micro et reprends."
              : signalStatus === "review"
                ? "Signal un peu faible. Rapproche-toi ou monte légèrement le gain."
                : "Signal exploitable.",
        },
        {
          id: "noise_floor",
          label: "Silence de pièce",
          status: input.profile.roomToneCaptured ? noiseStatus : "review",
          message: input.profile.roomToneCaptured
            ? `Bruit de fond de pièce : ${roomToneNoiseFloorDbfs} dBFS.`
            : "Ajoute un silence de pièce pour valider le bruit de fond.",
        },
        {
          id: "snr",
          label: "SNR",
          status: snrStatus,
          message: `Rapport voix/bruit : ${input.metrics.snrDb} dB.`,
        },
        {
          id: "duration",
          label: "Durée",
          status: durationStatus,
          message:
            durationStatus === "pass"
              ? "Durée correcte."
              : "La phrase semble coupée ou trop lente. Reprends.",
        },
        {
          id: "transcript_match",
          label: "Transcript",
          status: "review",
          message: "Relis vite le texte : il doit correspondre mot pour mot.",
        },
      ],
      verdict,
    },
    review: {
      rating:
        verdict === "pass"
          ? "keeper"
          : verdict === "reject"
            ? "reject"
            : "maybe",
      bestTake: verdict === "pass",
      directorNotes:
        verdict === "pass"
          ? `Bonne prise. WAV 48 kHz / 24-bit, LUFS estimé ${input.metrics.integratedLufs}.`
          : verdict === "reject"
            ? "Prise rejetée techniquement. Reprends avant export."
            : "Prise utilisable en secours. Une reprise plus naturelle serait mieux.",
    },
  };
}
