export type SpeechSegment = {
  readonly startMs: number;
  readonly endMs: number;
};

export type SpeechSegmentSummary = {
  readonly leadingSilenceMs: number;
  readonly trailingSilenceMs: number;
  readonly speechDurationMs: number;
  readonly totalDurationMs: number;
};

export type LocalAnalysisProgress =
  | { readonly stage: "loading-model"; readonly progressPercent: number }
  | { readonly stage: "transcribing" }
  | { readonly stage: "detecting-speech" };

export type LocalTakeAnalysis = {
  readonly transcript: string;
  readonly matchedWordCount: number;
  readonly expectedWordCount: number;
  readonly speechSegments: readonly SpeechSegment[];
  readonly segmentSummary: SpeechSegmentSummary;
};

export type AnalysisWorkerRequest = {
  readonly id: number;
  readonly audio: Float32Array;
  readonly sampleRate: number;
  readonly language: string;
  readonly assetsBaseUrl: string;
};

export type AnalysisWorkerResponse =
  | {
      readonly id: number;
      readonly kind: "progress";
      readonly progress: LocalAnalysisProgress;
    }
  | {
      readonly id: number;
      readonly kind: "result";
      readonly transcript: string;
      readonly speechSegments: readonly SpeechSegment[];
    }
  | {
      readonly id: number;
      readonly kind: "error";
      readonly message: string;
    };
