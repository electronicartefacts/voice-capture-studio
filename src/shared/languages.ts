import type { LanguageCode, LanguageDefinition } from "./types/language";

export const supportedLanguages: readonly LanguageDefinition[] = [
  {
    code: "fr" as LanguageCode,
    label: "French",
    nativeLabel: "Français",
  },
  {
    code: "en" as LanguageCode,
    label: "English",
    nativeLabel: "English",
  },
];

export function formatLanguage(code: LanguageCode): string {
  return (
    supportedLanguages.find((language) => language.code === code)
      ?.nativeLabel ?? code
  );
}
