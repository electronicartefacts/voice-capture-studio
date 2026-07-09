import type { LanguageCode } from "@shared/index";

export type ApplicationSettings = {
  readonly defaultLanguage: LanguageCode;
  readonly sessionDurationMinutes: number;
  readonly retainRejectedTakes: boolean;
};
