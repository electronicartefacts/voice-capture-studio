import type { CorpusManifest } from "@domains/corpus";
import type {
  AudioCaptureProvenance,
  CaptureSession,
  RecordedTake,
  TakeQuality,
} from "@domains/sessions";
import type { SpeakerProfile } from "@domains/speakers";
import type { LanguageCode } from "@shared/index";
import type { VoiceWorkspace } from "@domains/workspace";
import { sha256Blob, sha256Bytes } from "../storage/sha256";
import {
  validatePcmWavBlob,
  type PcmWavValidation,
} from "../audio/wavValidation";

export const VOICE_CAPTURE_PACKAGE_SCHEMA = "voice.capture.package.v1" as const;
export const VOICE_CAPTURE_PACKAGE_VERSION = "1.0.0" as const;

export type VoiceCapturePackageScope = {
  readonly datasetId: string;
  readonly projectId: string;
  readonly packageId?: string;
  readonly packageVersion?: string;
  readonly speakerIds: readonly string[];
  readonly languages: readonly LanguageCode[];
  readonly locales: readonly string[];
  readonly corpusRefs: readonly CorpusRef[];
  readonly sessionIds: readonly string[];
  readonly takeStatuses: readonly PackageTakeStatus[];
  readonly includeRejected?: boolean;
  readonly includeRoomTones?: boolean;
};

export type CorpusRef = {
  readonly id: string;
  readonly version: string;
};

export type PackageTakeStatus =
  | TakeQuality
  | "captured"
  | "archived"
  | "training_candidate"
  | "training_accepted"
  | "needs_review"
  | "rejected"
  | "quarantined";

export type ConsentRecord = {
  readonly consentId: string;
  readonly speakerId: string;
  readonly policyVersion: string;
  readonly status:
    "pending" | "granted" | "denied" | "revoked" | "expired" | "unknown";
  readonly grants: readonly string[];
  readonly restrictions: readonly string[];
  readonly grantedAt: string | null;
  readonly revokedAt: string | null;
  readonly evidenceRef: string | null;
  readonly source: string;
};

export type LicenseRecord = {
  readonly licenseId: string;
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly status:
    "pending" | "granted" | "denied" | "revoked" | "expired" | "unknown";
  readonly spdxId: string | null;
  readonly restrictions: readonly string[];
  readonly evidenceRef: string | null;
  readonly source: string;
};

export type VoiceCapturePackageFile = {
  readonly path: string;
  readonly data: Blob;
  readonly mediaType: string;
  readonly required: boolean;
};

export type VoiceCapturePackageArtifact = {
  readonly artifactId: string;
  readonly path: string;
  readonly type:
    "audio" | "metadata" | "report" | "provenance" | "text" | "integrity";
  readonly mediaType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly logicalOwner: string;
  readonly required: boolean;
  readonly schemaVersion: string;
  readonly createdAt: string;
};

export type VoiceCapturePackageSample = {
  readonly sample_id: string;
  readonly utterance_id: string;
  readonly take_id: string;
  readonly audio_id: string;
  readonly speaker_id: string;
  readonly session_id: string;
  readonly dataset_id: string;
  readonly project_id: string;
  readonly audio: {
    readonly path: string;
    readonly sha256: string;
    readonly container: "WAVE";
    readonly encoding: "PCM_S24LE";
    readonly sample_rate_hz: number;
    readonly channels: number;
    readonly bit_depth: number;
    readonly duration_ms: number;
    readonly declared_duration_ms: number;
    readonly byte_size: number;
    readonly resampled: boolean | null;
    readonly digital_gain:
      AudioCaptureProvenance["processing"]["digitalGain"] | null;
    readonly source_signal_retained: false;
    /** Legacy field: the delivered WAV is immutable, but may carry declared constant gain. */
    readonly raw_immutable: true;
  };
  readonly text: {
    readonly expected: string;
    readonly normalized: string;
    readonly observed: string | null;
    readonly language: LanguageCode;
    readonly locale: string;
    readonly source_hash: string;
    readonly normalized_hash: string;
    readonly provenance_ref: string;
    readonly license_ref: string | null;
  };
  readonly labels: {
    readonly intent_target: unknown;
    readonly emotion_target: unknown;
    readonly emotion_observed: null;
    readonly style: unknown;
    readonly intensity: unknown;
    readonly valence: number | null;
    readonly arousal: number | null;
    readonly dominance: number | null;
    readonly delivery: unknown;
  };
  readonly alignment: {
    readonly status:
      | "absent"
      | "estimated_g2p"
      | "local_acoustic_comparison"
      | "browser_asr_assisted"
      | "external_forced_alignment"
      | "human_validated";
    readonly kind:
      "none" | "text_alignment" | "acoustic_evidence" | "forced_alignment";
    readonly path: string | null;
    readonly source: string;
    readonly tool: string | null;
    readonly tool_version: string | null;
    readonly confidence: number | null;
  };
  readonly quality: {
    readonly status: "pass" | "review" | "reject";
    readonly path: string;
    readonly gates: unknown;
    readonly verdict: "pass" | "review" | "reject";
  };
  readonly observations?: {
    readonly path: string;
    readonly evidence_path: string;
    readonly schema_version: "voice.take_observation.v1";
  };
  readonly capture_context_ref: string;
  readonly room_tone_ref: string | null;
  readonly consent_refs: readonly string[];
  readonly license_refs: readonly string[];
  readonly lifecycle: {
    readonly status:
      | "captured"
      | "archived"
      | "training_candidate"
      | "training_accepted"
      | "needs_review"
      | "rejected"
      | "quarantined";
    readonly reasons: readonly string[];
    readonly review_required: boolean;
  };
  readonly split: {
    readonly assignment: "unassigned" | "train" | "validation" | "test";
    readonly strategy: string | null;
    readonly seed: string | null;
    readonly group_ids: Readonly<Record<string, string>>;
  };
};

