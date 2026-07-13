import assert from "node:assert/strict";
import test from "node:test";
import { encodeWav24 } from "../src/app/audio/pcmAudio";
import { validatePcmWavBlob } from "../src/app/audio/wavValidation";
import { createVoiceCapturePackageZip } from "../src/app/export/downloadDatasetPackage";
import { validateVoiceCapturePackageArchive } from "../src/app/export/voiceCapturePackageArchive";
import { readStoredZipEntries } from "../src/app/export/zipReader";
import { createZipBlobOffThread } from "../src/app/export/zipService";
import {
  createVoiceCapturePackagePlan,
  validateVoiceCapturePackagePlan,
  VOICE_CAPTURE_PACKAGE_SCHEMA,
  type ConsentRecord,
  type LicenseRecord,
  type VoiceCapturePackageScope,
} from "../src/app/export/voiceCapturePackage";
import { sha256Blob } from "../src/app/storage/sha256";
import { canonicalCorpus, type PromptDefinition } from "../src/domains/corpus";
import { alignPromptToPhonemes } from "../src/domains/phonetics";
import { createTakeObservationPackage } from "../src/domains/observations";
import { initialSpeakers } from "../src/domains/speakers";
import {
  planSession,
  type CaptureSession,
  type RecordedTake,
  type TakeId,
} from "../src/domains/sessions";
import {
  completePlannedSession,
  createEmptyWorkspace,
  type VoiceWorkspace,
} from "../src/domains/workspace";
import type { IsoDateTime, LanguageCode } from "../src/shared";

const frSpeaker = initialSpeakers[0];
const enSpeaker = initialSpeakers[1];

test("voice capture package v1 exports a self-validating Forge contract with explicit unresolved rights", async () => {
  const fixture = await createFixture({ speakerIndex: 0, language: "fr" });
  const plan = await createVoiceCapturePackagePlan({
    corpus: canonicalCorpus,
    getAudioBlob: async (fileName) => fixture.audioByFileName.get(fileName),
    scope: createScope(fixture.workspace, {
      speakerId: frSpeaker.id,
      language: "fr",
      sessionIds: [fixture.session.id],
    }),
    speakerProfiles: initialSpeakers,
    workspace: fixture.workspace,
    now: new Date("2026-07-10T08:00:00.000Z"),
  });

  assert.equal(plan.manifest.schema_version, VOICE_CAPTURE_PACKAGE_SCHEMA);
  assert.equal(plan.samples.length, 1);
  assert.equal(plan.manifest.counts.samples, 1);
  assert.equal(plan.manifest.rights_status, "blocked");
  assert.equal(plan.forgeCompatibility.ready, false);
  assert.ok(plan.forgeCompatibility.errors.includes("rights_not_resolved"));
  assert.ok(plan.files.some((file) => file.path === "manifest.json"));
  assert.ok(plan.files.some((file) => file.path === "samples.jsonl"));
  assert.ok(plan.files.some((file) => file.path === "checksums.sha256"));
  assert.ok(
    plan.files.some((file) => file.path === "reports/forge-compatibility.json"),
  );
  assert.ok(
    plan.files.some((file) => file.path === plan.samples[0].observations?.path),
  );
  assert.ok(
    plan.files.some(
      (file) => file.path === plan.samples[0].observations?.evidence_path,
    ),
  );
  assert.equal(
    plan.samples[0].observations?.schema_version,
    "voice.take_observation.v1",
  );
  assert.match(plan.samples[0].audio.path, /^audio\/audio_[a-f0-9]{64}\.wav$/);
  assert.equal(plan.samples[0].audio.raw_immutable, true);
  assert.equal(plan.samples[0].audio.source_signal_retained, false);
  assert.equal(plan.samples[0].audio.digital_gain?.mode, "auto");
  assert.equal(plan.samples[0].audio.digital_gain?.factor, 2);
  assert.equal(plan.samples[0].alignment.status, "estimated_g2p");
  assert.equal(plan.samples[0].lifecycle.status, "training_candidate");
  assert.ok(plan.samples[0].lifecycle.review_required);

  const validation = await validateVoiceCapturePackagePlan(plan);
  assert.equal(validation.valid, true, validation.errors.join("\n"));

  const zip = await createVoiceCapturePackageZip({ plan });
  assert.equal(zip.writtenFiles, plan.files.length);
  assert.ok(zip.blob.size > 0);
  const archiveValidation = await validateVoiceCapturePackageArchive(zip.blob);
  assert.equal(
    archiveValidation.valid,
    true,
    archiveValidation.errors.join("\n"),
  );

  const entries = await readStoredZipEntries(zip.blob);
  const corrupted = await createZipBlobOffThread([
    ...[...entries].map(([path, data]) => ({ path, data })),
    { path: "unexpected.txt", data: new Blob(["unexpected"]) },
  ]);
  const corruptedValidation =
    await validateVoiceCapturePackageArchive(corrupted);
  assert.equal(corruptedValidation.valid, false);
  assert.ok(
    corruptedValidation.errors.includes(
      "Unmanifested archive entry: unexpected.txt",
    ),
  );
  assert.ok(
    corruptedValidation.errors.includes("Checksum row missing: unexpected.txt"),
  );
});

