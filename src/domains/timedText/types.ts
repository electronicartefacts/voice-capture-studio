export type TimedTextSource =
  | "external_forced_alignment"
  | "browser_live_alignment"
  | "local_acoustic_analysis"
  | "text_derived_estimate"
  | "imported_source";

export type TimedTextWord = {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence: number | null;
};

export type TimedTextLine = {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly words: readonly TimedTextWord[];
};

export type TimedTextDocument = {
  readonly schemaVersion: "voice.timed_text.v1";
  readonly language: string;
  readonly source: TimedTextSource;
  readonly offsetMs: number;
  readonly title: string | null;
  readonly lines: readonly TimedTextLine[];
};

export type TimedTextWordInput = {
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence?: number | null;
};