export type VoiceCapturePackageManifest = {
  readonly schema_version: typeof VOICE_CAPTURE_PACKAGE_SCHEMA;
  readonly package_id: string;
  readonly dataset_id: string;
  readonly project_id: string;
  readonly package_version: string;
  readonly export_version: string;
  readonly created_at: string;
  readonly producer: {
    readonly name: string;
    readonly version: string;
    readonly build: string | null;
    readonly commit: string | null;
  };
  readonly scope: VoiceCapturePackageScope & {
    readonly package_id: string;
  };
  readonly counts: {
    readonly samples: number;
    readonly speakers: number;
    readonly sessions: number;
    readonly corpora: number;
    readonly languages: number;
    readonly locales: number;
    readonly audio_bytes: number;
  };
  readonly artifacts: readonly VoiceCapturePackageArtifact[];
  readonly rights_status: "resolved" | "blocked" | "unknown";
  readonly integrity_status: "verified" | "invalid";
  readonly readiness: {
    readonly forge_ingestion_ready: boolean;
    readonly training_ready: boolean;
    readonly blocking_reasons: readonly string[];
    readonly downstream_required: readonly string[];
  };
};

export type VoiceCapturePackagePlan = {
  readonly rootName: "voice-capture-package";
  readonly manifest: VoiceCapturePackageManifest;
  readonly samples: readonly VoiceCapturePackageSample[];
  readonly files: readonly VoiceCapturePackageFile[];
  readonly checksumsText: string;
  readonly forgeCompatibility: {
    readonly contract: typeof VOICE_CAPTURE_PACKAGE_SCHEMA;
    readonly ready: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly downstream_required: readonly string[];
    readonly guarantees: readonly string[];
  };
};

export type VoiceCapturePackageValidation = {
  readonly valid: boolean;
  readonly errors: readonly string[];
};

