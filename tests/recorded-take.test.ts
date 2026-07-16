import assert from "node:assert/strict";
import test from "node:test";
import { createRecordedTake } from "../src/app/recording/recordedTake";
import type { PcmRecordingMetrics } from "../src/app/audio/pcmRecorder";
import { canonicalCorpus, type PromptDefinition } from "../src/domains/corpus";
import { initialSpeakers } from "../src/domains/speakers";
import {
  planSession,
  type AudioCaptureProvenance,
  type CaptureSession,
  type TakeId,
} from "../src/domains/sessions";
import {
  createEmptyWorkspace,
  type CaptureProfile,
} from "../src/domains/workspace";

const speakerId = initialSpeakers[0].id;
const language = initialSpeakers[0].primaryLanguage;
const recordedAt = new Date("2026-07-09T08:01:30.000Z");
const takeId = "take.2026-07-09T08:01:30.000Z" as TakeId;

test("recorded take becomes keeper when technical gates and room tone pass", () => {
  const { prompt, session } = createPlannedPrompt();
  const take = createRecordedTake({
    durationMs: 3200,
    fileName: "take.wav",
    media: createMedia(),
    metrics: createMetrics({
      speechSegments: [
        { startMs: 250, endMs: 2950, source: "energy_threshold" },
      ],
    }),
    profile: createCaptureProfile({ roomToneCaptured: true }),
    prompt,
    recordedAt,
    recognizedTranscript: prompt.text,
    session,
    takeId,
  });

  assert.equal(take.id, takeId);
  assert.equal(take.quality.verdict, "pass");
  assert.equal(take.review.rating, "keeper");
  assert.equal(take.review.bestTake, true);
  assert.equal(take.quality.performance.keeper, true);
  assert.equal(take.transcript.originalText, prompt.text);
  assert.equal(take.intent.intent.id, prompt.intention.id);
  assert.equal(take.timing.phrases[0].endMs, 3200);
  assert.equal(take.timing.words.at(-1)?.endMs, 2950);
  assert.ok((take.timing.phonemes?.length ?? 0) > take.timing.words.length);
  assert.equal(take.timing.alignment?.forcedAlignmentRequired, true);
  assert.equal(take.quality.performance.wordPhonemeLinkRate, null);
  assert.equal(take.observation?.schemaVersion, "voice.take_observation.v1");
  assert.equal(take.observation?.signal.confidence.status, "measured");
  assert.equal(take.observation?.alignment.status, "estimated");
  assert.equal(take.observation?.alignment.wordAlignment[0].startMs, 250);
  assert.ok(take.observation?.alignment.inputs.includes("energy_vad"));
  assert.ok((take.observation?.decisions.length ?? 0) > 1);
  assert.equal(
    take.quality.gates.every(
      (gate) => gate.source !== undefined && gate.reason !== undefined,
    ),
    true,
  );
});

test("mode policies relax speech and SNR thresholds for dubbing and mastering", () => {
  const { prompt, session } = createPlannedPrompt();
  const metrics = createMetrics({
    activeSpeechRatio: 0.2,
    snrDb: 20,
  });
  const profile = createCaptureProfile({
    roomToneCaptured: true,
    roomToneNoiseFloorDbfs: -48,
  });

  const dubbingTake = createRecordedTake({
    captureMode: "dubbing",
    durationMs: 3200,
    fileName: "dubbing.wav",
    media: createMedia(),
    metrics,
    profile,
    prompt,
    recordedAt,
    recognizedTranscript: prompt.text,
    session,
    takeId,
  });

  assert.equal(dubbingTake.quality.verdict, "pass");
  assert.equal(dubbingTake.captureContext?.captureMode, "dubbing");

  const masteringTake = createRecordedTake({
    captureMode: "mastering",
    durationMs: 3200,
    fileName: "mastering.wav",
    media: createMedia(),
    metrics: { ...metrics, activeSpeechRatio: 0.13, snrDb: 15 },
    profile: { ...profile, roomToneNoiseFloorDbfs: -44 },
    prompt,
    recordedAt,
    recognizedTranscript: prompt.text,
    session,
    takeId,
  });

  assert.equal(masteringTake.quality.verdict, "pass");
  assert.equal(masteringTake.captureContext?.captureMode, "mastering");
});

