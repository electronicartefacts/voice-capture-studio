import { memo, useMemo, type CSSProperties } from "react";
import {
  Mic,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Volume2,
} from "lucide-react";
import type { PromptDefinition } from "@domains/corpus";
import type { LanguageCode } from "@shared/index";
import {
  formatCaptureDurationLimit,
  FREE_CAPTURE_MAX_DURATION_MS,
} from "../../recording/captureLimits";
import {
  formatDurationSeconds,
  formatMeterScale,
  formatPercent,
} from "../helpers";
import { createTranscriptPreview } from "../speech";
import type { ReadingGuideMode, RoomToneCalibration } from "../types";

export function RoomToneCalibrationScreen(input: {
  readonly audioLevel: number;
  readonly progress: number;
  readonly totalMs: number;
}) {
  const remainingMs = Math.max(
    0,
    Math.ceil(input.totalMs * (1 - input.progress)),
  );

  return (
    <div className="room-tone-screen" aria-live="polite">
      <div className="recording-topbar">
        <div className="recording-dot">Calibration salle</div>
        <div className="recording-meter" aria-label="Niveau de salle">
          <Volume2 aria-hidden="true" size={18} />
          <span>
            <i
              style={
                {
                  "--meter-scale": formatMeterScale(input.audioLevel),
                } as CSSProperties
              }
            />
          </span>
        </div>
      </div>
      <div className="room-tone-core" aria-hidden="true">
        <span style={{ transform: `scale(${1 + input.audioLevel * 0.36})` }} />
      </div>
      <div className="room-tone-copy">
        <p className="soft-label">
          {formatDurationSeconds(remainingMs)} restantes
        </p>
        <h1>Silence de pièce.</h1>
        <p>Ne parle pas. Le niveau de base est mesuré avant la phrase.</p>
      </div>
      <dl className="room-tone-readout">
        <div>
          <dt>Niveau actuel</dt>
          <dd>{formatPercent(input.audioLevel * 100)}</dd>
        </div>
        <div>
          <dt>Durée</dt>
          <dd>{formatDurationSeconds(input.totalMs)}</dd>
        </div>
      </dl>
      <div
        className="read-progress"
        aria-label="Progression de la calibration"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(input.progress * 100)}
        role="progressbar"
      >
        <span style={{ width: formatPercent(input.progress * 100) }} />
      </div>
    </div>
  );
}

export function KaraokeScreen(input: {
  readonly activeWordIndex: number;
  readonly audioLevel: number;
  readonly currentPromptIndex: number;
  readonly continuousLyricsText: string | null;
  readonly isFreeCapture: boolean;
  readonly isFinalizing: boolean;
  readonly language: LanguageCode;
  readonly onStop: () => void;
  readonly prompt: PromptDefinition | undefined;
  readonly readingGuideMode: ReadingGuideMode;
  readonly recognizedTranscript: string;
  readonly roomTone: RoomToneCalibration | null;
  readonly totalPrompts: number;
  readonly words: readonly string[];
}) {
  const progress =
    input.words.length === 0
      ? 0
      : ((input.activeWordIndex + 1) / input.words.length) * 100;
  const detectedWordCount = input.recognizedTranscript
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const guideLabel =
    input.isFreeCapture && input.readingGuideMode === "speech-recognition"
      ? `Mots · ${detectedWordCount}`
      : input.readingGuideMode === "speech-recognition"
        ? "Suivi des mots"
        : "Suivi vocal";
  return (
    <div className="karaoke-screen" aria-busy={input.isFinalizing}>
      <div className="recording-topbar">
        <div className="recording-dot" aria-live="polite">
          {input.isFinalizing
            ? "Finalisation"
            : input.continuousLyricsText !== null
              ? "REC · Paroles complètes"
              : input.isFreeCapture
                ? "REC · Capture libre"
                : `REC · Phrase ${input.currentPromptIndex + 1}/${Math.max(input.totalPrompts, 1)}`}
        </div>
        <div className="recording-meter" aria-label="Niveau micro">
          <Volume2 aria-hidden="true" size={18} />
          <span>
            <i
              style={
                {
                  "--meter-scale": formatMeterScale(input.audioLevel),
                } as CSSProperties
              }
            />
          </span>
        </div>
        <div className="recording-cue">
          <Mic aria-hidden="true" size={18} />
          <span>{guideLabel}</span>
        </div>
        {input.roomTone !== null && (
          <div className="recording-cue">
            <ShieldCheck aria-hidden="true" size={18} />
            <span>Salle {input.roomTone.noiseFloorDbfs} dBFS</span>
          </div>
        )}
        <button
          className="stop-button"
          disabled={input.isFinalizing}
          onClick={input.onStop}
          type="button"
        >
          <Square aria-hidden="true" size={16} />
          <span>{input.isFinalizing ? "Finalisation..." : "Stop"}</span>
        </button>
      </div>
      {input.prompt !== undefined && (
        <div className="recording-cue">
          <SlidersHorizontal aria-hidden="true" size={18} />
          <span>{input.prompt.delivery.tone}</span>
        </div>
      )}
      {input.continuousLyricsText !== null ? (
        <div className="room-tone-copy">
          <p className="soft-label">Prise karaoké continue</p>
          <h1>Chante toutes les paroles.</h1>
          <p className="karaoke-lyrics">{input.continuousLyricsText}</p>
        </div>
      ) : input.isFreeCapture ? (
        <div className="room-tone-copy">
          <p className="soft-label">Prise continue</p>
          <h1>Le studio enregistre.</h1>
          <p>
            Parle, chante ou capture l'environnement. Arrête manuellement quand
            la prise est complète, dans la limite de{" "}
            {formatCaptureDurationLimit(FREE_CAPTURE_MAX_DURATION_MS)}.
          </p>
        </div>
      ) : (
        <KaraokeText
          activeWordIndex={input.activeWordIndex}
          words={input.words}
        />
      )}
      <p className="recording-assist" aria-live="polite">
        {input.isFinalizing
          ? "Ne ferme pas l'onglet. Le WAV et les métadonnées sont en préparation."
          : input.isFreeCapture
            ? input.readingGuideMode === "speech-recognition"
              ? `Les mots finalisés sont ajoutés au manifeste de cette prise. La capture reste limitée à ${formatCaptureDurationLimit(FREE_CAPTURE_MAX_DURATION_MS)}.`
              : `La capture est limitée à ${formatCaptureDurationLimit(FREE_CAPTURE_MAX_DURATION_MS)} pour préserver la mémoire de l'appareil.`
            : "Lis naturellement. La prise se ferme automatiquement à la fin de la phrase."}
      </p>
      {input.isFreeCapture && input.recognizedTranscript.trim().length > 0 && (
        <div
          aria-live="polite"
          className="speech-follow-line"
          data-testid="free-capture-words"
        >
          <span className="soft-label">
            Mots détectés · {detectedWordCount}
          </span>
          <span>{createTranscriptPreview(input.recognizedTranscript)}</span>
        </div>
      )}
      {!input.isFreeCapture &&
        input.readingGuideMode === "speech-recognition" &&
        input.recognizedTranscript.trim().length > 0 && (
          <p className="speech-follow-line">
            {createTranscriptPreview(input.recognizedTranscript)}
          </p>
        )}
      {!input.isFreeCapture && (
        <div
          className="read-progress"
          aria-label="Progression de lecture"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(progress)}
          role="progressbar"
        >
          <span style={{ width: formatPercent(progress) }} />
        </div>
      )}
    </div>
  );
}