export async function createVoiceCapturePackagePlan(input: {
  readonly corpus: CorpusManifest;
  readonly corpora?: readonly CorpusManifest[];
  readonly getAudioBlob: (fileName: string) => Promise<Blob | undefined>;
  readonly now?: Date;
  readonly producer?: Partial<VoiceCapturePackageManifest["producer"]>;
  readonly rights?: readonly ConsentRecord[];
  readonly licenses?: readonly LicenseRecord[];
  readonly speakerProfiles?: readonly SpeakerProfile[];
  readonly scope: VoiceCapturePackageScope;
  readonly workspace: VoiceWorkspace;
}): Promise<VoiceCapturePackagePlan> {
  const createdAt = (input.now ?? new Date()).toISOString();
  const scope = normalizeScope(input.scope);
  const packageId = scope.packageId ?? createUuid();
  const corpora = uniqueCorpora([input.corpus, ...(input.corpora ?? [])]);
  const corpusByRef = new Map(
    corpora.map((corpus) => [corpusRefKey(corpus), corpus] as const),
  );
  const sessions = selectSessions(
    input.workspace.capturedSessions,
    scope,
    corpusByRef,
  );
  const speakersById = new Map<
    string,
    (typeof input.workspace.speakers)[number]
  >(
    input.workspace.speakers.map(
      (speaker) => [speaker.speakerId, speaker] as const,
    ),
  );
  const profilesById = new Map<string, SpeakerProfile>(
    (input.speakerProfiles ?? []).map(
      (speaker) => [speaker.id, speaker] as const,
    ),
  );
  const promptBySession = new Map(
    sessions.map(
      (session) =>
        [
          session.id,
          new Map(
            corpusByRef
              .get(corpusRefKeyForSession(session, corpusByRef))
              ?.scenarios.flatMap((scenario) => scenario.prompts)
              .map((prompt) => [prompt.id, prompt] as const) ?? [],
          ),
        ] as const,
    ),
  );
  const selectedTakes = sessions.flatMap((session) =>
    session.takes
      .filter((take) => shouldIncludeTake(take, scope.takeStatuses))
      .map((take) => ({ session, take })),
  );

  if (selectedTakes.length === 0) {
    throw new Error("The explicit export scope contains no matching takes.");
  }

  const files: VoiceCapturePackageFile[] = [];
  const samples: VoiceCapturePackageSample[] = [];
  const sessionPaths = new Map<string, string>();
  const contextBySession = new Map<
    string,
    ReturnType<typeof createCaptureContext>
  >();
  const speakerPaths = new Map<string, string>();
  const corpusPaths = new Map<string, string>();
  const legacyWarnings: string[] = [];
  let audioBytes = 0;

  for (const session of sessions) {
    const sessionKey = pathToken(session.id);
    const sessionPath = `sessions/${sessionKey}.json`;
    sessionPaths.set(session.id, sessionPath);
    const corpus = corpusByRef.get(
      corpusRefKeyForSession(session, corpusByRef),
    );
    if (corpus === undefined) {
      throw new Error(
        `No corpus snapshot was supplied for session ${session.id}.`,
      );
    }
    const captureContext = createCaptureContext(input.workspace, session);
    contextBySession.set(session.id, captureContext);
    addJsonFile(files, sessionPath, {
      schema_version: "voice.capture.session.v1",
      session_id: session.id,
      speaker_id: session.speakerId,
      language: session.language,
      corpus_id: session.corpusId,
      corpus_version: corpus.version,
      started_at: session.startedAt,
      completed_at: session.completedAt ?? null,
      planned_prompt_ids: session.plannedPromptIds,
      take_ids: session.takes.map((take) => take.id),
      capture_context: captureContext,
      room_tone: {
        status: captureContext.room_tone.status,
        ref: null,
        audio_retained: false,
        reason: captureContext.room_tone.reason,
      },
    });
  }

  for (const speakerId of scope.speakerIds) {
    const workspaceSpeaker = speakersById.get(speakerId);
    const profile = profilesById.get(speakerId);
    const speakerPath = `speakers/${pathToken(speakerId)}.json`;
    speakerPaths.set(speakerId, speakerPath);
    addJsonFile(files, speakerPath, {
      schema_version: "voice.capture.speaker.v1",
      speaker_id: speakerId,
      pseudonymized: true,
      display_name: null,
      identity_source: "local_workspace_profile",
      primary_language:
        profile?.primaryLanguage ?? workspaceSpeaker?.languages[0] ?? null,
      languages:
        profile?.supportedLanguages ?? workspaceSpeaker?.languages ?? [],
    });
  }

  for (const corpus of corpora.filter((candidate) =>
    scope.corpusRefs.some(
      (ref) => corpusRefKey(ref) === corpusRefKey(candidate),
    ),
  )) {
    const corpusPath = `corpora/${pathToken(corpus.id)}/${pathToken(corpus.version)}.json`;
    corpusPaths.set(corpusRefKey(corpus), corpusPath);
    addJsonFile(files, corpusPath, {
      schema_version: "voice.capture.corpus.v1",
      corpus,
    });
  }

  const consents = scope.speakerIds.map(
    (speakerId) =>
      input.rights?.find((record) => record.speakerId === speakerId) ??
      createUnknownConsent(speakerId),
  );
  const licenses = scope.corpusRefs.map(
    (ref) =>
      input.licenses?.find(
        (record) =>
          record.corpusId === ref.id && record.corpusVersion === ref.version,
      ) ?? createUnknownLicense(ref),
  );
  addJsonlFile(files, "rights/consents.jsonl", consents);
  addJsonlFile(files, "rights/licenses.jsonl", licenses);

  const licenseByCorpus = new Map(
    licenses.map((license) => [corpusRefKey(license), license] as const),
  );
  const consentBySpeaker = new Map(
    consents.map((consent) => [consent.speakerId, consent] as const),
  );
  const provenanceRows: unknown[] = [];

  for (const { session, take } of selectedTakes) {
    const prompt = promptBySession.get(session.id)?.get(take.promptId);
    const corpus = corpusByRef.get(
      corpusRefKeyForSession(session, corpusByRef),
    );
    if (prompt === undefined || corpus === undefined) {
      throw new Error(
        `Take ${take.id} has no prompt/corpus provenance in the selected scope.`,
      );
    }

    const audioBlob = await input.getAudioBlob(take.fileName);
    if (audioBlob === undefined) {
      throw new Error(
        `Audio file ${take.fileName} is missing; package creation is aborted.`,
      );
    }
    let wav: PcmWavValidation;
    try {
      wav = await validatePcmWavBlob(audioBlob);
    } catch (error) {
      throw new Error(
        `Audio file ${take.fileName} is not canonical PCM WAV: ${error instanceof Error ? error.message : "invalid audio"}`,
        { cause: error },
      );
    }
    const audioHash = await sha256Blob(audioBlob);
    const legacyMedia = readMedia(take);
    if (
      legacyMedia?.sha256 !== undefined &&
      legacyMedia.sha256.length > 0 &&
      legacyMedia.sha256 !== audioHash
    ) {
      throw new Error(`Audio hash mismatch for take ${take.id}.`);
    }
    if (legacyMedia === undefined) {
      legacyWarnings.push(
        `Take ${take.id} has legacy-unavailable media provenance.`,
      );
    }

    const takeKey = pathToken(take.id);
    const audioId = `audio_${audioHash}`;
    const audioPath = `audio/${audioId}.wav`;
    const utteranceText =
      take.transcript.spokenText || take.transcript.originalText;
    const normalizedText = normalizeText(utteranceText);
    const utteranceId = `utterance_${stableToken(`${corpusRefKey(corpus)}:${take.promptId}:${normalizedText}`)}`;
    const textPath = `text/${pathToken(utteranceId)}.json`;
    const alignmentPath = `alignment/${takeKey}.json`;
    const qualityPath = `quality/${takeKey}.json`;
    const reviewPath = `reviews/${takeKey}.json`;
    const observationPath = `observations/${takeKey}.json`;
    const evidencePath = `evidence/${takeKey}.json`;
    const contextPath = sessionPaths.get(session.id);
    const captureContext = contextBySession.get(session.id);
    if (contextPath === undefined || captureContext === undefined) {
      throw new Error(`No session context path exists for ${session.id}.`);
    }
    const license = licenseByCorpus.get(corpusRefKey(corpus));
    const consent = consentBySpeaker.get(session.speakerId);
    if (license === undefined || consent === undefined) {
      throw new Error(`Rights records are incomplete for take ${take.id}.`);
    }

    addAudioFile(files, audioPath, audioBlob);
    addJsonFile(files, textPath, {
      schema_version: "voice.capture.text.v1",
      utterance_id: utteranceId,
      expected: take.transcript.originalText,
      normalized: normalizedText,
      observed: take.transcript.observedText ?? null,
      language: session.language,
      locale: localeFor(session.language),
      source_hash: sha256Bytes(
        new TextEncoder().encode(take.transcript.originalText),
      ),
      normalized_hash: sha256Bytes(new TextEncoder().encode(normalizedText)),
      provenance_ref: `corpus:${corpus.id}@${corpus.version}#prompt:${take.promptId}`,
      license_ref: license.licenseId,
      source_timecodes: null,
    });
    const alignment = createAlignmentRecord(take, alignmentPath);
    addJsonFile(files, alignmentPath, {
      schema_version: "voice.capture.alignment.v1",
      take_id: take.id,
      ...alignment,
      timing: take.timing,
    });
    addJsonFile(files, qualityPath, {
      schema_version: "voice.capture.quality.v1",
      take_id: take.id,
      audio_validation: wav,
      quality: take.quality,
    });
    addJsonFile(files, reviewPath, {
      schema_version: "voice.capture.review.v1",
      take_id: take.id,
      review: take.review,
      best_take_policy: "not_used_for_training_acceptance",
    });
    if (take.observation !== undefined) {
      addJsonFile(files, observationPath, take.observation);
      addJsonFile(files, evidencePath, {
        schema_version: "voice.capture.evidence.v1",
        take_id: take.id,
        decisions: take.observation.decisions,
        limitations: take.observation.limitations,
      });
    }

    const lifecycle = lifecycleFor(
      take,
      alignment.status,
      isConsentTrainingGrantValid(consent),
    );
    const sample: VoiceCapturePackageSample = {
      sample_id: `sample_${stableToken(`${session.id}:${take.id}`)}`,
      utterance_id: utteranceId,
      take_id: take.id,
      audio_id: audioId,
      speaker_id: session.speakerId,
      session_id: session.id,
      dataset_id: scope.datasetId,
      project_id: scope.projectId,
      audio: {
        path: audioPath,
        sha256: audioHash,
        container: "WAVE",
        encoding: "PCM_S24LE",
        sample_rate_hz: wav.sampleRateHz,
        channels: wav.channels,
        bit_depth: wav.bitDepth,
        duration_ms: wav.durationMs,
        declared_duration_ms: take.durationMs,
        byte_size: audioBlob.size,
        resampled: legacyMedia?.capture.resampledToTarget ?? null,
        digital_gain: legacyMedia?.capture.processing.digitalGain ?? null,
        source_signal_retained: false,
        raw_immutable: true,
      },
      text: {
        expected: take.transcript.originalText,
        normalized: normalizedText,
        observed: take.transcript.observedText ?? null,
        language: session.language,
        locale: localeFor(session.language),
        source_hash: sha256Bytes(
          new TextEncoder().encode(take.transcript.originalText),
        ),
        normalized_hash: sha256Bytes(new TextEncoder().encode(normalizedText)),
        provenance_ref: `corpus:${corpus.id}@${corpus.version}#prompt:${take.promptId}`,
        license_ref: license.licenseId,
      },
      labels: {
        intent_target: take.intent.intent,
        emotion_target: prompt.intention.emotion,
        emotion_observed: null,
        style: take.intent.delivery.tone,
        intensity: take.intent.delivery.energy,
        valence: prompt.intention.emotion.valence,
        arousal: prompt.intention.emotion.arousal,
        dominance: prompt.intention.emotion.dominance,
        delivery: take.intent.delivery,
      },
      alignment,
      quality: {
        status: take.quality.verdict,
        path: qualityPath,
        gates: take.quality.gates,
        verdict: take.quality.verdict,
      },
      ...(take.observation === undefined
        ? {}
        : {
            observations: {
              path: observationPath,
              evidence_path: evidencePath,
              schema_version: "voice.take_observation.v1" as const,
            },
          }),
      capture_context_ref: contextPath,
      room_tone_ref: null,
      consent_refs: [consent.consentId],
      license_refs: [license.licenseId],
      lifecycle,
      split: {
        assignment: "unassigned",
        strategy: null,
        seed: null,
        group_ids: {
          speaker: stableToken(session.speakerId),
          session: stableToken(session.id),
          prompt: stableToken(take.promptId),
          normalized_text: stableToken(normalizedText),
          corpus: stableToken(corpusRefKey(corpus)),
          environment: stableToken(environmentGroup(captureContext)),
          room_tone: "unknown",
          device: stableToken(legacyMedia?.capture.deviceGroupId ?? "unknown"),
          day: stableToken(take.recordedAt.slice(0, 10)),
        },
      },
    };
    samples.push(sample);
    provenanceRows.push({
      provenance_id: sample.utterance_id,
      utterance_id: sample.utterance_id,
      source_type: "corpus_prompt",
      source_ref: sample.text.provenance_ref,
      source_hash: sample.text.source_hash,
      license_ref: license.licenseId,
      timecodes: null,
    });
    audioBytes += audioBlob.size;
  }

  addJsonlFile(files, "rights/text-provenance.jsonl", provenanceRows);
  addTextFile(
    files,
    "samples.jsonl",
    `${samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`,
  );

  const qualitySummary = createQualitySummary(samples);
  const coverageSummary = createCoverageSummary(samples);
  const rightsStatus = getRightsStatus(consents, licenses);
  const downstreamRequired = uniqueStrings([
    ...samples
      .filter(
        (sample) =>
          sample.alignment.status === "estimated_g2p" ||
          sample.alignment.status === "local_acoustic_comparison",
      )
      .map(() => "external_forced_alignment_for_training_acceptance"),
    ...samples
      .filter((sample) => sample.lifecycle.review_required)
      .map(() => "human_review_before_training_acceptance"),
  ]);
  const blockingReasons = uniqueStrings([
    ...(rightsStatus === "resolved" ? [] : ["rights_not_resolved"]),
    ...(samples.some((sample) => sample.audio.sha256.length === 0)
      ? ["audio_hash_missing"]
      : []),
  ]);
  const forgeReady = blockingReasons.length === 0;
  const trainingReady =
    forgeReady &&
    samples.every((sample) => sample.lifecycle.status === "training_accepted");
  const forgeCompatibility = {
    contract: VOICE_CAPTURE_PACKAGE_SCHEMA,
    ready: forgeReady,
    errors: blockingReasons,
    warnings: uniqueStrings([
      ...legacyWarnings,
      ...(scope.includeRoomTones === true
        ? ["room_tone_audio_not_retained_by_legacy_calibration"]
        : ["room_tone_not_included_in_scope"]),
    ]),
    downstream_required: downstreamRequired,
    guarantees: [
      "explicit_scope",
      "per_sample_provenance",
      "canonical_pcm_s24le_mono_48khz_wav",
      "sha256_audio_and_artifacts",
      "no_implicit_consent",
      "unassigned_split_until_group_aware_assignment",
    ],
  } as const;
  addJsonFile(files, "reports/package-readiness.json", {
    schema_version: "voice.capture.package_readiness.v1",
    ready: forgeReady,
    training_ready: trainingReady,
    blocking_reasons: blockingReasons,
    downstream_required: downstreamRequired,
    sample_count: samples.length,
  });
  addJsonFile(files, "reports/quality-summary.json", qualitySummary);
  addJsonFile(files, "reports/coverage-summary.json", coverageSummary);
  addJsonFile(files, "reports/forge-compatibility.json", forgeCompatibility);
  addTextFile(
    files,
    "README.md",
    createPackageReadme(scope, forgeCompatibility, samples.length),
  );

  const artifacts = await createArtifacts(files, createdAt, samples);
  const manifest: VoiceCapturePackageManifest = {
    schema_version: VOICE_CAPTURE_PACKAGE_SCHEMA,
    package_id: packageId,
    dataset_id: scope.datasetId,
    project_id: scope.projectId,
    package_version: scope.packageVersion ?? VOICE_CAPTURE_PACKAGE_VERSION,
    export_version: VOICE_CAPTURE_PACKAGE_VERSION,
    created_at: createdAt,
    producer: {
      name: input.producer?.name ?? "voice-capture-studio",
      version: input.producer?.version ?? "0.1.0",
      build: input.producer?.build ?? null,
      commit: input.producer?.commit ?? null,
    },
    scope: { ...scope, package_id: packageId },
    counts: {
      samples: samples.length,
      speakers: new Set(samples.map((sample) => sample.speaker_id)).size,
      sessions: new Set(samples.map((sample) => sample.session_id)).size,
      corpora: new Set(
        samples.map((sample) => sample.text.provenance_ref.split("#", 1)[0]),
      ).size,
      languages: new Set(samples.map((sample) => sample.text.language)).size,
      locales: new Set(samples.map((sample) => sample.text.locale)).size,
      audio_bytes: audioBytes,
    },
    artifacts,
    rights_status: rightsStatus,
    integrity_status: "verified",
    readiness: {
      forge_ingestion_ready: forgeReady,
      training_ready: trainingReady,
      blocking_reasons: blockingReasons,
      downstream_required: downstreamRequired,
    },
  };

  const manifestBlob = jsonBlob(manifest);
  const filesWithManifest = [
    ...files,
    file("manifest.json", manifestBlob, "application/json"),
  ];
  const checksums = await createChecksums(filesWithManifest);
  filesWithManifest.push(
    file("checksums.sha256", textBlob(checksums), "text/plain;charset=utf-8"),
  );
  const plan: VoiceCapturePackagePlan = {
    rootName: "voice-capture-package",
    manifest,
    samples,
    files: filesWithManifest,
    checksumsText: checksums,
    forgeCompatibility,
  };
  const validation = await validateVoiceCapturePackagePlan(plan);
  if (!validation.valid) {
    throw new Error(
      `Generated package failed self-validation: ${validation.errors.join("; ")}`,
    );
  }
  return plan;
}

