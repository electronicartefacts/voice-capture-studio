import type { PromptDefinition } from "@domains/corpus";
import type { LanguageCode } from "@shared/index";
import type {
  PromptPhonemeAlignment,
  TranscriptMatchEstimate,
} from "@domains/phonetics";
import type {
  BrowserAsrObservation,
  CorpusObservation,
  EstimatedAlignmentObservation,
  EvidenceConfidence,
  FusedDecision,
  SignalObservation,
  SignalMetrics,
  TakeObservationPackage,
} from "./types";

export function createTakeObservationPackage(input: {
  readonly asr?: BrowserAsrObservation;
  readonly durationMs: number;
  readonly generatedAt: string;
  readonly intent: ObservationIntentInput;
  readonly alignment: PromptPhonemeAlignment;
  readonly metrics: SignalMetrics;
  readonly prompt: PromptDefinition;
  readonly session: { readonly language: LanguageCode };
  readonly transcriptMatch: TranscriptMatchEstimate;
}): TakeObservationPackage {
  const corpus = observeCorpus(input);
  const signal = observeSignal(input, corpus.tokens.length);
  const speechRecognition =
    input.asr ??
    createUnavailableAsr(input.generatedAt, input.session.language);
  const alignment = observeEstimatedAlignment(
    input.alignment,
    input.generatedAt,
    signal,
    speechRecognition,
  );

  return {
    schemaVersion: "voice.take_observation.v1",
    generatedAt: input.generatedAt,
    corpus,
    signal,
    speechRecognition,
    alignment,
    transcriptMatch: input.transcriptMatch,
    decisions: fuseEvidence({
      alignment,
      corpus,
      signal,
      speechRecognition,
      transcriptMatch: input.transcriptMatch,
    }),
    limitations: [
      "Energy VAD is an audio-derived estimate, not a neural VAD observation.",
      "Word and phoneme boundaries are preparatory estimates, not forced alignment.",
      "Browser SpeechRecognition is optional evidence and may use a browser-managed service.",
      "Jitter, shimmer, and respiration are not declared without a validated measurement method.",
    ],
  };
}

function observeCorpus(input: {
  readonly generatedAt: string;
  readonly intent: ObservationIntentInput;
  readonly prompt: PromptDefinition;
  readonly session: { readonly language: LanguageCode };
}): CorpusObservation {
  const spokenText = input.prompt.spokenText ?? input.prompt.text;
  return {
    schemaVersion: "voice.corpus_observation.v1",
    rawText: input.prompt.text,
    spokenText,
    normalizedText: normalizeText(spokenText),
    tokens: tokenize(spokenText),
    sentences: spokenText
      .split(/(?<=[.!?])\s+/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean),
    punctuation: spokenText.match(/[.,;:!?…—–-]/gu) ?? [],
    variants:
      input.prompt.spokenText === undefined ? [] : [input.prompt.spokenText],
    language: input.session.language,
    locale: input.session.language === "fr" ? "fr-FR" : "en-US",
    intent: input.intent.intent,
    emotionTarget: input.intent.intent.emotion,
    style: input.intent.delivery.tone,
    expectedEnergy: input.intent.delivery.energy,
    confidence: confidence(
      1,
      "declared",
      "corpus",
      "Prompt metadata is a versioned linguistic target, not an audio observation.",
    ),
    provenance: {
      source: "corpus",
      method: "prompt_snapshot",
      methodVersion: "voice.corpus_observation.v1",
      generatedAt: input.generatedAt,
    },
  };
}

