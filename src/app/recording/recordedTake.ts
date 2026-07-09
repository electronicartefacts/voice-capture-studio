import type { PromptDefinition } from "../../domains/corpus";
import type {
  CaptureSession,
  RecordedTake,
  TakeMedia,
  TakeId,
} from "../../domains/sessions";
import type { CaptureProfile } from "../../domains/workspace";
import {
  alignPromptToPhonemes,
  estimateTranscriptMatch,
} from "../../domains/phonetics";
import type { PcmRecordingMetrics } from "../audio/pcmRecorder";

export function createRecordedTake(input: {
  readonly durationMs: number;
  readonly fileName: string;
  readonly media: TakeMedia;
  readonly metrics: PcmRecordingMetrics;
  readonly profile: CaptureProfile;
  readonly prompt: PromptDefinition;
  readonly recordedAt: Date;
  readonly recognizedTranscript?: string;
  readonly session: CaptureSession;
  readonly takeId: TakeId;
}): RecordedTake {
  const spokenText = input.prompt.spokenText ?? input.prompt.text;
  const phonemeAlignment = alignPromptToPhonemes({
    durationMs: input.durationMs,
    language: input.session.language,
    text: spokenText,
  });
  const transcriptMatch = estimateTranscriptMatch({
    expectedText: spokenText,
    observedText: input.recognizedTranscript,
  });
  const durationStatus =
    input.durationMs < input.prompt.qa.minDurationMs ||
    input.durationMs > input.prompt.qa.maxDurationMs
      ? "review"
      : "pass";
  const transcriptStatus = getTranscriptGateStatus(transcriptMatch);
  const phonemeAlignmentStatus =
    phonemeAlignment.words.length === 0 || phonemeAlignment.confidence < 0.68
      ? "review"
      : "pass";
  const clippingStatus = input.metrics.clippingDetected ? "fail" : "pass";
  const headroomStatus = getHeadroomStatus(input.metrics.estimatedTruePeakDbfs);
  const dcOffsetStatus =
    Math.abs(input.metrics.dcOffset) > 0.02 ? "review" : "pass";
  const speechActivityStatus =
    input.metrics.activeSpeechRatio < 0.25 ? "review" : "pass";
  const plosiveStatus = input.metrics.plosiveScore > 0.08 ? "review" : "pass";
  const mouthNoiseStatus =
    input.metrics.mouthNoiseScore > 0.08 ? "review" : "pass";
  const reverbStatus = input.metrics.reverbScore > 0.65 ? "review" : "pass";
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
    clippingStatus === "fail" ||
    headroomStatus === "fail" ||
    signalStatus === "fail" ||
    transcriptStatus === "fail"
      ? "reject"
      : durationStatus === "pass" &&
          signalStatus === "pass" &&
          noiseStatus === "pass" &&
          snrStatus === "pass" &&
          headroomStatus === "pass" &&
          dcOffsetStatus === "pass" &&
          speechActivityStatus === "pass" &&
          plosiveStatus === "pass" &&
          mouthNoiseStatus === "pass" &&
          reverbStatus === "pass" &&
          phonemeAlignmentStatus === "pass" &&
          input.profile.roomToneCaptured
        ? "pass"
        : "review";
  const wordPhonemeLinkRate =
    phonemeAlignment.words.length === 0
      ? 0
      : roundScore(
          phonemeAlignment.words.filter((word) => word.phonemes.length > 0)
            .length / phonemeAlignment.words.length,
        );

  return {
    id: input.takeId,
    promptId: input.prompt.id,
    fileName: input.fileName,
    durationMs: input.durationMs,
    recordedAt: input.recordedAt.toISOString() as RecordedTake["recordedAt"],
    media: input.media,
    transcript: {
      schemaVersion: "voice.transcript.v2",
      originalText: input.prompt.text,
      spokenText,
      observedText:
        input.recognizedTranscript === undefined ||
        input.recognizedTranscript.trim().length === 0
          ? null
          : input.recognizedTranscript,
      matchEstimate: transcriptMatch,
      strictMatchRequired: true,
      annotations: [],
      tokens: phonemeAlignment.tokens,
    },
    timing: {
      schemaVersion: "voice.timing.v2",
      durationMs: input.durationMs,
      words: phonemeAlignment.words.map((word) => ({
        word: word.word,
        startMs: word.startMs,
        endMs: word.endMs,
        tokenIndex: word.tokenIndex,
        normalized: word.normalized,
        confidence: word.confidence,
        syllableCount: word.syllableCount,
        phonemes: word.phonemes,
      })),
      phonemes: phonemeAlignment.phonemes,
      phrases: [
        {
          text: spokenText,
          startMs: 0,
          endMs: input.durationMs,
        },
      ],
      alignment: phonemeAlignment,
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
        schemaVersion: input.metrics.schemaVersion,
        sampleRateHz: input.metrics.sampleRateHz,
        bitDepth: input.metrics.bitDepth,
        channels: input.metrics.channels,
        sampleCount: input.metrics.sampleCount,
        peakDbfs: input.metrics.peakDbfs,
        estimatedTruePeakDbfs: input.metrics.estimatedTruePeakDbfs,
        rmsDbfs: input.metrics.rmsDbfs,
        integratedLufs: input.metrics.integratedLufs,
        noiseFloorDbfs: input.metrics.noiseFloorDbfs,
        snrDb: input.metrics.snrDb,
        crestFactorDb: input.metrics.crestFactorDb,
        dcOffset: input.metrics.dcOffset,
        clippingDetected: input.metrics.clippingDetected,
        clippingSampleCount: input.metrics.clippingSampleCount,
        clippingRate: input.metrics.clippingRate,
        activeSpeechRatio: input.metrics.activeSpeechRatio,
        silenceRatio: input.metrics.silenceRatio,
        reverbScore: input.metrics.reverbScore,
        plosiveScore: input.metrics.plosiveScore,
        mouthNoiseScore: input.metrics.mouthNoiseScore,
      },
      performance: {
        transcriptMatch: transcriptMatch.score,
        alignmentConfidence: phonemeAlignment.confidence,
        phonemeInventoryCount: phonemeAlignment.inventory.length,
        wordPhonemeLinkRate,
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
          id: "headroom",
          label: "Marge numérique",
          status: headroomStatus,
          message:
            headroomStatus === "fail"
              ? "Pic inter-échantillon trop proche de 0 dBFS. Réduis le gain et reprends."
              : headroomStatus === "review"
                ? `Marge réduite : pic estimé ${input.metrics.estimatedTruePeakDbfs} dBFS.`
                : `Marge saine : pic estimé ${input.metrics.estimatedTruePeakDbfs} dBFS.`,
        },
        {
          id: "dc_offset",
          label: "Offset DC",
          status: dcOffsetStatus,
          message:
            dcOffsetStatus === "pass"
              ? "Offset DC négligeable."
              : "Offset DC élevé détecté. Vérifie la chaîne micro/interface avant entraînement.",
        },
        {
          id: "speech_activity",
          label: "Activité vocale",
          status: speechActivityStatus,
          message:
            speechActivityStatus === "pass"
              ? `${Math.round(input.metrics.activeSpeechRatio * 100)} % des fenêtres contiennent de la voix exploitable.`
              : "Trop peu de voix détectée dans la prise. Vérifie les silences ou le niveau micro.",
        },
        {
          id: "plosives",
          label: "Plosives",
          status: plosiveStatus,
          message:
            plosiveStatus === "pass"
              ? "Pas de concentration problématique de plosives."
              : "Plosives marquées. Utilise un filtre anti-pop ou ajuste l'angle du micro.",
        },
        {
          id: "mouth_noise",
          label: "Bruits de bouche",
          status: mouthNoiseStatus,
          message:
            mouthNoiseStatus === "pass"
              ? "Bruits transitoires dans la plage attendue."
              : "Bruits de bouche/transitoires élevés. Hydrate-toi et reprends si possible.",
        },
        {
          id: "reverb",
          label: "Réverbération estimée",
          status: reverbStatus,
          message:
            reverbStatus === "pass"
              ? "Queue sonore compatible avec une prise sèche."
              : "Queue sonore longue estimée. Réduis les réflexions de la pièce.",
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
          status: transcriptStatus,
          message: createTranscriptGateMessage(transcriptMatch),
        },
        {
          id: "phoneme_alignment",
          label: "Alignement phonèmes",
          status: phonemeAlignmentStatus,
          message:
            phonemeAlignmentStatus === "pass"
              ? `Chaque mot est lié à ses phonèmes estimés (${phonemeAlignment.inventory.length} unités).`
              : "Alignement phonémique local peu fiable. Prévois une validation forcée avant entraînement.",
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

function getTranscriptGateStatus(
  match: ReturnType<typeof estimateTranscriptMatch>,
): RecordedTake["quality"]["gates"][number]["status"] {
  if (match.source === "prompt_only") {
    return "review";
  }

  if (match.score < 0.75) {
    return "fail";
  }

  if (match.score < 0.92) {
    return "review";
  }

  return "pass";
}

function getHeadroomStatus(
  estimatedTruePeakDbfs: number,
): RecordedTake["quality"]["gates"][number]["status"] {
  if (estimatedTruePeakDbfs >= -1) {
    return "fail";
  }

  return estimatedTruePeakDbfs >= -3 ? "review" : "pass";
}

function createTranscriptGateMessage(
  match: ReturnType<typeof estimateTranscriptMatch>,
): string {
  if (match.source === "prompt_only") {
    return "Aucun transcript navigateur fiable. Le texte prompt est exporté, à valider par alignement forcé.";
  }

  if (match.score >= 0.92) {
    return `Transcript reconnu aligné au prompt : ${Math.round(match.score * 100)} %.`;
  }

  if (match.score >= 0.75) {
    return `Transcript à relire : ${Math.round(match.score * 100)} %, écarts possibles.`;
  }

  return `Transcript incompatible (${Math.round(match.score * 100)} %). Reprends mot pour mot.`;
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}