export async function validateVoiceCapturePackagePlan(
  plan: VoiceCapturePackagePlan,
): Promise<VoiceCapturePackageValidation> {
  const errors: string[] = [];
  const byPath = new Map<string, VoiceCapturePackageFile>();
  for (const entry of plan.files) {
    try {
      assertSafeRelativePath(entry.path);
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : `Unsafe path: ${entry.path}`,
      );
    }
    if (byPath.has(entry.path)) {
      errors.push(`Duplicate package path: ${entry.path}`);
    }
    byPath.set(entry.path, entry);
  }
  if (!byPath.has("manifest.json") || !byPath.has("checksums.sha256")) {
    errors.push("Package must contain manifest.json and checksums.sha256.");
  }
  for (const artifact of plan.manifest.artifacts) {
    const entry = byPath.get(artifact.path);
    if (entry === undefined) {
      errors.push(`Manifest references missing artifact: ${artifact.path}`);
      continue;
    }
    if (entry.data.size !== artifact.byteSize) {
      errors.push(`Artifact size mismatch: ${artifact.path}`);
    }
    const hash = await sha256Blob(entry.data);
    if (hash !== artifact.sha256) {
      errors.push(`Artifact hash mismatch: ${artifact.path}`);
    }
  }
  const manifestHash = byPath.get("manifest.json");
  const checksumsFile = byPath.get("checksums.sha256");
  if (manifestHash !== undefined && checksumsFile !== undefined) {
    const checksumRows = parseChecksums(await checksumsFile.data.text());
    const expectedPaths = [
      "manifest.json",
      ...plan.files
        .filter(
          (entry) =>
            entry.path !== "checksums.sha256" && entry.path !== "manifest.json",
        )
        .map((entry) => entry.path),
    ];
    for (const path of expectedPaths) {
      const entry = byPath.get(path);
      const expectedHash = checksumRows.get(path);
      if (entry === undefined || expectedHash === undefined) {
        errors.push(`Checksum row missing: ${path}`);
        continue;
      }
      if ((await sha256Blob(entry.data)) !== expectedHash) {
        errors.push(`Checksum mismatch: ${path}`);
      }
    }
  }
  const samplesFile = byPath.get("samples.jsonl");
  if (samplesFile !== undefined) {
    for (const [index, row] of (await samplesFile.data.text())
      .split("\n")
      .filter(Boolean)
      .entries()) {
      try {
        const sample = JSON.parse(row) as VoiceCapturePackageSample;
        if (!byPath.has(sample.audio.path))
          errors.push(`Sample ${index} audio path is missing.`);
        if (sample.quality.path !== null && !byPath.has(sample.quality.path))
          errors.push(`Sample ${index} quality path is missing.`);
        if (
          sample.alignment.path !== null &&
          !byPath.has(sample.alignment.path)
        )
          errors.push(`Sample ${index} alignment path is missing.`);
        if (!byPath.has(sample.capture_context_ref))
          errors.push(`Sample ${index} context path is missing.`);
      } catch {
        errors.push(`samples.jsonl line ${index + 1} is not valid JSON.`);
      }
    }
  }
  return { valid: errors.length === 0, errors: uniqueStrings(errors) };
}

