import type { CorpusManifest } from "../../domains/corpus";
import { summarizeCoverage } from "../../domains/coverage";
import type { SpeakerProfile } from "../../domains/speakers";
import type { VoiceWorkspace } from "../../domains/workspace";
import { createVoiceCaptureReports } from "./captureSessionExport";

export type DatasetJsonFile = {
  readonly path: string;
  readonly json: unknown;
};

export type DatasetTextFile = {
  readonly path: string;
  readonly text: string;
};

export type DatasetAudioFile = {
  readonly path: string;
  readonly sourceFileName: string;
};

export type DatasetPackagePlan = {
  readonly readme: string;
  readonly jsonFiles: readonly DatasetJsonFile[];
  readonly textFiles: readonly DatasetTextFile[];
  readonly audioFiles: readonly DatasetAudioFile[];
  readonly takeCount: number;
  readonly keeperCount: number;
};

export function createDatasetPackagePlan(input: {
  readonly corpus: CorpusManifest;
  readonly now?: Date;
  readonly speaker: SpeakerProfile | undefined;
  readonly workspace: VoiceWorkspace;
}): DatasetPackagePlan {
  const now = (input.now ?? new Date()).toISOString();
  const promptById = new Map(
    input.corpus.scenarios
      .flatMap((scenario) => scenario.prompts)
      .map((prompt) => [prompt.id, prompt] as const),
  );
  const allTakes = input.workspace.capturedSessions.flatMap(
    (session) => session.takes,
  );
  const keeperTakes = allTakes.filter(
    (take) => take.review.rating === "keeper",
  );
  const jsonFiles: DatasetJsonFile[] = [];
  const textFiles: DatasetTextFile[] = [];
  const audioFiles: DatasetAudioFile[] = [];
  const manifestRows: unknown[] = [];

  for (const session of input.workspace.capturedSessions) {
    for (const take of session.takes) {
      if (take.review.rating !== "keeper") {
        continue;
      }

      const takeSlug = sanitizeSlug(take.id);
      audioFiles.push({
        path: `raw/${takeSlug}.wav`,
        sourceFileName: take.fileName,
      });
      audioFiles.push({
        path: `processed/${takeSlug}.wav`,
        sourceFileName: take.fileName,
      });
      textFiles.push({
        path: `transcripts/${takeSlug}.txt`,
        text: take.transcript.spokenText,
      });
      jsonFiles.push({
        path: `metadata/${takeSlug}.json`,
        json: {
          takeId: take.id,
          sessionId: session.id,
          promptId: take.promptId,
          durationMs: take.durationMs,
          recordedAt: take.recordedAt,
          media: take.media,
          transcript: take.transcript,
          timing: take.timing,
          intent: take.intent,
          quality: take.quality,
          review: take.review,
        },
      });

      const prompt = promptById.get(take.promptId);
      const rawAudioPath = `raw/${takeSlug}.wav`;
      const processedAudioPath = `processed/${takeSlug}.wav`;
      // Browser workspaces created before v0.3 do not have an immutable media
      // record. They remain exportable, with unavailable provenance explicit.
      const media = take.media;

      jsonFiles.push({
        path: `phonemes/${takeSlug}.json`,
        json: {
          schemaVersion: "voice.dataset_phonemes.v1",
          takeId: take.id,
          sessionId: session.id,
          promptId: take.promptId,
          language: session.language,
          durationMs: take.durationMs,
          alignment: take.timing.alignment ?? null,
          wordPhonemeMap: take.timing.words.map((word) => ({
            word: word.word,
            normalized: word.normalized ?? word.word.toLowerCase(),
            startMs: word.startMs,
            endMs: word.endMs,
            confidence: word.confidence ?? null,
            phonemes: word.phonemes ?? [],
          })),
          inventory: take.timing.alignment?.inventory ?? [],
          focus: prompt?.phonetics.focus ?? [],
          coverage: prompt?.phonetics.coverage ?? [],
          difficulty: prompt?.phonetics.difficulty ?? null,
        },
      });
      manifestRows.push({
        take_id: take.id,
        session_id: session.id,
        speaker_id: session.speakerId,
        language: session.language,
        prompt_id: take.promptId,
        audio: {
          raw_path: rawAudioPath,
          processed_path: processedAudioPath,
          format: "wav_pcm_mono_48khz",
          byte_length: media?.byteLength ?? null,
          sha256: media?.sha256 ?? null,
          mime_type: media?.mimeType ?? "audio/wav",
        },
        capture: media?.capture ?? null,
        transcript: take.transcript.spokenText,
        observed_transcript: take.transcript.observedText ?? null,
        duration_ms: take.durationMs,
        transcript_match: take.quality.performance.transcriptMatch,
        alignment_confidence:
          take.quality.performance.alignmentConfidence ?? null,
        word_phoneme_link_rate:
          take.quality.performance.wordPhonemeLinkRate ?? null,
        phoneme_inventory: take.timing.alignment?.inventory ?? [],
        intent: take.intent.intent.primary,
        pace: take.intent.delivery.pace,
        energy: take.intent.delivery.energy,
      });
    }
  }

  if (manifestRows.length > 0) {
    textFiles.push({
      path: "manifests/training_manifest.jsonl",
      text: `${manifestRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    });
  }

  const coverageSummaries = summarizeAllCoverage(input);
  const reports = createVoiceCaptureReports({
    coverage: coverageSummaries.combined,
    prompts: Array.from(promptById.values()),
    takes: allTakes,
  });

  jsonFiles.push(
    { path: "reports/report.audio_quality.json", json: reports.audioQuality },
    {
      path: "reports/report.transcript_alignment.json",
      json: reports.transcriptAlignment,
    },
    {
      path: "reports/report.phonetic_coverage.json",
      json: reports.phoneticCoverage,
    },
    { path: "reports/report.intent_balance.json", json: reports.intentBalance },
    {
      path: "reports/report.prosody_distribution.json",
      json: reports.prosodyDistribution,
    },
    {
      path: "reports/report.dataset_readiness.json",
      json: reports.datasetReadiness,
    },
  );

  const speakerJson = {
    id: input.speaker?.id ?? input.workspace.speakers[0]?.speakerId ?? null,
    displayName:
      input.speaker?.displayName ??
      input.workspace.speakers[0]?.displayName ??
      "Unknown speaker",
    primaryLanguage: input.speaker?.primaryLanguage ?? null,
    supportedLanguages: input.speaker?.supportedLanguages ?? [],
    captureProfile: input.workspace.settings.captureProfile,
  };
  const sessionJson = {
    workspaceId: input.workspace.workspaceId,
    corpusId: input.corpus.id,
    corpusVersion: input.corpus.version,
    generatedAt: now,
    sessionCount: input.workspace.capturedSessions.length,
    sessions: input.workspace.capturedSessions.map((session) => ({
      id: session.id,
      language: session.language,
      startedAt: session.startedAt,
      completedAt: session.completedAt ?? null,
      takeCount: session.takes.length,
      keeperCount: session.takes.filter(
        (take) => take.review.rating === "keeper",
      ).length,
    })),
  };

  jsonFiles.push(
    { path: "speaker.json", json: speakerJson },
    { path: "session.json", json: sessionJson },
  );

  return {
    readme: createReadme({
      keeperCount: keeperTakes.length,
      takeCount: allTakes.length,
      corpus: input.corpus,
      generatedAt: now,
    }),
    jsonFiles,
    textFiles,
    audioFiles,
    takeCount: allTakes.length,
    keeperCount: keeperTakes.length,
  };
}

function summarizeAllCoverage(input: {
  readonly corpus: CorpusManifest;
  readonly workspace: VoiceWorkspace;
}) {
  const speakerLanguagePairs = new Map<
    string,
    { speakerId: string; language: string }
  >();

  for (const session of input.workspace.capturedSessions) {
    speakerLanguagePairs.set(`${session.speakerId}:${session.language}`, {
      speakerId: session.speakerId,
      language: session.language,
    });
  }

  const first = speakerLanguagePairs.values().next().value ?? {
    speakerId: input.workspace.speakers[0]?.speakerId ?? "",
    language: input.workspace.speakers[0]?.languages[0] ?? "en",
  };

  return {
    combined: summarizeCoverage({
      workspace: input.workspace,
      corpus: input.corpus,
      speakerId: first.speakerId as never,
      language: first.language as never,
    }),
  };
}

function createReadme(input: {
  readonly corpus: CorpusManifest;
  readonly generatedAt: string;
  readonly keeperCount: number;
  readonly takeCount: number;
}): string {
  return `# Voice Capture Studio Dataset

Generated: ${input.generatedAt}
Corpus: ${input.corpus.id} (${input.corpus.version})
Keeper takes: ${input.keeperCount} / ${input.takeCount} recorded takes

## Structure

- \`raw/\` - Original captured WAV audio (PCM mono, 48 kHz, 24-bit where supported).
- \`processed/\` - Placeholder for post-processed audio. Currently identical to \`raw/\`;
  reserved for future normalization or denoising passes.
- \`transcripts/\` - Plain text transcript per keeper take.
- \`metadata/\` - Immutable media identity (SHA-256), capture provenance, transcript,
  timing, intent, quality, and review metadata per keeper take.
- \`phonemes/\` - Word-to-phoneme timing maps, estimated phone intervals, and prompt targets.
- \`manifests/training_manifest.jsonl\` - One keeper take per line for fine-tuning pipelines.
- \`reports/\` - Aggregate dataset diagnostics (audio quality, transcript alignment,
  phonetic coverage, intent balance, prosody distribution, dataset readiness).
- \`speaker.json\` - Speaker profile and capture conditions.
- \`session.json\` - Session history summary across the whole workspace.

Only keeper-rated takes are included. Every audio object is SHA-256 linked to its manifest row.
Word and phoneme timing is browser-estimated from prompt text
and take duration; run acoustic forced alignment before final model training acceptance. This
dataset was produced entirely client-side by Voice Capture Studio; no audio was uploaded to a
remote service.
`;
}

function sanitizeSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
