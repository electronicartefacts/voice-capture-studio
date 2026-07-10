import type {
  BrowserAsrHypothesis,
  BrowserAsrObservation,
} from "../../domains/observations";

export function createBrowserAsrObservation(input: {
  readonly available: boolean;
  readonly engine: BrowserAsrObservation["engine"];
  readonly generatedAt: string;
  readonly hypotheses: readonly BrowserAsrHypothesis[];
  readonly locale: string;
  readonly userAgent?: string;
}): BrowserAsrObservation {
  const finalHypotheses = input.hypotheses.filter(
    (hypothesis) => hypothesis.final,
  );
  const transcript = finalHypotheses
    .filter((hypothesis) => hypothesis.alternativeIndex === 0)
    .map((hypothesis) => hypothesis.text)
    .join(" ")
    .trim();
  const confidences = finalHypotheses
    .map((hypothesis) => hypothesis.confidence)
    .filter((value): value is number => value !== null);
  const runtime = parseBrowserRuntime(input.userAgent);

  return {
    schemaVersion: "voice.browser_asr_observation.v1",
    availability: input.available ? "available" : "unavailable",
    engine: input.available ? input.engine : null,
    locale: input.locale,
    transcript: transcript.length > 0 ? transcript : null,
    hypotheses: input.hypotheses,
    runtime,
    confidence: {
      value:
        confidences.length === 0
          ? null
          : round(
              confidences.reduce((total, value) => total + value, 0) /
                confidences.length,
            ),
      status: input.available ? "observed" : "unavailable",
      source: "browser_asr",
      reason: input.available
        ? "Confidence is browser-reported when provided; missing values remain null."
        : "SpeechRecognition was unavailable; no ASR claim is made.",
    },
    provenance: {
      source: "browser_asr",
      method: input.engine ?? "unavailable",
      methodVersion: "browser_managed_unknown",
      generatedAt: input.generatedAt,
    },
  };
}

function parseBrowserRuntime(
  userAgent: string | undefined,
): BrowserAsrObservation["runtime"] {
  if (userAgent === undefined || userAgent.length === 0) {
    return { userAgent: null, browserName: null, browserVersion: null };
  }

  const candidates: readonly [string, RegExp][] = [
    ["Edge", /Edg\/([\d.]+)/u],
    ["Chrome", /Chrome\/([\d.]+)/u],
    ["Firefox", /Firefox\/([\d.]+)/u],
    ["Safari", /Version\/([\d.]+).*Safari/u],
  ];
  const match = candidates
    .map(([name, pattern]) => ({ name, match: userAgent.match(pattern) }))
    .find((candidate) => candidate.match !== null);

  return {
    userAgent,
    browserName: match?.name ?? null,
    browserVersion: match?.match?.[1] ?? null,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