test("browser ASR mismatch requests review but cannot reject physical audio", () => {
  const { prompt, session } = createPlannedPrompt();
  const take = createRecordedTake({
    durationMs: 3200,
    fileName: "take.wav",
    media: createMedia(),
    metrics: createMetrics(),
    profile: createCaptureProfile({ roomToneCaptured: true }),
    prompt,
    recordedAt,
    recognizedTranscript: "completely different words",
    session,
    takeId,
  });

  assert.equal(take.quality.verdict, "review");
  assert.equal(findGateStatus(take, "transcript_match"), "fail");
  assert.equal(findGateStatus(take, "browser_asr_consistent"), "fail");
  assert.equal(take.transcript.matchEstimate?.source, "web_speech");
});

test("sung performances keep ASR mismatch secondary in every directed mode", () => {
  const { prompt, session } = createPlannedPrompt();
  const sungMetrics = createMetrics({
    pitchRangeSemitones: 11,
    pitchVariationSemitones: 3.4,
    voicedFrameRatio: 0.64,
  });

  for (const captureMode of ["training", "dubbing", "mastering"] as const) {
    const take = createRecordedTake({
      captureMode,
      durationMs: 3200,
      fileName: `${captureMode}.wav`,
      media: createMedia(),
      metrics: sungMetrics,
      profile: createCaptureProfile({ roomToneCaptured: true }),
      prompt,
      recordedAt,
      recognizedTranscript: "browser asr cannot understand this melody",
      session,
      takeId,
    });

    assert.equal(
      take.captureContext?.vocalPerformance?.kind,
      captureMode === "mastering" ? "sung" : "sung_candidate",
    );
    assert.equal(take.transcript.strictMatchRequired, false);
    assert.equal(findGateStatus(take, "transcript_match"), "review");
    assert.equal(take.quality.verdict, "review");
  }
});

test("recorded take can become keeper without browser ASR", () => {
  const { prompt, session } = createPlannedPrompt();
  const take = createRecordedTake({
    durationMs: 3200,
    fileName: "take.wav",
    media: createMedia(),
    metrics: createMetrics(),
    profile: createCaptureProfile({ roomToneCaptured: true }),
    prompt,
    recordedAt,
    session,
    takeId,
  });

  assert.equal(take.quality.verdict, "pass");
  assert.equal(take.review.rating, "keeper");
  assert.equal(findGateStatus(take, "transcript_match"), "review");
  assert.equal(take.transcript.matchEstimate?.source, "prompt_only");
  assert.equal(take.observation?.speechRecognition.availability, "unavailable");
});

test("recorded take is rejected when clipping is detected", () => {
  const { prompt, session } = createPlannedPrompt();
  const take = createRecordedTake({
    durationMs: 3200,
    fileName: "take.wav",
    media: createMedia(),
    metrics: createMetrics({ clippingDetected: true }),
    profile: createCaptureProfile({ roomToneCaptured: true }),
    prompt,
    recordedAt,
    session,
    takeId,
  });

  assert.equal(take.quality.verdict, "reject");
  assert.equal(take.review.rating, "reject");
  assert.equal(findGateStatus(take, "clipping"), "fail");
});

test("recorded take is rejected when capture reached its memory limit", () => {
  const { prompt, session } = createPlannedPrompt();
  const take = createRecordedTake({
    durationMs: 3200,
    fileName: "take.wav",
    media: createMedia(),
    metrics: createMetrics(),
    profile: createCaptureProfile({ roomToneCaptured: true }),
    prompt,
    recordedAt,
    recognizedTranscript: prompt.text,
    session,
    takeId,
    truncated: true,
  });

  assert.equal(take.quality.verdict, "reject");
  assert.equal(findGateStatus(take, "capture_truncated"), "fail");
});

