import assert from "node:assert/strict";
import test from "node:test";
import { createRecordedTake } from "../src/app/recording/recordedTake";
import type { PcmRecordingMetrics } from "../src/app/audio/pcmRecorder";
import { canonicalCorpus, type PromptDefinition } from "../src/domains/corpus";
import { initialSpeakers } from "../src/domains/speakers";
import {
  planSession,
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
    metrics: createMetrics(),
    profile: createCaptureProfile({ roomToneCaptured: true }),
    prompt,
    recordedAt,
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
  assert.equal(take.timing.words.at(-1)?.endMs, 3200);
  assert.ok((take.timing.phonemes?.length ?? 0) > take.timing.words.length);
  assert.equal(take.timing.alignment?.forcedAlignmentRequired, true);
  assert.equal(take.quality.performance.wordPhonemeLinkRate, 1);
});

test("recorded take rejects clear transcript mismatch from speech recognition", () => {
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

  assert.equal(take.quality.verdict, "reject");
  assert.equal(findGateStatus(take, "transcript_match"), "fail");
  assert.equal(take.transcript.matchEstimate?.source, "web_speech");
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
    reverbScore: 0.1,
    plosiveScore: 0.02,
    mouthNoiseScore: 0.02,
    ...patch,
  };
}

function createMedia() {
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
