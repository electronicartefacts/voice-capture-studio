import {
  initialSpeakers,
  type SpeakerId,
  type SpeakerProfile,
} from "@domains/speakers";
import type { WorkspaceSpeaker } from "@domains/workspace";
import { supportedLanguages, type LanguageCode } from "@shared/index";

export const DEFAULT_SPEAKER_LANGUAGE =
  supportedLanguages[0]?.code ?? ("fr" as LanguageCode);

export type CreateSpeakerInput = {
  readonly displayName: string;
  readonly languages: readonly LanguageCode[];
};

export function createSpeakerProfiles(
  workspaceSpeakers: readonly WorkspaceSpeaker[] | undefined,
): readonly SpeakerProfile[] {
  if (workspaceSpeakers !== undefined && workspaceSpeakers.length > 0) {
    return workspaceSpeakers.map((speaker, index) =>
      createSpeakerProfileFromWorkspaceSpeaker(speaker, index),
    );
  }

  return initialSpeakers.map((speaker, index) => ({
    ...speaker,
    displayName: normalizeSpeakerDisplayName(speaker.displayName, index),
    supportedLanguages: normalizeSpeakerLanguages(speaker.supportedLanguages),
  }));
}

export function createSpeakerProfileFromWorkspaceSpeaker(
  speaker: WorkspaceSpeaker,
  index: number,
): SpeakerProfile {
  const languages = normalizeSpeakerLanguages(speaker.languages);

  return {
    id: speaker.speakerId,
    displayName: normalizeSpeakerDisplayName(speaker.displayName, index),
    primaryLanguage: languages[0] ?? DEFAULT_SPEAKER_LANGUAGE,
    supportedLanguages: languages,
  };
}

export function createWorkspaceSpeakerFromProfile(
  speaker: SpeakerProfile,
): WorkspaceSpeaker {
  return {
    speakerId: speaker.id,
    displayName: speaker.displayName,
    languages: speaker.supportedLanguages,
  };
}

export function normalizeSpeakerLanguages(
  languages: readonly LanguageCode[] | undefined,
): readonly LanguageCode[] {
  const normalized: LanguageCode[] = [];

  for (const language of languages ?? []) {
    if (
      supportedLanguages.some((candidate) => candidate.code === language) &&
      !normalized.includes(language)
    ) {
      normalized.push(language);
    }
  }

  return normalized.length > 0 ? normalized : [DEFAULT_SPEAKER_LANGUAGE];
}

export function normalizeSpeakerDisplayName(
  displayName: string,
  index: number,
): string {
  const trimmed = displayName.trim();

  if (trimmed === "Primary Voice") {
    return "Voix 1";
  }

  if (trimmed === "Secondary Voice") {
    return "Voix 2";
  }

  return trimmed.length > 0 ? trimmed : `Voix ${index + 1}`;
}

export function createSpeakerId(): SpeakerId {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return `speaker.${suffix}` as SpeakerId;
}
