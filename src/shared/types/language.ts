import type { Brand } from "./brand";

export type LanguageCode = Brand<"fr" | "en", "LanguageCode">;

export type LanguageDefinition = {
  readonly code: LanguageCode;
  readonly label: string;
  readonly nativeLabel: string;
};