test("voice capture package v1 rejects missing audio instead of creating partial packages", async () => {
  const fixture = await createFixture({ speakerIndex: 0, language: "fr" });

  await assert.rejects(
    createVoiceCapturePackagePlan({
      corpus: canonicalCorpus,
      getAudioBlob: async () => undefined,
      scope: createScope(fixture.workspace, {
        speakerId: frSpeaker.id,
        language: "fr",
        sessionIds: [fixture.session.id],
      }),
      speakerProfiles: initialSpeakers,
      workspace: fixture.workspace,
    }),
    /is missing; package creation is aborted/,
  );
});

test("voice capture archive validator rejects a malformed ZIP", async () => {
  const validation = await validateVoiceCapturePackageArchive(new Blob([]));

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.length > 0);
});

test("voice capture package exposes local acoustic evidence without claiming forced alignment", async () => {
  const fixture = await createFixture({
    speakerIndex: 0,
    language: "fr",
    localAcousticAnalysis: true,
  });
  const plan = await createVoiceCapturePackagePlan({
    corpus: canonicalCorpus,
    getAudioBlob: async (fileName) => fixture.audioByFileName.get(fileName),
    scope: createScope(fixture.workspace, {
      speakerId: frSpeaker.id,
      language: "fr",
      sessionIds: [fixture.session.id],
    }),
    speakerProfiles: initialSpeakers,
    workspace: fixture.workspace,
  });

  assert.equal(plan.samples[0].alignment.status, "local_acoustic_comparison");
  assert.equal(plan.samples[0].alignment.kind, "acoustic_evidence");
  assert.equal(plan.samples[0].alignment.confidence, 0.96);
  assert.ok(
    plan.samples[0].lifecycle.reasons.includes(
      "local_acoustic_alignment_requires_confirmation",
    ),
  );
  assert.ok(
    plan.manifest.readiness.downstream_required.includes(
      "external_forced_alignment_for_training_acceptance",
    ),
  );
});

test("voice capture package v1 rejects non-canonical WAV sources", async () => {
  const fixture = await createFixture({ speakerIndex: 0, language: "fr" });
  const corruptBlob = new Blob([new Uint8Array([1, 2, 3, 4])], {
    type: "audio/wav",
  });

  await assert.rejects(
    createVoiceCapturePackagePlan({
      corpus: canonicalCorpus,
      getAudioBlob: async () => corruptBlob,
      scope: createScope(fixture.workspace, {
        speakerId: frSpeaker.id,
        language: "fr",
        sessionIds: [fixture.session.id],
      }),
      speakerProfiles: initialSpeakers,
      workspace: fixture.workspace,
    }),
    /not canonical PCM WAV/,
  );
});

test("voice capture package v1 validates safe paths and detects broken sample relations", async () => {
  const fixture = await createFixture({ speakerIndex: 0, language: "fr" });
  const plan = await createVoiceCapturePackagePlan({
    corpus: canonicalCorpus,
    getAudioBlob: async (fileName) => fixture.audioByFileName.get(fileName),
    scope: createScope(fixture.workspace, {
      speakerId: frSpeaker.id,
      language: "fr",
      sessionIds: [fixture.session.id],
    }),
    speakerProfiles: initialSpeakers,
    workspace: fixture.workspace,
  });
  const tampered = {
    ...plan,
    files: [
      ...plan.files,
      {
        path: "../escape.wav",
        data: new Blob([], { type: "audio/wav" }),
        mediaType: "audio/wav",
        required: true,
      },
    ],
  };

  const validation = await validateVoiceCapturePackagePlan(tampered);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("Unsafe package path")),
  );
});

