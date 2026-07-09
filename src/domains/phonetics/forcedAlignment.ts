import type { IsoDateTime, LanguageCode } from "@shared/index";
import type {
  ForcedAlignment,
  ForcedAlignmentWord,
  PhonemeInterval,
} from "./types";

export function importForcedAlignment(
  payload: unknown,
  options: { readonly now?: Date } = {},
): ForcedAlignment {
  if (!isRecord(payload)) {
    throw new Error("L'alignement forcé doit être un objet JSON.");
  }

  const durationMs = positiveNumber(payload.durationMs, "durationMs");
  const aligner = nonEmptyString(payload.aligner, "aligner");
  const language = nonEmptyString(payload.language, "language") as LanguageCode;
  const confidence = boundedNumber(payload.confidence, "confidence");
  const words = readWords(payload.words, durationMs);
  const phonemes = readPhonemes(payload.phonemes, durationMs);

  if (words.length === 0 || phonemes.length === 0) {
    throw new Error(
      "L'alignement forcé doit contenir des mots et des phonèmes.",
    );
  }

  return {
    schemaVersion: "voice.forced_alignment.v1",
    source: "external_acoustic_forced_alignment",
    aligner,
    language,
    durationMs,
    confidence,
    words,
    phonemes,
    importedAt: (options.now ?? new Date()).toISOString() as IsoDateTime,
  };
}

function readWords(
  value: unknown,
  durationMs: number,
): readonly ForcedAlignmentWord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Le mot d'alignement ${index + 1} est invalide.`);
    }

    const startMs = boundedInteger(
      item.startMs,
      `words[${index}].startMs`,
      durationMs,
    );
    const endMs = boundedInteger(
      item.endMs,
      `words[${index}].endMs`,
      durationMs,
    );

    assertInterval(startMs, endMs, `words[${index}]`);

    return {
      word: nonEmptyString(item.word, `words[${index}].word`),
      startMs,
      endMs,
      confidence: boundedNumber(item.confidence, `words[${index}].confidence`),
      phonemes: readPhonemes(item.phonemes, durationMs),
    };
  });
}

function readPhonemes(
  value: unknown,
  durationMs: number,
): readonly PhonemeInterval[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Le phonème d'alignement ${index + 1} est invalide.`);
    }

    const startMs = boundedInteger(
      item.startMs,
      `phonemes[${index}].startMs`,
      durationMs,
    );
    const endMs = boundedInteger(
      item.endMs,
      `phonemes[${index}].endMs`,
      durationMs,
    );

    assertInterval(startMs, endMs, `phonemes[${index}]`);

    return {
      phoneme: nonEmptyString(item.phoneme, `phonemes[${index}].phoneme`),
      startMs,
      endMs,
      confidence: boundedNumber(
        item.confidence,
        `phonemes[${index}].confidence`,
      ),
      wordIndex: nonNegativeInteger(
        item.wordIndex,
        `phonemes[${index}].wordIndex`,
      ),
      source: "external_acoustic_forced_alignment",
    };
  });
}

function assertInterval(startMs: number, endMs: number, field: string): void {
  if (endMs <= startMs) {
    throw new Error(`L'intervalle ${field} doit avoir une durée positive.`);
  }
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Le champ ${field} est requis.`);
  }

  return value.trim();
}

function positiveNumber(value: unknown, field: string): number {
  const number = finiteNumber(value, field);

  if (number <= 0) {
    throw new Error(`Le champ ${field} doit être positif.`);
  }

  return number;
}

function boundedNumber(value: unknown, field: string): number {
  const number = finiteNumber(value, field);

  if (number < 0 || number > 1) {
    throw new Error(`Le champ ${field} doit être compris entre 0 et 1.`);
  }

  return number;
}

function boundedInteger(
  value: unknown,
  field: string,
  maximum: number,
): number {
  const number = finiteNumber(value, field);

  if (!Number.isInteger(number) || number < 0 || number > maximum) {
    throw new Error(`Le champ ${field} doit être un temps valide.`);
  }

  return number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  const number = finiteNumber(value, field);

  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Le champ ${field} doit être un entier positif.`);
  }

  return number;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Le champ ${field} doit être numérique.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