function selectSessions(
  sessions: readonly CaptureSession[],
  scope: VoiceCapturePackageScope,
  corpusByRef: ReadonlyMap<string, CorpusManifest>,
): readonly CaptureSession[] {
  const requested = new Set(scope.sessionIds);
  const selected = sessions.filter((session) => requested.has(session.id));
  if (selected.length !== requested.size) {
    throw new Error("The explicit export scope references an unknown session.");
  }
  for (const session of selected) {
    const ref = corpusRefKeyForSession(session, corpusByRef);
    if (
      !scope.speakerIds.includes(session.speakerId) ||
      !scope.languages.includes(session.language) ||
      !scope.corpusRefs.some((candidate) => corpusRefKey(candidate) === ref)
    ) {
      throw new Error(
        `Session ${session.id} falls outside the explicit export scope.`,
      );
    }
  }
  return selected;
}

function shouldIncludeTake(
  take: RecordedTake,
  statuses: readonly PackageTakeStatus[],
): boolean {
  const lifecycle = lifecycleFor(
    take,
    take.timing.forcedAlignment !== undefined
      ? "external_forced_alignment"
      : take.timing.localAcousticAnalysis !== undefined
        ? "local_acoustic_comparison"
        : "estimated_g2p",
    false,
  ).status;
  return statuses.includes(take.review.rating) || statuses.includes(lifecycle);
}

