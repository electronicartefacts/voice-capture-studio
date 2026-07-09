import type { LanguageCode } from "@shared/index";

export type AlignmentSource =
  | "local_grapheme_phoneme_estimate"
  | "web_speech_transcript_estimate"
  | "external_acoustic_forced_alignment";

export type TranscriptToken = {
  readonly index: number;
  readonly text: string;
  readonly normalized: string;
  readonly startChar: number;
  readonly endChar: number;
};

export type PhonemeInterval = {
  readonly phoneme: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence: number;
  readonly wordIndex: number;
  readonly source: AlignmentSource;
};

export type WordPhonemeAlignment = {
  readonly tokenIndex: number;
  readonly word: string;
  readonly normalized: string;
  readonly startChar: number;
  readonly endChar: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence: number;
  readonly syllableCount: number;
  readonly phonemes: readonly PhonemeInterval[];
};

export type PromptPhonemeAlignment = {
  readonly schemaVersion: "voice.phoneme_alignment.v1";
  readonly language: LanguageCode;
  readonly source: AlignmentSource;
  readonly dictionary: "rule_based_fr_en_v1";
  readonly durationMs: number;
  readonly confidence: number;
  readonly forcedAlignmentRequired: true;
  readonly tokens: readonly TranscriptToken[];
  readonly words: readonly WordPhonemeAlignment[];
  readonly phonemes: readonly PhonemeInterval[];
  readonly inventory: readonly string[];
  readonly warnings: readonly string[];
};

export type ForcedAlignmentWord = {
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence: number;
  readonly phonemes: readonly PhonemeInterval[];
};

export type ForcedAlignment = {
  readonly schemaVersion: "voice.forced_alignment.v1";
  readonly source: "external_acoustic_forced_alignment";
  readonly aligner: string;
  readonly language: LanguageCode;
  readonly durationMs: number;
  readonly confidence: number;
  readonly words: readonly ForcedAlignmentWord[];
  readonly phonemes: readonly PhonemeInterval[];
  readonly importedAt: string;
};

export type TranscriptMatchEstimate = {
  readonly score: number;
  readonly source: "web_speech" | "prompt_only";
  readonly expectedTokens: readonly string[];
  readonly observedTokens: readonly string[];
  readonly missingTokens: readonly string[];
  readonly extraTokens: readonly string[];
};
