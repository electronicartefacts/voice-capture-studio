import type { PromptDefinition } from "../../domains/corpus";
import type {
  CaptureSession,
  ForcedAlignment,
  RecordedTake,
  TakeMedia,
  TakeId,
  TakeProsodyMetrics,
  TakeCaptureContext,
  TakeQualityGateResult,
} from "../../domains/sessions";
import {
  createTakeObservationPackage,
  type BrowserAsrObservation,
} from "../../domains/observations";
import type { CaptureProfile } from "../../domains/workspace";
import {
  alignPromptToPhonemes,
  estimateTranscriptMatch,
} from "../../domains/phonetics";
import type { PcmRecordingMetrics } from "../audio/pcmRecorder";
import { getAudioModePolicy, type CaptureAudioMode } from "./audioModePolicy";
import {
  assessVocalPerformance,
  describeVocalActivity,
  type VocalPerformanceAssessment,
} from "./vocalPerformance";

export function createRecordedTake(input: {
  readonly captureMode?: Exclude<CaptureAudioMode, "free">;
  readonly durationMs: number;
  readonly forcedAlignment?: ForcedAlignment;
  readonly fileName: string;
  readonly media: TakeMedia;
  readonly metrics: PcmRecordingMetrics;
  readonly profile: CaptureProfile;
  readonly prompt: PromptDefinition;
  readonly recordedAt: Date;
  readonly recognizedTranscript?: string;
  readonly speechRecognition?: BrowserAsrObservation;
  readonly liveWordTimings?: readonly {
    readonly word: string;
    readonly startMs: number;
    readonly endMs: number;
  }[];
  readonly session: CaptureSession;
  readonly takeId: TakeId;
  readonly truncated?: boolean;
}): RecordedTake {
  const captureMode = input.captureMode ?? "training";
  const modePolicy = getAudioModePolicy(captureMode);
  const vocalPerformance = assessVocalPerformance({
    captureMode,
    metrics: input.metrics,
  });
  const spokenText = input.prompt.spokenText ?? input.prompt.text;
  const phonemeAlignment = alignPromptToPhonemes({
    activitySegments: input.metrics.speechSegments,
    durationMs: input.durationMs,
    language: input.session.language,
    text: spokenText,
  });
  const observedTranscript =
    input.speechRecognition?.transcript ?? input.recognizedTranscript;
  const transcriptMatch = estimateTranscriptMatch({
    expectedText: spokenText,
    observedText: observedTranscript,
  });
  const durationStatus =
    input.durationMs < input.prompt.qa.minDurationMs ||
    input.durationMs > input.prompt.qa.maxDurationMs
      ? "review"
      : "pass";
  const transcriptStatus = getTranscriptGateStatus(
    transcriptMatch,
    vocalPerformance,
  );
  const phonemeAlignmentStatus =
    input.forcedAlignment === undefined
      ? ("review" as const)
      : ("pass" as const);
  const prosody = createProsodyMetrics({
    durationMs: input.durationMs,
    metrics: input.metrics,
    wordCount: phonemeAlignment.words.length,
  });
  const clippingStatus = input.metrics.clippingDetected ? "fail" : "pass";
  const captureTruncatedStatus = input.truncated === true ? "fail" : "pass";
  const headroomStatus = getHeadroomStatus(input.metrics.estimatedTruePeakDbfs);
  const dcOffsetStatus =
    Math.abs(input.metrics.dcOffset) > 0.02 ? "review" : "pass";
  const speechActivityStatus =
    input.metrics.activeSpeechRatio < modePolicy.minimumActiveSpeechRatio
      ? "review"
      : "pass";
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
  const digitalGain = input.media.capture.processing.digitalGain;
  const measuredTakeNoiseFloorDbfs =
    digitalGain?.sourceNoiseFloorDbfs ?? input.metrics.noiseFloorDbfs;
  const roomToneNoiseFloorDbfs =
    input.profile.roomToneNoiseFloorDbfs ?? measuredTakeNoiseFloorDbfs;
  const roomToneDriftDb = input.profile.roomToneCaptured
    ? roundDb(
        measuredTakeNoiseFloorDbfs -
          (input.profile.roomToneNoiseFloorDbfs ?? measuredTakeNoiseFloorDbfs),
      )
    : null;
  const roomToneDriftStatus =
    roomToneDriftDb !== null && roomToneDriftDb > 6 ? "review" : "pass";
  const noiseStatus =
    input.profile.roomToneCaptured &&
    roomToneNoiseFloorDbfs > modePolicy.maximumRoomToneNoiseFloorDbfs
      ? "review"
      : "pass";
  const snrStatus =
    input.metrics.snrDb < modePolicy.minimumSnrDb ? "review" : "pass";
  const verdict =
    captureTruncatedStatus === "fail" ||
    clippingStatus === "fail" ||
    headroomStatus === "fail" ||
    signalStatus === "fail"
      ? "reject"
      : durationStatus === "pass" &&
          signalStatus === "pass" &&
          noiseStatus === "pass" &&
          roomToneDriftStatus === "pass" &&
          snrStatus === "pass" &&
          headroomStatus === "pass" &&
          dcOffsetStatus === "pass" &&
          speechActivityStatus === "pass" &&
          plosiveStatus === "pass" &&
          mouthNoiseStatus === "pass" &&
          reverbStatus === "pass" &&
          transcriptStatus !== "fail" &&
          (!modePolicy.roomToneRequired || input.profile.roomToneCaptured)
        ? "pass"
        : "review";
  return {
    id: input.takeId,
    promptId: input.prompt.id,
    fileName: input.fileName,
    durationMs: input.durationMs,
    recordedAt: input.recordedAt.toISOString() as RecordedTake["recordedAt"],
    media: input.media,
    captureContext: createTakeCaptureContext({
      ...input,
      captureMode,
      vocalPerformance,
    }),
    transcript: {
      schemaVersion: "voice.transcript.v2",
      originalText: input.prompt.text,
      spokenText,
      observedText:
        observedTranscript === undefined ||
        observedTranscript.trim().length === 0
          ? null
          : observedTranscript,
      matchEstimate: transcriptMatch,
      strictMatchRequired: vocalPerformance.kind !== "sung",
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
      ...(input.liveWordTimings === undefined ||
      input.liveWordTimings.length === 0
        ? {}
        : {
            liveAlignment: {
              source: "browser_live_alignment" as const,
              words: input.liveWordTimings,
            },
          }),
      ...(input.forcedAlignment === undefined
        ? {}
        : { forcedAlignment: input.forcedAlignment }),
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
        roomToneDriftDb,
        snrDb: input.metrics.snrDb,
        crestFactorDb: input.metrics.crestFactorDb,
        dcOffset: input.metrics.dcOffset,
        clippingDetected: input.metrics.clippingDetected,
        clippingSampleCount: input.metrics.clippingSampleCount,
        clippingRate: input.metrics.clippingRate,
        activeSpeechRatio: input.metrics.activeSpeechRatio,
        speechActivityThresholdDbfs: input.metrics.speechActivityThresholdDbfs,
        silenceRatio: input.metrics.silenceRatio,
        voicedFrameRatio: input.metrics.voicedFrameRatio,
        meanPitchHz: input.metrics.meanPitchHz,
        pitchRangeSemitones: input.metrics.pitchRangeSemitones,
        pitchVariationSemitones: input.metrics.pitchVariationSemitones,
        energyVariationDb: input.metrics.energyVariationDb,
        reverbScore: input.metrics.reverbScore,
        plosiveScore: input.metrics.plosiveScore,
        mouthNoiseScore: input.metrics.mouthNoiseScore,
        energyEnvelope: input.metrics.energyEnvelope,
        speechSegments: input.metrics.speechSegments,
      },
      performance: {
        transcriptMatch: transcriptMatch.score,
        alignmentConfidence: input.forcedAlignment?.confidence ?? null,
        phonemeInventoryCount:
          input.forcedAlignment === undefined
            ? null
            : new Set(
                input.forcedAlignment.phonemes.map(
                  (phoneme) => phoneme.phoneme,
                ),
              ).size,
        wordPhonemeLinkRate:
          input.forcedAlignment === undefined
            ? null
            : input.forcedAlignment.words.length === 0
              ? 0
              : roundScore(
                  input.forcedAlignment.words.filter(
                    (word) => word.endMs > word.startMs,
                  ).length / input.forcedAlignment.words.length,
                ),
        intentMatch: null,
        prosody,
        prosodyVariation: scoreMeasuredProsody(prosody),
        naturalnessHumanReview: null,
        keeper: verdict === "pass",
      },
      gates: (
        [
          {
            id: "clipping",
            label: "Clipping",
            status: clippingStatus,
            message: input.metrics.clippingDetected
              ? "Le signal sature. Baisse le niveau ou éloigne le micro."
              : `Niveau OK : pic à ${input.metrics.peakDbfs} dBFS.`,
          },
          {
            id: "capture_truncated",
            label: "Intégrité capture",
            status: captureTruncatedStatus,
            message:
              captureTruncatedStatus === "fail"
                ? "La capture a atteint sa limite mémoire et le fichier est tronqué. Reprends la phrase."
                : "Tous les échantillons capturés sont présents.",
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
            id: "input_gain",
            label: "Sensibilité",
            status:
              digitalGain?.limitedBy === "insufficient_signal" ||
              digitalGain?.limitedBy === "clipping"
                ? "review"
                : "pass",
            message:
              digitalGain === undefined
                ? "Signal conservé sans compensation numérique."
                : createInputGainMessage(digitalGain),
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
            status:
              input.profile.roomToneCaptured &&
              noiseStatus === "pass" &&
              roomToneDriftStatus === "pass"
                ? "pass"
                : "review",
            message: input.profile.roomToneCaptured
              ? `Bruit de fond de pièce : ${roomToneNoiseFloorDbfs} dBFS. Dérive relative : ${roomToneDriftDb ?? 0} dB.`
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
            message: createTranscriptGateMessage(
              transcriptMatch,
              vocalPerformance,
            ),
          },
          {
            id: "phoneme_alignment",
            label: "Alignement phonèmes",
            status: phonemeAlignmentStatus,
            message:
              "Alignement forcé acoustique requis avant d'utiliser les phonèmes pour l'entraînement.",
          },
          {
            id: "audio_present",
            label: "Présence audio",
            status: input.metrics.sampleCount > 0 ? "pass" : "fail",
            message:
              input.metrics.sampleCount > 0
                ? "Le signal PCM final contient des échantillons."
                : "Aucun échantillon audio n'est présent.",
          },
          {
            id: "speech_detected",
            label: "Voix détectée",
            status:
              input.metrics.activeSpeechRatio >=
              modePolicy.minimumActiveSpeechRatio
                ? "pass"
                : "review",
            message: `${Math.round(input.metrics.activeSpeechRatio * 100)} % d'activité ${describeVocalActivity(vocalPerformance)} estimée depuis le signal.`,
          },
          {
            id: "vad_valid",
            label: "VAD",
            status:
              input.metrics.activeSpeechRatio >=
              modePolicy.minimumActiveSpeechRatio
                ? "pass"
                : "review",
            message:
              "Détection énergétique compatible avec la voix parlée et chantée; un détecteur de parole reste une preuve secondaire.",
          },
          {
            id: "energy_valid",
            label: "Énergie",
            status: Number.isFinite(input.metrics.rmsDbfs) ? "pass" : "fail",
            message:
              "RMS, LUFS et dynamique ont été calculés depuis le PCM final.",
          },
          {
            id: "noise_floor_valid",
            label: "Bruit de fond",
            status:
              input.profile.roomToneCaptured &&
              noiseStatus === "pass" &&
              roomToneDriftStatus === "pass"
                ? "pass"
                : "review",
            message: input.profile.roomToneCaptured
              ? "Mesure de prise comparée au niveau et à la dérive du silence de pièce déclaré."
              : "Silence de pièce absent; estimation de prise conservée avec revue.",
          },
          {
            id: "prosody_valid",
            label: "Prosodie",
            status: input.metrics.voicedFrameRatio > 0 ? "pass" : "review",
            message:
              "Pitch, énergie et débit sont issus du signal; aucune émotion observée n'est inventée.",
          },
          {
            id: "estimated_alignment_valid",
            label: "Alignement estimé",
            status: phonemeAlignment.words.length > 0 ? "pass" : "fail",
            message:
              "Alignement préparatoire explicitement estimé et remplaçable par un aligneur acoustique.",
          },
          {
            id: "phoneme_sequence_valid",
            label: "Séquence phonétique",
            status: phonemeAlignment.phonemes.length > 0 ? "pass" : "review",
            message:
              "Séquence G2P linguistique présente; elle ne prétend pas observer l'audio.",
          },
          {
            id: "browser_asr_consistent",
            label: "Cohérence ASR navigateur",
            status: transcriptStatus,
            message: createTranscriptGateMessage(
              transcriptMatch,
              vocalPerformance,
            ),
          },
          {
            id: "corpus_consistent",
            label: "Cohérence corpus",
            status: "pass",
            message:
              "La prise référence un prompt et une version de corpus explicites.",
          },
        ] satisfies readonly TakeQualityGateResult[]
      ).map(enrichGateEvidence),
      verdict,
    },
    observation: createTakeObservationPackage({
      asr: input.speechRecognition,
      durationMs: input.durationMs,
      generatedAt: input.recordedAt.toISOString(),
      intent: {
        intent: input.prompt.intention,
        delivery: input.prompt.delivery,
      },
      alignment: phonemeAlignment,
      metrics: {
        ...input.metrics,
        schemaVersion: "voice.audio_metrics.v1",
      },
      prompt: input.prompt,
      session: input.session,
      transcriptMatch,
    }),
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

function enrichGateEvidence(
  gate: TakeQualityGateResult,
): TakeQualityGateResult {
  const source = gateSource(gate.id);
  return {
    ...gate,
    source,
    confidence:
      source === "corpus"
        ? 1
        : source === "browser_asr"
          ? null
          : source === "energy_vad"
            ? 0.72
            : source === "g2p"
              ? 0.82
              : source === "evidence_fusion"
                ? 0.8
                : 0.9,
    reason: gate.message,
  };
}

function gateSource(
  id: TakeQualityGateResult["id"],
): NonNullable<TakeQualityGateResult["source"]> {
  if (id === "browser_asr_consistent" || id === "transcript_match") {
    return "browser_asr";
  }
  if (id === "corpus_consistent") {
    return "corpus";
  }
  if (id === "audio_present") {
    return "audio_signal";
  }
  if (id === "estimated_alignment_valid") {
    return "evidence_fusion";
  }
  if (id === "phoneme_alignment" || id === "phoneme_sequence_valid") {
    return "g2p";
  }
  if (
    id === "vad_valid" ||
    id === "speech_detected" ||
    id === "speech_activity"
  ) {
    return "energy_vad";
  }
  return "audio_analysis";
}

function createTakeCaptureContext(input: {
  readonly captureMode: Exclude<CaptureAudioMode, "free">;
  readonly media: TakeMedia;
  readonly profile: CaptureProfile;
  readonly recordedAt: Date;
  readonly vocalPerformance: VocalPerformanceAssessment;
}): TakeCaptureContext {
  return {
    schemaVersion: "voice.capture.context.v1",
    capturedAt:
      input.recordedAt.toISOString() as TakeCaptureContext["capturedAt"],
    captureMode: input.captureMode,
    vocalPerformance: input.vocalPerformance,
    capture: input.media.capture,
    profile: {
      microphoneName: input.profile.microphoneName,
      audioInterface: input.profile.audioInterface,
      mouthToMicDistanceCm: input.profile.mouthToMicDistanceCm,
      roomDescription: input.profile.roomDescription,
      roomToneCaptured: input.profile.roomToneCaptured,
      roomToneNoiseFloorDbfs: input.profile.roomToneNoiseFloorDbfs ?? null,
      roomTonePeakDbfs: input.profile.roomTonePeakDbfs ?? null,
      roomToneIntegratedLufs: input.profile.roomToneIntegratedLufs ?? null,
      roomToneDurationMs: input.profile.roomToneDurationMs ?? null,
      calibratedAt: input.profile.calibratedAt ?? null,
    },
    roomToneRef: input.profile.roomToneFileName ?? null,
  };
}

function createInputGainMessage(
  gain: NonNullable<TakeMedia["capture"]["processing"]["digitalGain"]>,
): string {
  if (gain.limitedBy === "clipping") {
    return "Pic saturé dans la source : aucun gain appliqué. Réduis le niveau matériel ou éloigne légèrement le micro.";
  }

  if (gain.limitedBy === "insufficient_signal") {
    return "Voix trop faible pour calibrer le gain avec certitude. Rapproche le micro et refais une prise.";
  }

  const mode = gain.mode === "auto" ? "Auto" : "Manuel";
  const constraint =
    gain.limitedBy === "noise_floor"
      ? "plafonné pour ne pas remonter le bruit de pièce"
      : gain.limitedBy === "true_peak"
        ? "plafonné pour préserver les transitoires"
        : gain.limitedBy === "maximum"
          ? "plafonné à +12 dB pour rester prédictible"
          : gain.limitedBy === "manual"
            ? "réglage demandé appliqué"
            : "niveau vocal cible atteint";

  return `${mode} : ${gain.gainDb >= 0 ? "+" : ""}${gain.gainDb.toFixed(1)} dB, ${constraint}.`;
}

function getTranscriptGateStatus(
  match: ReturnType<typeof estimateTranscriptMatch>,
  vocalPerformance: VocalPerformanceAssessment,
): RecordedTake["quality"]["gates"][number]["status"] {
  if (match.source === "prompt_only") {
    return "review";
  }

  if (match.score < 0.75) {
    return vocalPerformance.kind === "sung" ? "review" : "fail";
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
  vocalPerformance: VocalPerformanceAssessment,
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

  if (vocalPerformance.kind === "sung") {
    return `Paroles chantées non confirmées par l'ASR navigateur (${Math.round(match.score * 100)} %). L'audio reste valide; contrôle des paroles requis.`;
  }

  return `Transcript incompatible (${Math.round(match.score * 100)} %). Reprends mot pour mot.`;
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function roundDb(value: number): number {
  return Math.round(value * 10) / 10;
}

function createProsodyMetrics(input: {
  readonly durationMs: number;
  readonly metrics: PcmRecordingMetrics;
  readonly wordCount: number;
}): TakeProsodyMetrics {
  return {
    schemaVersion: "voice.prosody.v1",
    source: "audio_signal",
    voicedFrameRatio: input.metrics.voicedFrameRatio,
    meanPitchHz: input.metrics.meanPitchHz,
    pitchRangeSemitones: input.metrics.pitchRangeSemitones,
    pitchVariationSemitones: input.metrics.pitchVariationSemitones,
    energyVariationDb: input.metrics.energyVariationDb,
    speakingRateWpm:
      input.durationMs > 0
        ? Math.round((input.wordCount * 60_000 * 100) / input.durationMs) / 100
        : null,
  };
}

function scoreMeasuredProsody(prosody: TakeProsodyMetrics): number {
  const pitchScore =
    prosody.pitchVariationSemitones === null
      ? 0
      : Math.min(1, prosody.pitchVariationSemitones / 4);
  const energyScore = Math.min(1, prosody.energyVariationDb / 12);

  return roundScore((pitchScore + energyScore) / 2);
}