function lifecycleFor(
  take: RecordedTake,
  alignmentStatus: VoiceCapturePackageSample["alignment"]["status"],
  hasTrainingRights: boolean,
): VoiceCapturePackageSample["lifecycle"] {
  if (take.review.rating === "reject")
    return {
      status: "rejected",
      reasons: ["legacy_rejected_rating"],
      review_required: false,
    };
  if (take.review.rating === "maybe")
    return {
      status: "needs_review",
      reasons: ["legacy_maybe_rating"],
      review_required: true,
    };
  if (take.review.rating === "unreviewed")
    return {
      status: "captured",
      reasons: ["not_reviewed"],
      review_required: true,
    };
  const reasons = [
    ...(alignmentStatus === "estimated_g2p" ? ["alignment_is_estimated"] : []),
    ...(alignmentStatus === "local_acoustic_comparison"
      ? ["local_acoustic_alignment_requires_confirmation"]
      : []),
    ...(!hasTrainingRights ? ["rights_not_granted"] : []),
    ...(take.quality.verdict !== "pass" ? ["quality_requires_review"] : []),
  ];
  return {
    status: "training_candidate",
    reasons,
    review_required: reasons.length > 0,
  };
}

function createAlignmentRecord(
  take: RecordedTake,
  path: string,
): VoiceCapturePackageSample["alignment"] {
  if (take.timing.forcedAlignment !== undefined) {
    return {
      status: "external_forced_alignment",
      kind: "forced_alignment",
      path,
      source: "external_import",
      tool: null,
      tool_version: null,
      confidence: take.timing.forcedAlignment.confidence,
    };
  }
  if (take.timing.localAcousticAnalysis !== undefined) {
    const comparison = take.timing.localAcousticAnalysis.alignmentComparison;
    return {
      status: "local_acoustic_comparison",
      kind: "acoustic_evidence",
      path,
      source: "local_whisper_silero_g2p_comparison",
      tool: "voice-capture-studio",
      tool_version: "unknown",
      confidence:
        comparison.medianBoundaryDeltaMs === null
          ? null
          : Math.round(
              comparison.matchRate *
                Math.max(0, 1 - comparison.medianBoundaryDeltaMs / 500) *
                1000,
            ) / 1000,
    };
  }
  if (take.timing.alignment !== undefined) {
    return {
      status: "estimated_g2p",
      kind: "text_alignment",
      path,
      source: "local_g2p_estimate",
      tool: "voice-capture-studio",
      tool_version: "unknown",
      confidence: null,
    };
  }
  return {
    status: "absent",
    kind: "none",
    path: null,
    source: "not_available",
    tool: null,
    tool_version: null,
    confidence: null,
  };
}

function createCaptureContext(
  workspace: VoiceWorkspace,
  session: CaptureSession,
) {
  const profile = workspace.settings.captureProfile;
  return {
    schema_version: "voice.capture.context.v1",
    source: "workspace_snapshot",
    session_id: session.id,
    captured_at: session.startedAt,
    browser: "unknown",
    operating_system: "unknown",
    form_factor: "unknown",
    observed_settings: {
      microphone_name: profile.microphoneName,
      audio_interface: profile.audioInterface,
      mouth_to_mic_distance_cm: profile.mouthToMicDistanceCm,
      room_description: profile.roomDescription,
    },
    interruption_or_device_changes: null,
    orientation_changes: null,
    timezone: "unknown",
    room_tone: profile.roomToneCaptured
      ? {
          status: "legacy_aggregate_only",
          reason: "raw_room_tone_not_retained_by_legacy_calibration",
          duration_ms: profile.roomToneDurationMs ?? null,
          noise_floor_dbfs: profile.roomToneNoiseFloorDbfs ?? null,
          peak_dbfs: profile.roomTonePeakDbfs ?? null,
          integrated_lufs: profile.roomToneIntegratedLufs ?? null,
          calibrated_at: profile.calibratedAt ?? null,
        }
      : { status: "not_recorded", reason: "no_room_tone_capture" },
    take_contexts: session.takes.map((take) => ({
      take_id: take.id,
      snapshot: take.captureContext ?? null,
      legacy_media_capture: readMedia(take)?.capture ?? null,
    })),
  };
}