test("voice capture package v1 keeps multi-speaker and multi-language provenance per sample", async () => {
  const frFixture = await createFixture({
    speakerIndex: 0,
    language: "fr",
    takeSuffix: "fr",
  });
  const enFixture = await createFixture({
    baseWorkspace: frFixture.workspace,
    speakerIndex: 1,
    language: "en",
    takeSuffix: "en",
    tone: 0.2,
  });
  const audioByFileName = new Map([
    ...frFixture.audioByFileName,
    ...enFixture.audioByFileName,
  ]);

  const plan = await createVoiceCapturePackagePlan({
    corpus: canonicalCorpus,
    getAudioBlob: async (fileName) => audioByFileName.get(fileName),
    scope: createScope(enFixture.workspace, {
      speakerId: [frSpeaker.id, enSpeaker.id],
      language: ["fr", "en"],
      sessionIds: [frFixture.session.id, enFixture.session.id],
    }),
    speakerProfiles: initialSpeakers,
    workspace: enFixture.workspace,
  });

  assert.equal(plan.samples.length, 2);
  assert.deepEqual(
    new Set(plan.samples.map((sample) => sample.speaker_id)),
    new Set([frSpeaker.id, enSpeaker.id]),
  );
  assert.deepEqual(
    new Set(plan.samples.map((sample) => sample.text.language)),
    new Set(["fr", "en"]),
  );
  assert.equal(plan.manifest.counts.speakers, 2);
  assert.equal(plan.manifest.counts.languages, 2);
});

test("voice capture package v1 can be Forge-ingestion-ready only when rights are explicit", async () => {
  const fixture = await createFixture({
    speakerIndex: 0,
    language: "fr",
    forcedAlignment: true,
  });
  const rights: ConsentRecord[] = [
    {
      consentId: "consent.explicit.primary",
      speakerId: frSpeaker.id,
      policyVersion: "2026-07",
      status: "granted",
      grants: ["forge_ingestion", "model_training"],
      restrictions: [],
      grantedAt: "2026-07-10T08:00:00.000Z",
      revokedAt: null,
      evidenceRef: "local-consent-record",
      source: "test_fixture",
    },
  ];
  const licenses: LicenseRecord[] = [
    {
      licenseId: "license.canonical.explicit",
      corpusId: canonicalCorpus.id,
      corpusVersion: canonicalCorpus.version,
      status: "granted",
      spdxId: "MIT",
      restrictions: [],
      evidenceRef: "local-license-record",
      source: "test_fixture",
    },
  ];

  const plan = await createVoiceCapturePackagePlan({
    corpus: canonicalCorpus,
    getAudioBlob: async (fileName) => fixture.audioByFileName.get(fileName),
    licenses,
    rights,
    scope: createScope(fixture.workspace, {
      speakerId: frSpeaker.id,
      language: "fr",
      sessionIds: [fixture.session.id],
    }),
    speakerProfiles: initialSpeakers,
    workspace: fixture.workspace,
  });

  assert.equal(plan.manifest.rights_status, "resolved");
  assert.equal(plan.forgeCompatibility.ready, true);
  assert.equal(plan.samples[0].alignment.status, "external_forced_alignment");
  assert.equal(plan.samples[0].lifecycle.status, "training_candidate");
});

test("wav validation accepts the production encoder and rejects malformed RIFF", async () => {
  const wav = createWav(0.1);

  const validation = await validatePcmWavBlob(wav);

  assert.equal(validation.byteLength, wav.size);
  assert.equal(validation.dataByteLength, 14400);
  assert.equal(validation.sampleRateHz, 48000);
  assert.equal(validation.channels, 1);
  assert.equal(validation.bitDepth, 24);

  await assert.rejects(
    validatePcmWavBlob(new Blob([new Uint8Array([82, 73, 70, 70])])),
    /shorter than its canonical header|RIFF/,
  );
});

