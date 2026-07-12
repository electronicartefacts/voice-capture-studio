import type {
  CorpusManifest,
  PromptDefinition,
  PromptId,
  ScenarioId,
} from "@domains/corpus";
import type {
  CorpusProgressSnapshot,
  VoiceWorkspace,
} from "@domains/workspace";
import type { LanguageCode, IsoDateTime } from "@shared/index";
import type { SpeakerId } from "@domains/speakers";
import type { CaptureSession, SessionId } from "./types";

export function planSession(input: {
  readonly workspace: VoiceWorkspace;
  readonly corpus: CorpusManifest;
  readonly speakerId: SpeakerId;
  readonly language: LanguageCode;
  readonly targetMinutes: number;
  readonly now: Date;
  readonly strategy?: "coverage" | "sequential";
}): CaptureSession {
  const progress = findProgress(
    input.workspace,
    input.corpus.id,
    input.speakerId,
    input.language,
  );
  const scenarios = input.corpus.scenarios.filter(
    (scenario) => scenario.language === input.language,
  );
  const promptBudget = Math.max(
    1,
    Math.min(8, Math.round(input.targetMinutes * 1.2)),
  );
  const prompts = scenarios.flatMap((scenario) => scenario.prompts);
  const completedPromptIds = progress?.completedPrompts ?? [];
  const attemptedPromptIds = findAttemptedPromptIds(
    input.workspace,
    input.corpus.id,
    input.speakerId,
    input.language,
  );
  const completedPrompts = prompts.filter((prompt) =>
    completedPromptIds.includes(prompt.id),
  );
  const prioritizePrompts = (candidates: readonly PromptDefinition[]) =>
    input.strategy === "sequential"
      ? [...candidates]
      : [...candidates].sort((left, right) => {
          const leftScore = scorePromptPriority(left, completedPrompts);
          const rightScore = scorePromptPriority(right, completedPrompts);

          return rightScore - leftScore;
        });
  const incompletePrompts = prompts.filter(
    (prompt) => !completedPromptIds.includes(prompt.id),
  );
  const plannedPromptIds = [
    ...prioritizePrompts(
      incompletePrompts.filter((prompt) => !attemptedPromptIds.has(prompt.id)),
    ),
    ...prioritizePrompts(
      incompletePrompts.filter((prompt) => attemptedPromptIds.has(prompt.id)),
    ),
  ]
    .map((prompt) => prompt.id)
    .slice(0, promptBudget);
  const fallbackPromptIds = prioritizePrompts(prompts)
    .map((prompt) => prompt.id)
    .slice(0, promptBudget);
  const selectedPromptIds =
    plannedPromptIds.length > 0 ? plannedPromptIds : fallbackPromptIds;

  return {
    id: createSessionId(input.now),
    speakerId: input.speakerId,
    language: input.language,
    corpusId: input.corpus.id,
    scenarioIds: scenarios
      .filter((scenario) =>
        scenario.prompts.some((prompt) =>
          selectedPromptIds.includes(prompt.id),
        ),
      )
      .map((scenario) => scenario.id),
    plannedPromptIds: selectedPromptIds,
    startedAt: input.now.toISOString() as IsoDateTime,
    takes: [],
  };
}

export function findPromptText(
  corpus: CorpusManifest,
  promptId: PromptId,
): string {
  return findPrompt(corpus, promptId)?.text ?? promptId;
}

export function findPrompt(
  corpus: CorpusManifest,
  promptId: PromptId,
): PromptDefinition | undefined {
  return corpus.scenarios
    .flatMap((scenario) => scenario.prompts)
    .find((prompt) => prompt.id === promptId);
}

export function findScenarioTitles(
  corpus: CorpusManifest,
  scenarioIds: readonly ScenarioId[],
): string {
  return corpus.scenarios
    .filter((scenario) => scenarioIds.includes(scenario.id))
    .map((scenario) => scenario.title)
    .join(", ");
}

function findProgress(
  workspace: VoiceWorkspace,
  corpusId: CorpusManifest["id"],
  speakerId: SpeakerId,
  language: LanguageCode,
): CorpusProgressSnapshot | undefined {
  return workspace.corpusProgress.find(
    (progress) =>
      progress.corpusId === corpusId &&
      progress.speakerId === speakerId &&
      progress.language === language,
  );
}

function findAttemptedPromptIds(
  workspace: VoiceWorkspace,
  corpusId: CorpusManifest["id"],
  speakerId: SpeakerId,
  language: LanguageCode,
): ReadonlySet<PromptId> {
  const attemptedPromptIds = new Set<PromptId>();

  for (const session of workspace.capturedSessions as readonly unknown[]) {
    if (
      !isRecord(session) ||
      session.corpusId !== corpusId ||
      session.speakerId !== speakerId ||
      session.language !== language ||
      !Array.isArray(session.takes)
    ) {
      continue;
    }

    for (const take of session.takes) {
      if (isRecord(take) && isNonEmptyString(take.promptId)) {
        attemptedPromptIds.add(take.promptId as PromptId);
      }
    }
  }

  return attemptedPromptIds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function createSessionId(now: Date): SessionId {
  return `session.${now.toISOString()}` as SessionId;
}

function scorePromptPriority(
  prompt: PromptDefinition,
  completedPrompts: readonly PromptDefinition[],
): number {
  if (completedPrompts.length === 0) {
    return prompt.tags.includes("baseline") ? 100 : 60;
  }

  const completedIntents = new Set(
    completedPrompts.map((item) => item.intention.primary),
  );
  const completedPaces = new Set(
    completedPrompts.map((item) => item.delivery.pace),
  );
  const completedEnergies = new Set(
    completedPrompts.map((item) => item.delivery.energy),
  );
  const completedEmotionLabels = new Set(
    completedPrompts.flatMap((item) => item.intention.emotion.labels),
  );
  const completedPhoneticCoverage = new Set(
    completedPrompts.flatMap((item) => item.phonetics.coverage),
  );
  const completedLetters = new Set(
    completedPrompts
      .map((item) => normalizeText(item.text))
      .join("")
      .replace(/[^a-z]/g, "")
      .split(""),
  );
  const promptLetters = new Set(
    normalizeText(prompt.text)
      .replace(/[^a-z]/g, "")
      .split(""),
  );
  const rareLetterBonus = ["q", "w", "x", "z"].filter(
    (letter) => promptLetters.has(letter) && !completedLetters.has(letter),
  ).length;
  const newEmotionLabels = prompt.intention.emotion.labels.filter(
    (label) => !completedEmotionLabels.has(label),
  ).length;
  const newPhoneticTargets = prompt.phonetics.coverage.filter(
    (target) => !completedPhoneticCoverage.has(target),
  ).length;

  return [
    completedIntents.has(prompt.intention.primary) ? 0 : 42,
    completedPaces.has(prompt.delivery.pace) ? 0 : 24,
    completedEnergies.has(prompt.delivery.energy) ? 0 : 16,
    newEmotionLabels * 6,
    newPhoneticTargets * 8,
    rareLetterBonus * 12,
    prompt.tags.includes("signature") ? 5 : 0,
  ].reduce((total, value) => total + value, 0);
}

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
