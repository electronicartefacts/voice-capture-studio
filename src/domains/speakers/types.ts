import type { Brand, LanguageCode } from "@shared/index";

export type SpeakerId = Brand<string, "SpeakerId">;

export type SpeakerProfile = {
  readonly id: SpeakerId;
  readonly displayName: string;
  readonly primaryLanguage: LanguageCode;
  readonly supportedLanguages: readonly LanguageCode[];
};