async function createFixture(input: {
  readonly baseWorkspace?: VoiceWorkspace;
  readonly forcedAlignment?: boolean;
  readonly localAcousticAnalysis?: boolean;
  readonly language: LanguageCode;
  readonly speakerIndex: 0 | 1;
  readonly takeSuffix?: string;
  readonly tone?: number;
}) {
  const speaker = initialSpeakers[input.speakerIndex];
  const baseWorkspace =
    input.baseWorkspace ??
    createEmptyWorkspace({
      corpus: canonicalCorpus,
      speakers: initialSpeakers,
      now: new Date("2026-07-10T07:00:00.000Z"),
    });
  const session = planSession({
    workspace: baseWorkspace,
    corpus: canonicalCorpus,
    speakerId: speaker.id,
    language: input.language,
    targetMinutes: 5,
    now: new Date(`2026-07-10T07:${input.speakerIndex}1:00.000Z`),
  });
  const prompt = findPrompt(session);
  const wav = createWav(input.tone ?? 0.1);
  const take = await createTake({
    forcedAlignment: input.forcedAlignment ?? false,
    localAcousticAnalysis: input.localAcousticAnalysis ?? false,
    prompt,
    session,
    suffix: input.takeSuffix ?? String(input.speakerIndex),
    wav,
  });
  const completedSession: CaptureSession = { ...session, takes: [take] };
  const workspace = completePlannedSession(
    baseWorkspace,
    canonicalCorpus,
    completedSession,
    new Date(`2026-07-10T07:${input.speakerIndex}2:00.000Z`),
  );

  return {
    audioByFileName: new Map([[take.fileName, wav]]),
    session: completedSession,
    take,
    workspace,
  };
}

async function createTake(input: {
  readonly forcedAlignment: boolean;
  readonly localAcousticAnalysis: boolean;
  readonly prompt: PromptDefinition;
  readonly session: CaptureSession;
  readonly suffix: string;
  readonly wav: Blob;
}): Promise<RecordedTake> {
  const durationMs = 100;
  const alignment = alignPromptToPhonemes({
    durationMs,
    language: input.session.language,
    text: input.prompt.spokenText ?? input.prompt.text,
  });
  const intent: RecordedTake["intent"] = {
    schemaVersion: "voice.intent.v2",
    language: input.session.language,
    intent: input.prompt.intention,
    delivery: input.prompt.delivery,
    direction: {
      directorNote: input.prompt.direction.directorNote,
      avoid: input.prompt.direction.avoid,
    },
    prosody: input.prompt.prosody,
  };
  const technical: RecordedTake["quality"]["technical"] = {
    schemaVersion: "voice.audio_metrics.v1",
    sampleRateHz: 48000,
    bitDepth: 24,
    channels: 1,
    sampleCount: 4800,
    peakDbfs: -12,
    estimatedTruePeakDbfs: -12,
    rmsDbfs: -24,
    integratedLufs: -24,
    noiseFloorDbfs: -72,
    snrDb: 36,
    crestFactorDb: 7,
    dcOffset: 0,
    clippingDetected: false,
    clippingSampleCount: 0,
    clippingRate: 0,
    activeSpeechRatio: 0.7,
    silenceRatio: 0.2,
    voicedFrameRatio: 0.7,
    meanPitchHz: 155,
    pitchRangeSemitones: 5,
    pitchVariationSemitones: 2,
    energyVariationDb: 4,
    reverbScore: 0.1,
    plosiveScore: 0.02,
    mouthNoiseScore: 0.02,
  };

  return {
    id: `take.${input.suffix}` as TakeId,
    promptId: input.prompt.id,
    fileName: `${input.session.id}.${input.suffix}.wav`,
    durationMs,
    recordedAt: "2026-07-10T07:01:30.000Z" as IsoDateTime,
    media: {
      schemaVersion: "voice.media.v1",
      byteLength: input.wav.size,
      container: "WAVE",
      codec: "PCM",
      mimeType: "audio/wav",
      sha256: await sha256Blob(input.wav),
      capture: {
        schemaVersion: "voice.capture_provenance.v1",
        captureApi: "MediaStream",
        capturedChannelCount: 1,
        capturedSampleRateHz: 48000,
        deviceGroupId: "test-device-group",
        deviceId: null,
        deviceLabel: "Test microphone",
        requestedFormat: {
          bitDepth: 24,
          channels: 1,
          sampleRateHz: 48000,
        },
        processing: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          digitalGain: {
            mode: "auto",
            factor: 2,
            gainDb: 6.0206,
            targetLufs: -20,
            truePeakCeilingDbfs: -3,
            noiseFloorCeilingDbfs: -42,
            limitedBy: "target",
            sourcePeakDbfs: -18,
            sourceTruePeakDbfs: -17,
            sourceIntegratedLufs: -26,
            sourceNoiseFloorDbfs: -60,
          },
        },
        sourceSampleRateHz: 48000,
        targetSampleRateHz: 48000,
        resampledToTarget: false,
      },
    },
    transcript: {
      schemaVersion: "voice.transcript.v2",
      originalText: input.prompt.text,
      spokenText: input.prompt.spokenText ?? input.prompt.text,
      observedText: input.prompt.spokenText ?? input.prompt.text,
      strictMatchRequired: true,
      annotations: [],
    },
    timing: {
      schemaVersion: "voice.timing.v2",
      durationMs,
      words: alignment.words,
      phonemes: alignment.phonemes,
      phrases: [{ text: input.prompt.text, startMs: 0, endMs: durationMs }],
      alignment,
      forcedAlignment: input.forcedAlignment
        ? {
            schemaVersion: "voice.forced_alignment.v1",
            source: "external_acoustic_forced_alignment",
            aligner: "test-aligner",
            language: input.session.language,
            durationMs,
            confidence: 0.96,
            words: alignment.words.map((word) => ({
              word: word.word,
              startMs: word.startMs,
              endMs: word.endMs,
              confidence: word.confidence,
              phonemes: word.phonemes,
            })),
            phonemes: alignment.phonemes,
            importedAt: "2026-07-10T08:00:00.000Z",
          }
        : undefined,
      localAcousticAnalysis: input.localAcousticAnalysis
        ? {
            schemaVersion: "voice.local_acoustic_analysis.v1",
            engine: "whisper-tiny",
            transcript: input.prompt.spokenText ?? input.prompt.text,
            analyzedAt: "2026-07-10T08:00:00.000Z",
            words: alignment.words.map((word) => ({
              word: word.word,
              startMs: word.startMs,
              endMs: word.endMs,
              source: "whisper_attention_timestamp" as const,
            })),
            speechSegments: [
              { startMs: 0, endMs: durationMs, source: "silero_vad" },
            ],
            alignmentComparison: {
              schemaVersion: "voice.local_alignment_comparison.v1",
              status: "strong",
              reviewRequired: false,
              matchedWordCount: alignment.words.length,
              expectedWordCount: alignment.words.length,
              whisperWordCount: alignment.words.length,
              matchRate: 1,
              medianBoundaryDeltaMs: 20,
              maximumBoundaryDeltaMs: 20,
              words: [],
            },
          }
        : undefined,
    },
    intent,
    observation: createTakeObservationPackage({
      durationMs,
      generatedAt: "2026-07-10T07:01:30.000Z",
      intent,
      alignment,
      metrics: technical,
      prompt: input.prompt,
      session: input.session,
      transcriptMatch: {
        score: 1,
        source: "web_speech",
        expectedTokens: alignment.tokens.map((token) => token.normalized),
        observedTokens: alignment.tokens.map((token) => token.normalized),
        missingTokens: [],
        extraTokens: [],
      },
    }),
    quality: {
      schemaVersion: "voice.quality.v2",
      technical,
      performance: {
        transcriptMatch: 1,
        alignmentConfidence: alignment.confidence,
        phonemeInventoryCount: alignment.inventory.length,
        wordPhonemeLinkRate: 1,
        intentMatch: 0.95,
        naturalnessHumanReview: null,
        keeper: true,
      },
      gates: [],
      verdict: "pass",
    },
    review: {
      rating: "keeper",
      bestTake: true,
      directorNotes: "Keeper.",
    },
  };
}