function observeSignal(
  input: {
    readonly durationMs: number;
    readonly generatedAt: string;
    readonly metrics: SignalMetrics;
  },
  wordCount: number,
): SignalObservation {
  const speechDetected = input.metrics.activeSpeechRatio >= 0.1;
  const estimatedSpeechMs = Math.round(
    input.durationMs * input.metrics.activeSpeechRatio,
  );
  const speechSegments = input.metrics.speechSegments ?? [];
  const pauses = createEstimatedPauses(speechSegments);
  const firstSegment = speechSegments[0];
  const lastSegment = speechSegments.at(-1);
  return {
    schemaVersion: "voice.signal_observation.v1",
    metrics: input.metrics,
    vad: {
      method: "energy_activity_estimate",
      speechDetected,
      activeSpeechRatio: input.metrics.activeSpeechRatio,
      silenceRatio: input.metrics.silenceRatio,
      confidence: confidence(
        speechDetected ? 0.72 : 0.45,
        "estimated",
        "energy_vad",
        "Speech activity is estimated from signal energy windows.",
      ),
    },
    temporal: {
      durationMs: input.durationMs,
      estimatedSpeechMs,
      estimatedSilenceMs: Math.max(0, input.durationMs - estimatedSpeechMs),
      speakingRateWpm:
        estimatedSpeechMs > 0
          ? round((wordCount / estimatedSpeechMs) * 60_000, 1)
          : null,
      pauseCount: pauses.length,
      leadingSilenceMs: firstSegment?.startMs ?? input.durationMs,
      trailingSilenceMs:
        lastSegment === undefined
          ? input.durationMs
          : Math.max(0, input.durationMs - lastSegment.endMs),
      pauses,
    },
    energyEnvelope: input.metrics.energyEnvelope ?? [],
    speechSegments,
    acoustic: {
      rmsDbfs: input.metrics.rmsDbfs,
      integratedLufs: input.metrics.integratedLufs,
      noiseFloorDbfs: input.metrics.noiseFloorDbfs,
      snrDb: input.metrics.snrDb,
      peakDbfs: input.metrics.peakDbfs,
      estimatedTruePeakDbfs: input.metrics.estimatedTruePeakDbfs,
      energyVariationDb: input.metrics.energyVariationDb,
      dcOffset: input.metrics.dcOffset,
      clippingRate: input.metrics.clippingRate,
      reverbScore: input.metrics.reverbScore,
      plosiveScore: input.metrics.plosiveScore,
      mouthNoiseScore: input.metrics.mouthNoiseScore,
    },
    prosody: {
      meanPitchHz: input.metrics.meanPitchHz,
      pitchRangeSemitones: input.metrics.pitchRangeSemitones,
      pitchVariationSemitones: input.metrics.pitchVariationSemitones,
      voicedFrameRatio: input.metrics.voicedFrameRatio,
    },
    confidence: confidence(
      0.9,
      "measured",
      "audio_analysis",
      "Metrics are computed directly from the finalized PCM signal.",
    ),
    provenance: {
      source: "audio_analysis",
      method: "pcm_signal_analysis",
      methodVersion: input.metrics.schemaVersion,
      generatedAt: input.generatedAt,
    },
  };
}

function createEstimatedPauses(
  segments: readonly { readonly startMs: number; readonly endMs: number }[],
): SignalObservation["temporal"]["pauses"] {
  const pauses: Array<{
    startMs: number;
    endMs: number;
    status: "estimated";
  }> = [];

  for (let index = 1; index < segments.length; index += 1) {
    const startMs = segments[index - 1].endMs;
    const endMs = segments[index].startMs;

    if (endMs - startMs >= 150) {
      pauses.push({ startMs, endMs, status: "estimated" });
    }
  }

  return pauses;
}

function observeEstimatedAlignment(
  alignment: PromptPhonemeAlignment,
  generatedAt: string,
  signal: SignalObservation,
  speechRecognition: BrowserAsrObservation,
): EstimatedAlignmentObservation {
  const firstSpeech = signal.speechSegments[0];
  const lastSpeech = signal.speechSegments.at(-1);
  const hasVadWindow = firstSpeech !== undefined && lastSpeech !== undefined;
  const wordAlignment = hasVadWindow
    ? alignment.words.map((word) => ({
        ...word,
        startMs: scaleBoundary(
          word.startMs,
          alignment.durationMs,
          firstSpeech.startMs,
          lastSpeech.endMs,
        ),
        endMs: scaleBoundary(
          word.endMs,
          alignment.durationMs,
          firstSpeech.startMs,
          lastSpeech.endMs,
        ),
        phonemes: word.phonemes.map((phoneme) => ({
          ...phoneme,
          startMs: scaleBoundary(
            phoneme.startMs,
            alignment.durationMs,
            firstSpeech.startMs,
            lastSpeech.endMs,
          ),
          endMs: scaleBoundary(
            phoneme.endMs,
            alignment.durationMs,
            firstSpeech.startMs,
            lastSpeech.endMs,
          ),
        })),
      }))
    : alignment.words;
  const phonemeAlignment = wordAlignment.flatMap((word) => word.phonemes);
  const hasAsr = speechRecognition.availability === "available";
  return {
    schemaVersion: "voice.estimated_alignment_observation.v1",
    status: "estimated",
    kind: "preparatory_alignment",
    inputs: [
      "corpus",
      "g2p",
      ...(hasVadWindow ? (["energy_vad"] as const) : []),
      ...(hasAsr ? (["browser_asr"] as const) : []),
    ],
    wordAlignment,
    phonemeAlignment,
    g2p: alignment,
    warnings: [
      ...alignment.warnings,
      ...(hasVadWindow
        ? [
            "Estimated boundaries are constrained to the energy-VAD speech window.",
          ]
        : ["No energy-VAD window was available; full take duration is used."]),
    ],
    forcedAlignmentRequired: true,
    replaceableBy: ["WhisperX", "Montreal Forced Aligner", "Gentle", "MFA"],
    confidence: confidence(
      round(
        alignment.confidence *
          (hasVadWindow ? (signal.vad.confidence.value ?? 0.72) : 0.8),
        3,
      ),
      "estimated",
      "evidence_fusion",
      hasVadWindow
        ? "Boundaries combine corpus/G2P duration weights with the energy-VAD speech window; they are not acoustically forced."
        : "Boundaries use corpus/G2P duration weights across the take; no acoustic speech window was available.",
    ),
    provenance: {
      source: "evidence_fusion",
      method: "preparatory_alignment",
      methodVersion: "voice.estimated_alignment_observation.v1",
      generatedAt,
    },
  };
}