export const KaraokeText = memo(function KaraokeText(input: {
  readonly activeWordIndex: number;
  readonly words: readonly string[];
}) {
  const visualLines = useMemo(
    () => createKaraokeVisualLines(input.words),
    [input.words],
  );

  return (
    <p className="karaoke-line" aria-label={input.words.join(" ")}>
      {visualLines.map((line, lineIndex) => (
        <span
          aria-hidden="true"
          className="karaoke-visual-line"
          key={`line-${lineIndex}`}
        >
          {line.map(({ word, wordIndex }) => (
            <span
              className={[
                "karaoke-word",
                wordIndex < input.activeWordIndex ? "is-past" : "",
                wordIndex === input.activeWordIndex ? "is-current" : "",
                wordIndex === input.activeWordIndex + 1 ? "is-next" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${word}-${wordIndex}`}
              style={
                {
                  "--word-delay": `${wordIndex * 14}ms`,
                } as CSSProperties
              }
            >
              {word}
            </span>
          ))}
        </span>
      ))}
    </p>
  );
});

export type KaraokeVisualWord = {
  readonly word: string;
  readonly wordIndex: number;
};

function createKaraokeVisualLines(
  words: readonly string[],
): readonly (readonly KaraokeVisualWord[])[] {
  const lines: KaraokeVisualWord[][] = [];
  let currentLine: KaraokeVisualWord[] = [];
  let currentLength = 0;
  const maxLineLength = 28;
  const softLineLength = 18;

  words.forEach((word, wordIndex) => {
    const nextLength =
      currentLength === 0 ? word.length : currentLength + 1 + word.length;
    const previousWord = currentLine.at(-1)?.word ?? "";
    const shouldBreakAfterPunctuation =
      currentLine.length > 0 &&
      /[.:;!?]$/.test(previousWord) &&
      currentLength >= 12;
    const shouldBreakBeforeWord =
      currentLine.length > 0 && nextLength > maxLineLength;
    const shouldBreakForBalance =
      currentLine.length >= 3 &&
      currentLength >= softLineLength &&
      nextLength > maxLineLength - 5;

    if (
      shouldBreakAfterPunctuation ||
      shouldBreakBeforeWord ||
      shouldBreakForBalance
    ) {
      lines.push(currentLine);
      currentLine = [];
      currentLength = 0;
    }

    currentLine.push({ word, wordIndex });
    currentLength =
      currentLength === 0 ? word.length : currentLength + 1 + word.length;
  });

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}
