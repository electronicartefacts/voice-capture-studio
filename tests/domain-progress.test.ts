import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCorpus, type PromptDefinition } from "../src/domains/corpus";
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
  reconcileWorkspaceProgress,
} from "../src/domains/workspace";
import type { IsoDateTime } from "../src/shared";

const fr = initialSpeakers[0].primaryLanguage;
const speakerId = initialSpeakers[0].id;

test("session planning skips completed prompts until the language corpus is exhausted", () => {
  const workspace = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-09T08:00:00.000Z"),
  });
  const firstSession = planSession({
    workspace,
    corpus: canonicalCorpus,
    speakerId,
    language: fr,
    targetMinutes: 5,
    now: new Date("2026-07-09T08:01:00.000Z"),
  });
  const firstPrompt = findPrompt(firstSession.plannedPromptIds[0]);
  const completedWorkspace = completePlannedSession(
    workspace,
    canonicalCorpus,
    {
      ...firstSession,
      takes: [createTake(firstSession, firstPrompt, "keeper")],
    },
    new Date("2026-07-09T08:02:00.000Z"),
  );
  const nextSession = planSession({
    workspace: completedWorkspace,
    corpus: canonicalCorpus,
    speakerId,
    language: fr,
    targetMinutes: 5,
    now: new Date("2026-07-09T08:03:00.000Z"),
  });

  assert.equal(
    nextSession.plannedPromptIds.includes(firstPrompt.id),
    false,
    "a keeper prompt should not be planned again while other prompts remain",
  );
});

test("workspace progress only credits keeper takes as completed prompts", () => {
  const workspace = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-09T08:00:00.000Z"),
  });
  const session = planSession({
    workspace,
    corpus: canonicalCorpus,
    speakerId,
    language: fr,
    targetMinutes: 5,
    now: new Date("2026-07-09T08:01:00.000Z"),
  });
  const prompt = findPrompt(session.plannedPromptIds[0]);
  const updatedWorkspace = completePlannedSession(
    workspace,
    canonicalCorpus,
    {
      ...session,
      takes: [createTake(session, prompt, "maybe")],
    },
    new Date("2026-07-09T08:02:00.000Z"),
  );
  const progress = updatedWorkspace.corpusProgress.find(
    (snapshot) =>
      snapshot.corpusId === canonicalCorpus.id &&
      snapshot.speakerId === speakerId &&
      snapshot.language === fr,
  );

  assert.deepEqual(progress?.completedPrompts ?? [], []);
});

test("workspace progress can be reconciled from captured keeper sessions", () => {
  const workspace = createEmptyWorkspace({
    corpus: canonicalCorpus,
    speakers: initialSpeakers,
    now: new Date("2026-07-09T08:00:00.000Z"),
  });
  const session = planSession({
    workspace,
    corpus: canonicalCorpus,
    speakerId,
    language: fr,
    targetMinutes: 5,
    now: new Date("2026-07-09T08:01:00.000Z"),
  });
  const prompt = findPrompt(session.plannedPromptIds[0]);
  const completedWorkspace = completePlannedSession(
    workspace,
    canonicalCorpus,
    {
      ...session,
      takes: [createTake(session, prompt, "keeper")],
    },
    new Date("2026-07-09T08:02:00.000Z"),
  );
  const driftedWorkspace = {
    ...completedWorkspace,
    corpusProgress: [],
  };
  const reconciledWorkspace = reconcileWorkspaceProgress(
    driftedWorkspace,
    canonicalCorpus,
  );
  const nextSession = planSession({
    workspace: reconciledWorkspace,
    corpus: canonicalCorpus,
    speakerId,
    language: fr,
    targetMinutes: 5,
    now: new Date("2026-07-09T08:03:00.000Z"),
  });
  const progress = reconciledWorkspace.corpusProgress.find(
    (snapshot) =>
      snapshot.corpusId === canonicalCorpus.id &&
      snapshot.speakerId === speakerId &&
      snapshot.language === fr,
  );

  assert.deepEqual(progress?.completedPrompts, [prompt.id]);
  assert.equal(
    nextSession.plannedPromptIds.includes(prompt.id),
    false,
    "replayed keeper history should stop the planner from repeating completed prompts",
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
  const verdict =
    rating === "reject" ? "reject" : rating === "keeper" ? "pass" : "review";

  return {
    id: `take.${session.id}.${prompt.id}` as TakeId,
    promptId: prompt.id,
    fileName: `${session.id}.wav`,
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
        transcriptMatch: 0.99,
        intentMatch: rating === "keeper" ? 0.95 : 0.78,
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
      directorNotes: rating === "keeper" ? "Keeper." : "Needs another take.",
    },
  };
}
