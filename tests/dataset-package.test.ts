import assert from "node:assert/strict";
import test from "node:test";
import { createDatasetPackagePlan } from "../src/app/export/datasetPackage";
import { createDatasetZip } from "../src/app/export/downloadDatasetPackage";
import { canonicalCorpus, type PromptDefinition } from "../src/domains/corpus";
import { alignPromptToPhonemes } from "../src/domains/phonetics";
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
} from "../src/domains/workspace";
import type { IsoDateTime } from "../src/shared";

const speakerId = initialSpeakers[0].id;
const language = initialSpeakers[0].primaryLanguage;

test("dataset package plan includes only keeper takes and covers the documented folder shape", () => {
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
  const keeperPrompt = findPrompt(session.plannedPromptIds[0]);
  const rejectedPrompt = findPrompt(session.plannedPromptIds[1]);
  const completedSession: CaptureSession = {
    ...session,
    takes: [
      createTake(session, keeperPrompt, "keeper"),
      createTake(session, rejectedPrompt, "reject"),
    ],
  };
  const updatedWorkspace = completePlannedSession(
    workspace,
    canonicalCorpus,
    completedSession,
    new Date("2026-07-09T08:02:00.000Z"),
  );
  const plan = createDatasetPackagePlan({
    corpus: canonicalCorpus,
    speaker: initialSpeakers[0],
    workspace: updatedWorkspace,
    now: new Date("2026-07-09T08:03:00.000Z"),
  });

  assert.equal(plan.takeCount, 2);
  assert.equal(plan.keeperCount, 1);

  const keeperTakeId = completedSession.takes[0].id;
  const rawPaths = plan.audioFiles
    .filter((file) => file.path.startsWith("raw/"))
    .map((file) => file.path);
  const processedPaths = plan.audioFiles
    .filter((file) => file.path.startsWith("processed/"))
    .map((file) => file.path);

  assert.ok(rawPaths.includes(`raw/${keeperTakeId}.wav`));
  assert.ok(processedPaths.includes(`processed/${keeperTakeId}.wav`));
  assert.equal(
    plan.audioFiles.length,
    2,
    "only the keeper take produces audio entries",
  );
  assert.ok(
    plan.textFiles.some(
      (file) => file.path === `transcripts/${keeperTakeId}.txt`,
    ),
  );
  assert.ok(
    plan.jsonFiles.some(
      (file) => file.path === `metadata/${keeperTakeId}.json`,
    ),
  );
  assert.ok(
    plan.jsonFiles.some(
      (file) => file.path === `phonemes/${keeperTakeId}.json`,
    ),
  );
  const phonemeFile = plan.jsonFiles.find(
    (file) => file.path === `phonemes/${keeperTakeId}.json`,
  );
  const phonemeJson = phonemeFile?.json as {
    readonly wordPhonemeMap?: readonly {
      readonly phonemes: readonly unknown[];
    }[];
  };

  assert.ok((phonemeJson.wordPhonemeMap?.[0]?.phonemes.length ?? 0) > 0);
  assert.ok(
    plan.textFiles.some(
      (file) => file.path === "manifests/training_manifest.jsonl",
    ),
  );
  assert.ok(plan.jsonFiles.some((file) => file.path === "speaker.json"));
  assert.ok(plan.jsonFiles.some((file) => file.path === "session.json"));
  assert.ok(
    plan.jsonFiles.some(
      (file) => file.path === "reports/report.dataset_readiness.json",
    ),
  );
  assert.match(plan.readme, /Keeper takes: 1 \/ 2/);
});

test("dataset zip reports each missing source audio file once", async () => {
  const result = await createDatasetZip({
    getAudioBlob: async () => undefined,
    plan: {
      readme: "dataset",
      jsonFiles: [],
      textFiles: [],
      audioFiles: [
        { path: "raw/take.wav", sourceFileName: "take.wav" },
        { path: "processed/take.wav", sourceFileName: "take.wav" },
      ],
      takeCount: 1,
      keeperCount: 1,
    },
  });

  assert.deepEqual(result.missingAudioFiles, ["take.wav"]);
  assert.equal(
    result.writtenFiles,
    1,
    "README remains explicit in the archive",
  );
});

function findPrompt(
  promptId: CaptureSession["plannedPromptIds"][number],
): PromptDefinition {
  const prompt = canonicalCorpus.scenarios
    .flatMap((scenario) => scenario.prompts)
    .find((candidate) => candidate.id === promptId);

  assert.ok(prompt, `Prompt ${promptId} should exist in the canonical corpus`);

  return prompt;
}

function createTake(
  session: CaptureSession,
  prompt: PromptDefinition,
  rating: RecordedTake["review"]["rating"],
): RecordedTake {
  const verdict = rating === "reject" ? "reject" : "pass";
  const alignment = alignPromptToPhonemes({
    durationMs: 3200,
    language: session.language,
    text: prompt.spokenText ?? prompt.text,
  });

  return {
    id: `take.${prompt.id}.${rating}` as TakeId,
    promptId: prompt.id,
    fileName: `${session.id}.${prompt.id}.wav`,
    durationMs: 3200,
    recordedAt: "2026-07-09T08:01:30.000Z" as IsoDateTime,
    transcript: {
      schemaVersion: "voice.transcript.v2",
      originalText: prompt.text,
      spokenText: prompt.spokenText ?? prompt.text,
      strictMatchRequired: true,
      annotations: [],
    },
    timing: {
      schemaVersion: "voice.timing.v2",
      durationMs: 3200,
      words: alignment.words.map((word) => ({
        word: word.word,
        startMs: word.startMs,
        endMs: word.endMs,
        tokenIndex: word.tokenIndex,
        normalized: word.normalized,
        confidence: word.confidence,
        syllableCount: word.syllableCount,
        phonemes: word.phonemes,
      })),
      phonemes: alignment.phonemes,
      phrases: [{ text: prompt.text, startMs: 0, endMs: 3200 }],
      alignment,
    },
    intent: {
      schemaVersion: "voice.intent.v2",
      language: session.language,
      intent: prompt.intention,
      delivery: prompt.delivery,
      direction: {
        directorNote: prompt.direction.directorNote,
        avoid: prompt.direction.avoid,
      },
      prosody: prompt.prosody,
    },
    quality: {
      schemaVersion: "voice.quality.v2",
      technical: {
        sampleRateHz: 48000,
        bitDepth: 24,
        channels: 1,
        peakDbfs: -12,
        integratedLufs: -20,
        noiseFloorDbfs: -72,
        snrDb: 36,
        clippingDetected: false,
        reverbScore: 0.1,
        plosiveScore: 0.02,
        mouthNoiseScore: 0.02,
      },
      performance: {
        transcriptMatch: 1,
        alignmentConfidence: alignment.confidence,
        phonemeInventoryCount: alignment.inventory.length,
        wordPhonemeLinkRate: 1,
        intentMatch: rating === "keeper" ? 0.95 : 0.4,
        prosodyVariation: 0.74,
        naturalnessHumanReview: null,
        keeper: rating === "keeper",
      },
      gates: [],
      verdict,
    },
    review: {
      rating,
      bestTake: rating === "keeper",
      directorNotes: rating === "keeper" ? "Keeper." : "Rejected.",
    },
  };
}