function fuseEvidence(input: {
  readonly alignment: EstimatedAlignmentObservation;
  readonly corpus: CorpusObservation;
  readonly signal: SignalObservation;
  readonly speechRecognition: BrowserAsrObservation;
  readonly transcriptMatch: TranscriptMatchEstimate;
}): readonly FusedDecision[] {
  const takeDecision: FusedDecision = {
    subjectType: "take",
    subjectId: "take",
    decision: input.signal.vad.speechDetected
      ? "speech_signal_present"
      : "speech_signal_uncertain",
    status: "estimated",
    confidence: input.signal.vad.confidence.value,
    source: "evidence_fusion",
    reason:
      "The physical signal and energy activity decide signal presence; ASR is supplementary.",
    evidenceRefs: ["signal.metrics", "signal.vad", "corpus"],
  };
  const words = input.alignment.wordAlignment.map((word): FusedDecision => ({
    subjectType: "word",
    subjectId: `word:${word.tokenIndex}`,
    decision: "expected_word_with_estimated_boundary",
    status: "estimated",
    confidence: round(
      word.confidence *
        (input.speechRecognition.availability === "available"
          ? 0.85 + input.transcriptMatch.score * 0.15
          : 0.85),
      3,
    ),
    source: "evidence_fusion",
    reason:
      input.speechRecognition.availability === "available"
        ? "Corpus/G2P estimate is supported by optional browser ASR agreement."
        : "Corpus/G2P estimate is retained without browser ASR evidence.",
    evidenceRefs: [
      `corpus.tokens.${word.tokenIndex}`,
      `alignment.wordAlignment.${word.tokenIndex}`,
      ...(input.speechRecognition.availability === "available"
        ? ["speechRecognition"]
        : []),
    ],
  }));
  const phonemes = input.alignment.phonemeAlignment.map(
    (phoneme, index): FusedDecision => ({
      subjectType: "phoneme",
      subjectId: `phoneme:${index}`,
      decision: "expected_phoneme_with_estimated_boundary",
      status: "estimated",
      confidence: phoneme.confidence,
      source: "g2p",
      reason:
        "The phoneme is a linguistic G2P hypothesis, not an audio observation.",
      evidenceRefs: [
        `alignment.g2p.phonemes.${index}`,
        `corpus.tokens.${phoneme.wordIndex}`,
      ],
    }),
  );
  return [takeDecision, ...words, ...phonemes];
}

function scaleBoundary(
  valueMs: number,
  sourceDurationMs: number,
  targetStartMs: number,
  targetEndMs: number,
): number {
  const ratio = valueMs / Math.max(sourceDurationMs, 1);
  return Math.round(
    targetStartMs + ratio * Math.max(0, targetEndMs - targetStartMs),
  );
}

function createUnavailableAsr(
  generatedAt: string,
  language: LanguageCode,
): BrowserAsrObservation {
  return {
    schemaVersion: "voice.browser_asr_observation.v1",
    availability: "unavailable",
    engine: null,
    locale: language === "fr" ? "fr-FR" : "en-US",
    transcript: null,
    hypotheses: [],
    runtime: { userAgent: null, browserName: null, browserVersion: null },
    confidence: confidence(
      null,
      "unavailable",
      "browser_asr",
      "SpeechRecognition supplied no observation; the pipeline continues.",
    ),
    provenance: {
      source: "browser_asr",
      method: "unavailable",
      methodVersion: "voice.browser_asr_observation.v1",
      generatedAt,
    },
  };
}

type ObservationIntentInput = {
  readonly intent: PromptDefinition["intention"];
  readonly delivery: PromptDefinition["delivery"];
};

function confidence(
  value: number | null,
  status: EvidenceConfidence["status"],
  source: EvidenceConfidence["source"],
  reason: string,
): EvidenceConfidence {
  return { value, status, source, reason };
}

function normalizeText(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function tokenize(text: string): readonly string[] {
  return text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? [];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