function environmentGroup(
  context: ReturnType<typeof createCaptureContext>,
): string {
  return JSON.stringify({
    observed_settings: context.observed_settings,
    room_tone: context.room_tone,
  });
}

function readMedia(take: RecordedTake): RecordedTake["media"] | undefined {
  const media = (
    take as RecordedTake & { readonly media?: RecordedTake["media"] }
  ).media;
  return media?.schemaVersion === "voice.media.v1" ? media : undefined;
}

function createUnknownConsent(speakerId: string): ConsentRecord {
  return {
    consentId: `consent_${stableToken(`unknown:${speakerId}`)}`,
    speakerId,
    policyVersion: "unknown",
    status: "unknown",
    grants: [],
    restrictions: [],
    grantedAt: null,
    revokedAt: null,
    evidenceRef: null,
    source: "legacy_workspace_without_rights_record",
  };
}

function createUnknownLicense(ref: CorpusRef): LicenseRecord {
  return {
    licenseId: `license_${stableToken(`unknown:${corpusRefKey(ref)}`)}`,
    corpusId: ref.id,
    corpusVersion: ref.version,
    status: "unknown",
    spdxId: null,
    restrictions: [],
    evidenceRef: null,
    source: "legacy_workspace_without_license_record",
  };
}

function getRightsStatus(
  consents: readonly ConsentRecord[],
  licenses: readonly LicenseRecord[],
): VoiceCapturePackageManifest["rights_status"] {
  if (consents.length === 0 || licenses.length === 0) return "unknown";
  return consents.every(isConsentTrainingGrantValid) &&
    licenses.every(isLicenseTrainingGrantValid)
    ? "resolved"
    : "blocked";
}

function isConsentTrainingGrantValid(record: ConsentRecord): boolean {
  return (
    record.status === "granted" &&
    record.grants.includes("forge_ingestion") &&
    record.grants.includes("model_training") &&
    record.restrictions.length === 0 &&
    record.grantedAt !== null &&
    record.revokedAt === null &&
    record.evidenceRef !== null
  );
}

function isLicenseTrainingGrantValid(record: LicenseRecord): boolean {
  return (
    record.status === "granted" &&
    record.restrictions.length === 0 &&
    record.evidenceRef !== null
  );
}

function createQualitySummary(samples: readonly VoiceCapturePackageSample[]) {
  return {
    schema_version: "voice.capture.quality_summary.v1",
    sample_count: samples.length,
    verdicts: countBy(samples, (sample) => sample.quality.verdict),
    lifecycle: countBy(samples, (sample) => sample.lifecycle.status),
    alignment: countBy(samples, (sample) => sample.alignment.status),
  };
}

function createCoverageSummary(samples: readonly VoiceCapturePackageSample[]) {
  return {
    schema_version: "voice.capture.coverage_summary.v1",
    by_speaker: countBy(samples, (sample) => sample.speaker_id),
    by_language: countBy(samples, (sample) => sample.text.language),
    by_locale: countBy(samples, (sample) => sample.text.locale),
    by_corpus_version: countBy(
      samples,
      (sample) => sample.text.provenance_ref.split("#", 1)[0],
    ),
    prompt_completion: {
      name: "prompt_completion",
      sample_count: samples.length,
      note: "This is prompt completion, not phoneme/diphone/triphone coverage.",
    },
  };
}

function countBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

async function createArtifacts(
  files: readonly VoiceCapturePackageFile[],
  createdAt: string,
  samples: readonly VoiceCapturePackageSample[],
): Promise<readonly VoiceCapturePackageArtifact[]> {
  const owners = new Map<string, string>();
  for (const sample of samples) {
    owners.set(sample.audio.path, `sample:${sample.sample_id}`);
    owners.set(sample.quality.path, `sample:${sample.sample_id}`);
    if (sample.alignment.path !== null)
      owners.set(sample.alignment.path, `sample:${sample.sample_id}`);
    owners.set(sample.capture_context_ref, `session:${sample.session_id}`);
    owners.set(
      `text/${pathToken(sample.utterance_id)}.json`,
      `utterance:${sample.utterance_id}`,
    );
  }
  return Promise.all(
    files.map(async (entry) => ({
      artifactId: `artifact_${stableToken(entry.path)}`,
      path: entry.path,
      type: artifactType(entry.path),
      mediaType: entry.mediaType,
      byteSize: entry.data.size,
      sha256: await sha256Blob(entry.data),
      logicalOwner: owners.get(entry.path) ?? "package",
      required: entry.required,
      schemaVersion: schemaVersionForPath(entry.path),
      createdAt,
    })),
  );
}

async function createChecksums(
  files: readonly VoiceCapturePackageFile[],
): Promise<string> {
  const rows = await Promise.all(
    files
      .filter((entry) => entry.path !== "checksums.sha256")
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(async (entry) => `${await sha256Blob(entry.data)}  ${entry.path}`),
  );
  return `${rows.join("\n")}\n`;
}

function parseChecksums(text: string): Map<string, string> {
  return new Map(
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("  ");
        return separator < 0
          ? [line, ""]
          : [line.slice(separator + 2), line.slice(0, separator)];
      }),
  );
}

function addJsonFile(
  files: VoiceCapturePackageFile[],
  path: string,
  value: unknown,
): void {
  files.push(file(path, jsonBlob(value), "application/json"));
}