test("recorded take is rejected when signal level is effectively silent", () => {
  const { prompt, session } = createPlannedPrompt();
  const take = createRecordedTake({
    durationMs: 3200,
    fileName: "take.wav",
    media: createMedia(),
    metrics: createMetrics({
      peakDbfs: -60,
      integratedLufs: -62,
      snrDb: 10,
    }),
    profile: createCaptureProfile({ roomToneCaptured: true }),
    prompt,
    recordedAt,
    session,
    takeId,
  });

  assert.equal(take.quality.verdict, "reject");
  assert.equal(findGateStatus(take, "signal_level"), "fail");
});

test("recorded take remains review when room tone has not been captured", () => {
  const { prompt, session } = createPlannedPrompt();
  const take = createRecordedTake({
    durationMs: 3200,
    fileName: "take.wav",
    media: createMedia(),
    metrics: createMetrics(),
    profile: createCaptureProfile({ roomToneCaptured: false }),
    prompt,
    recordedAt,
    session,
    takeId,
  });

  assert.equal(take.quality.verdict, "review");
  assert.equal(take.review.rating, "maybe");
  assert.equal(findGateStatus(take, "noise_floor"), "review");
});

test("recorded take reviews noisy calibrated room tone", () => {
  const { prompt, session } = createPlannedPrompt();
  const take = createRecordedTake({
    durationMs: 3200,
    fileName: "take.wav",
    media: createMedia(),
    metrics: createMetrics({ noiseFloorDbfs: -72 }),
    profile: createCaptureProfile({
      roomToneCaptured: true,
      roomToneNoiseFloorDbfs: -43,
    }),
    prompt,
    recordedAt,
    session,
    takeId,
  });

  assert.equal(take.quality.verdict, "review");
  assert.equal(findGateStatus(take, "noise_floor"), "review");
});

test("recorded take explains automatic gain and compares room tone against the raw source", () => {
  const { prompt, session } = createPlannedPrompt();
  const take = createRecordedTake({
    durationMs: 3200,
    fileName: "take.wav",
    media: createMedia({
      factor: 2,
      gainDb: 20 * Math.log10(2),
      limitedBy: "noise_floor",
      mode: "auto",
      noiseFloorCeilingDbfs: -42,
      sourceIntegratedLufs: -30,
      sourceNoiseFloorDbfs: -48,
      sourcePeakDbfs: -18,
      sourceTruePeakDbfs: -17,
      targetLufs: -20,
      truePeakCeilingDbfs: -3,
    }),
    metrics: createMetrics({ noiseFloorDbfs: -42 }),
    profile: createCaptureProfile({
      roomToneCaptured: true,
      roomToneNoiseFloorDbfs: -50,
    }),
    prompt,
    recordedAt,
    session,
    takeId,
  });

  const gainGate = take.quality.gates.find((gate) => gate.id === "input_gain");
  const roomGate = take.quality.gates.find((gate) => gate.id === "noise_floor");

  assert.equal(gainGate?.status, "pass");
  assert.match(gainGate?.message ?? "", /Auto.*bruit de pièce/);
  assert.match(roomGate?.message ?? "", /Dérive relative : 2 dB/);
});

test("recorded take reviews room tone drift even when the absolute floor is acceptable", () => {
  const { prompt, session } = createPlannedPrompt();
  const take = createRecordedTake({
    durationMs: 3200,
    fileName: "drift.wav",
    media: createMedia(),
    metrics: createMetrics({ noiseFloorDbfs: -52 }),
    profile: createCaptureProfile({
      roomToneCaptured: true,
      roomToneNoiseFloorDbfs: -60,
    }),
    prompt,
    recordedAt,
    session,
    takeId,
  });

  assert.equal(take.quality.verdict, "review");
  assert.equal(take.quality.technical.roomToneDriftDb, 8);
  assert.equal(findGateStatus(take, "noise_floor"), "review");
});

