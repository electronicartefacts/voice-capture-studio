import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceCaptureReports } from "../src/app/export/captureSessionExport";
import { canonicalCorpus, type PromptDefinition } from "../src/domains/corpus";
import { summarizeCoverage } from "../src/domains/coverage";
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

test("export reports measure keeper takes instead of planned prompts", () => {
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
  const reviewPrompt = findPrompt(session.plannedPromptIds[1]);
  const completedSession: CaptureSession = {
    ...session,
    takes: [
      createTake(session, keeperPrompt, "keeper"),
      createTake(session, reviewPrompt, "maybe"),
    ],
  };
  const updatedWorkspace = completePlannedSession(
    workspace,
    canonicalCorpus,
    completedSession,
    new Date("2026-07-09T08:02:00.000Z"),
  );
  const coverage = summarizeCoverage({
    workspace: updatedWorkspace,
    corpus: canonicalCorpus,
    speakerId,
    language,
  });
  const plannedPrompts = session.plannedPromptIds.map(findPrompt);
  const reports = createVoiceCaptureReports({
    coverage,
    prompts: plannedPrompts,
    takes: completedSession.takes,
  });

  assert.equal(reports.audioQuality.takeCount, 2);
  assert.equal(reports.audioQuality.keeperTakeCount, 1);
  assert.deepEqual(reports.intentBalance.intentCounts, {
    [keeperPrompt.intention.primary]: 1,
  });
  assert.deepEqual(reports.prosodyDistribution.paceCounts, {
    [keeperPrompt.delivery.pace]: 1,
  });
  assert.equal(
    Object.hasOwn(
      reports.intentBalance.intentCounts,
      reviewPrompt.intention.primary,
    ),
    false,
    "review takes must remain history, not accepted dataset coverage",
  );
});

test("transcript report only flags non-passing transcript gates", () => {
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
  const prompt = findPrompt(session.plannedPromptIds[0]);
  const take = createTake(session, prompt, "keeper", "pass");
  const coverage = summarizeCoverage({
    workspace,
    corpus: canonicalCorpus,
    speakerId,
    language,
  });
  const reports = createVoiceCaptureReports({
    coverage,
    prompts: [prompt],
    takes: [take],
  });

  assert.deepEqual(reports.transcriptAlignment.takesNeedingHumanReview, []);
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
  transcriptGateStatus: RecordedTake["quality"]["gates"][number]["status"] = "review",
): RecordedTake {
  const verdict =
    rating === "reject" ? "reject" : rating === "keeper" ? "pass" : "review";

  return {
    id: `take.${session.id}.${prompt.id}.${rating}` as TakeId,
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
      words: [],
      phrases: [{ text: prompt.text, startMs: 0, endMs: 3200 }],
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
        transcriptMatch: transcriptGateStatus === "pass" ? 1 : 0.98,
        intentMatch: rating === "keeper" ? 0.95 : 0.78,
        prosodyVariation: 0.74,
        naturalnessHumanReview: null,
        keeper: rating === "keeper",
      },
      gates: [
        {
          id: "transcript_match",
          label: "Transcript",
          status: transcriptGateStatus,
          message: "Transcript gate",
        },
      ],
      verdict,
    },
    review: {
      rating,
      bestTake: rating === "keeper",
      directorNotes: rating === "keeper" ? "Keeper." : "Needs another take.",
    },
  };
}