function addJsonlFile(
  files: VoiceCapturePackageFile[],
  path: string,
  values: readonly unknown[],
): void {
  addTextFile(
    files,
    path,
    `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
  );
}

function addTextFile(
  files: VoiceCapturePackageFile[],
  path: string,
  text: string,
): void {
  files.push(file(path, textBlob(text), "text/plain;charset=utf-8"));
}

function addAudioFile(
  files: VoiceCapturePackageFile[],
  path: string,
  data: Blob,
): void {
  files.push(file(path, data, data.type || "audio/wav"));
}

function file(
  path: string,
  data: Blob,
  mediaType: string,
): VoiceCapturePackageFile {
  assertSafeRelativePath(path);
  return { path, data, mediaType, required: true };
}

function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
}

function textBlob(text: string): Blob {
  return new Blob([text], { type: "text/plain;charset=utf-8" });
}

function normalizeScope(
  scope: VoiceCapturePackageScope,
): VoiceCapturePackageScope {
  if (scope.datasetId.trim() === "" || scope.projectId.trim() === "")
    throw new Error("Dataset and project IDs are required.");
  if (
    scope.speakerIds.length === 0 ||
    scope.languages.length === 0 ||
    scope.corpusRefs.length === 0 ||
    scope.sessionIds.length === 0 ||
    scope.takeStatuses.length === 0
  ) {
    throw new Error(
      "The export scope must explicitly select speakers, languages, corpus refs, sessions, and take statuses.",
    );
  }
  const normalized = {
    ...scope,
    speakerIds: uniqueStrings(scope.speakerIds),
    languages: uniqueStrings(scope.languages) as LanguageCode[],
    locales: uniqueStrings(scope.locales),
    sessionIds: uniqueStrings(scope.sessionIds),
    takeStatuses: uniqueStrings(scope.takeStatuses) as PackageTakeStatus[],
    corpusRefs: uniqueRefs(scope.corpusRefs),
  };
  if (normalized.locales.length === 0)
    throw new Error(
      "The export scope must explicitly select at least one locale.",
    );
  return normalized;
}

function uniqueCorpora(
  corpora: readonly CorpusManifest[],
): readonly CorpusManifest[] {
  const byRef = new Map<string, CorpusManifest>();
  for (const corpus of corpora) byRef.set(corpusRefKey(corpus), corpus);
  return Array.from(byRef.values());
}

function uniqueRefs(refs: readonly CorpusRef[]): readonly CorpusRef[] {
  const byRef = new Map<string, CorpusRef>();
  for (const ref of refs) byRef.set(corpusRefKey(ref), ref);
  return Array.from(byRef.values());
}

function corpusRefKey(
  value: CorpusRef | CorpusManifest | LicenseRecord,
): string {
  if ("corpusId" in value) return `${value.corpusId}@${value.corpusVersion}`;
  return `${value.id}@${value.version}`;
}

function corpusRefKeyForSession(
  session: CaptureSession,
  corpusByRef: ReadonlyMap<string, CorpusManifest>,
): string {
  const match = Array.from(corpusByRef.values()).find(
    (corpus) => corpus.id === session.corpusId,
  );
  if (match === undefined)
    throw new Error(`No corpus snapshot was supplied for ${session.corpusId}.`);
  return corpusRefKey(match);
}

function localeFor(language: LanguageCode): string {
  return language === "fr" ? "fr-FR" : "en-US";
}

function normalizeText(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function schemaVersionForPath(path: string): string {
  if (path.endsWith(".wav")) return "audio.pcm_s24le.v1";
  if (path === "samples.jsonl") return "voice.capture.samples.v1";
  if (path.startsWith("rights/")) return "voice.capture.rights.v1";
  if (path.startsWith("reports/")) return "voice.capture.report.v1";
  return VOICE_CAPTURE_PACKAGE_SCHEMA;
}

function artifactType(path: string): VoiceCapturePackageArtifact["type"] {
  if (path.endsWith(".wav")) return "audio";
  if (path.startsWith("reports/")) return "report";
  if (
    path.startsWith("rights/") ||
    path.startsWith("sessions/") ||
    path.startsWith("speakers/") ||
    path.startsWith("corpora/") ||
    path.startsWith("text/") ||
    path.startsWith("alignment/") ||
    path.startsWith("quality/") ||
    path.startsWith("reviews/")
  )
    return "provenance";
  if (path.endsWith(".jsonl") || path === "README.md") return "text";
  if (path === "checksums.sha256") return "integrity";
  return "metadata";
}

function createPackageReadme(
  scope: VoiceCapturePackageScope,
  compatibility: VoiceCapturePackagePlan["forgeCompatibility"],
  sampleCount: number,
): string {
  return [
    "# Voice Capture Package v1",
    "",
    `Contract: ${VOICE_CAPTURE_PACKAGE_SCHEMA}`,
    `Dataset: ${scope.datasetId}`,
    `Project: ${scope.projectId}`,
    `Samples: ${sampleCount}`,
    `Forge ingestion ready: ${compatibility.ready ? "yes" : "no"}`,
    "",
    "This package is explicit about scope, immutable raw WAV identity, provenance, quality, lifecycle, rights, and split assignment.",
    "",
    "The manifest describes all payload artifacts. checksums.sha256 also covers manifest.json; checksums.sha256 is intentionally self-excluded to avoid a circular hash.",
    "",
    compatibility.errors.length > 0
      ? `Blocking reasons: ${compatibility.errors.join(", ")}`
      : "No package-level blocking reasons.",
    compatibility.warnings.length > 0
      ? `Warnings: ${compatibility.warnings.join(", ")}`
      : "No export warnings.",
    "",
    "Do not infer training acceptance from keeper/best-take flags. Estimated local G2P alignment remains a candidate annotation until externally forced-aligned and human reviewed.",
    "",
  ].join("\n");
}

function assertSafeRelativePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    hasControlCharacter(path)
  )
    throw new Error(`Unsafe package path: ${path}`);
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment.length > 100,
    )
  )
    throw new Error(`Unsafe package path: ${path}`);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function pathToken(value: string): string {
  return stableToken(value);
}

function stableToken(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + 0x9e3779b9;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function createUuid(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (randomUuid !== undefined) return randomUuid.call(globalThis.crypto);
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues !== undefined)
    globalThis.crypto.getRandomValues(bytes);
  else
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
