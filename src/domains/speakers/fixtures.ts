import type { LanguageCode } from "@shared/index";
import type { SpeakerId, SpeakerProfile } from "./types";

const fr = "fr" as LanguageCode;
const en = "en" as LanguageCode;

export const initialSpeakers: readonly SpeakerProfile[] = [
  {
    id: "speaker.primary" as SpeakerId,
    displayName: "Primary Voice",
    primaryLanguage: fr,
    supportedLanguages: [fr, en],
  },
  {
    id: "speaker.secondary" as SpeakerId,
    displayName: "Secondary Voice",
    primaryLanguage: en,
    supportedLanguages: [en],
  },
];