function createScope(
  workspace: VoiceWorkspace,
  input: {
    readonly language: LanguageCode | readonly LanguageCode[];
    readonly sessionIds: readonly CaptureSession["id"][];
    readonly speakerId: string | readonly string[];
  },
): VoiceCapturePackageScope {
  const languages = Array.isArray(input.language)
    ? input.language
    : [input.language];
  const speakerIds = Array.isArray(input.speakerId)
    ? input.speakerId
    : [input.speakerId];

  return {
    datasetId: `dataset.${workspace.workspaceId}.test`,
    projectId: "project.voice-capture-studio.test",
    speakerIds,
    languages,
    locales: languages.map((language) =>
      language === "fr" ? "fr-FR" : "en-US",
    ),
    corpusRefs: [{ id: canonicalCorpus.id, version: canonicalCorpus.version }],
    sessionIds: input.sessionIds,
    takeStatuses: ["keeper"],
    includeRoomTones: true,
  };
}

function findPrompt(session: CaptureSession): PromptDefinition {
  const prompt = canonicalCorpus.scenarios
    .flatMap((scenario) => scenario.prompts)
    .find((candidate) => candidate.id === session.plannedPromptIds[0]);

  assert.ok(prompt, `Prompt ${session.plannedPromptIds[0]} should exist`);

  return prompt;
}

function createWav(amplitude: number): Blob {
  const samples = new Float32Array(4800);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin(index / 12) * amplitude;
  }

  return encodeWav24(samples, 48000);
}