test("recorded take remains review when prompt duration bounds are missed", () => {
  const { prompt, session } = createPlannedPrompt();
  const take = createRecordedTake({
    durationMs: prompt.qa.minDurationMs - 1,
    fileName: "take.wav",
    media: createMedia(),
    metrics: createMetrics(),
    profile: createCaptureProfile({ roomToneCaptured: true }),
    prompt,
    recordedAt,
    session,
    takeId,
  });

  assert.equal(take.quality.verdict, "review");
  assert.equal(findGateStatus(take, "duration"), "review");
});

function createPlannedPrompt(): {
  readonly prompt: PromptDefinition;
  readonly session: CaptureSession;
} {
  const workspace = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-09T08:00:00.000Z"),
  });
  const session = planSession({
    workspace,
    corpus: canonicalCorpus,
    speakerId,
    language,
    targetMinutes: 5,
    now: new Date("2026-07-09T08:01:00.000Z"),
  });
  const prompt = canonicalCorpus.scenarios
    .flatMap((scenario) => scenario.prompts)
    .find((candidate) => candidate.id === session.plannedPromptIds[0]);

  assert.ok(prompt, "planned prompt should exist in the canonical corpus");

  return { prompt, session };
}

function createCaptureProfile(
  patch: Partial<CaptureProfile> = {},
): CaptureProfile {
  return {
    microphoneName: "SM7B",
    audioInterface: "Apollo Solo",
    mouthToMicDistanceCm: 15,
    roomDescription: "Dry treated office",
    roomToneCaptured: true,
    ...patch,
  };
}

function createMetrics(
  patch: Partial<PcmRecordingMetrics> = {},
): PcmRecordingMetrics {
  return {
    schemaVersion: "voice.audio_metrics.v1",
    durationMs: 3200,
    sampleRateHz: 48000,
    bitDepth: 24,
    channels: 1,
    sampleCount: 153600,
    peakDbfs: -12,
    estimatedTruePeakDbfs: -12,
    rmsDbfs: -19.3,
    integratedLufs: -20,
    noiseFloorDbfs: -72,
    snrDb: 36,
    crestFactorDb: 7.3,
    dcOffset: 0,
    clippingDetected: false,
    clippingSampleCount: 0,
    clippingRate: 0,
    activeSpeechRatio: 0.8,
    silenceRatio: 0.1,
    voicedFrameRatio: 0.72,
    meanPitchHz: 155,
    pitchRangeSemitones: 5.2,
    pitchVariationSemitones: 1.8,
    energyVariationDb: 4.2,
    reverbScore: 0.1,
    plosiveScore: 0.02,
    mouthNoiseScore: 0.02,
    ...patch,
  };
}

function createMedia(
  digitalGain?: NonNullable<
    AudioCaptureProvenance["processing"]["digitalGain"]
  >,
) {
  return {
    schemaVersion: "voice.media.v1" as const,
    byteLength: 460844,
    container: "WAVE" as const,
    codec: "PCM" as const,
    mimeType: "audio/wav" as const,
    sha256: "a".repeat(64),
    capture: {
      schemaVersion: "voice.capture_provenance.v1" as const,
      captureApi: "MediaStream" as const,
      capturedChannelCount: 1,
      capturedSampleRateHz: 48000,
      deviceGroupId: null,
      deviceId: null,
      deviceLabel: "SM7B",
      requestedFormat: {
        bitDepth: 24,
        channels: 1,
        sampleRateHz: 48000,
      },
      processing: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        ...(digitalGain === undefined ? {} : { digitalGain }),
      },
      sourceSampleRateHz: 48000,
      targetSampleRateHz: 48000,
      resampledToTarget: false,
    },
  };
}

function findGateStatus(
  take: ReturnType<typeof createRecordedTake>,
  gateId: ReturnType<
    typeof createRecordedTake
  >["quality"]["gates"][number]["id"],
) {
  return take.quality.gates.find((gate) => gate.id === gateId)?.status;
}
