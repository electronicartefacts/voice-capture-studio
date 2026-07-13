import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Mic,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Volume2,
} from "lucide-react";
import type { PromptDefinition } from "@domains/corpus";
import type { LanguageCode } from "@shared/index";
import { getLiveAudioLevel } from "../../rendering/liveAudioSignal";
import { liveReadingGuideSignal } from "../../rendering/liveReadingGuideSignal";
import {
  formatCaptureDurationLimit,
  FREE_CAPTURE_MAX_DURATION_MS,
} from "../../recording/captureLimits";
import {
  formatDurationSeconds,
  formatMeterScale,
  formatPercent,
} from "../helpers";
import { KARAOKE_STYLE_UPDATE_INTERVAL_MS } from "../audioEnvironment";
import { createTranscriptPreview } from "../speech";
import type { ReadingGuideMode, RoomToneCalibration } from "../types";
import type { DubbingMediaSource } from "../types";
import { DubbingMediaStage } from "./DubbingMediaStage";

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
  readonly dubbingEndSeconds: number | null;
  readonly dubbingMedia: DubbingMediaSource | null;
  readonly dubbingMediaMuted: boolean;
  readonly dubbingStartSeconds: number;
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
                : input.dubbingMedia !== null
                  ? "REC · Doublage image"
                  : `REC · Phrase ${input.currentPromptIndex + 1}/${Math.max(input.totalPrompts, 1)}`}
        </div>
        <RecordingElapsedTime running={!input.isFinalizing} />
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
        <FreeCaptureSurface transcript={input.recognizedTranscript} />
      ) : input.dubbingMedia !== null ? (
        <div className="dubbing-capture-layout">
          <DubbingMediaStage
            autoplay={!input.isFinalizing}
            className="is-capturing"
            endSeconds={input.dubbingEndSeconds}
            muted={input.dubbingMediaMuted}
            source={input.dubbingMedia}
            startSeconds={input.dubbingStartSeconds}
          />
          <div className="dubbing-capture-prompt">
            <p className="soft-label">Réplique en cours</p>
            <KaraokeText
              activeWordIndex={input.activeWordIndex}
              words={input.words}
            />
          </div>
        </div>
      ) : (
        <KaraokeText
          activeWordIndex={input.activeWordIndex}
          words={input.words}
        />
      )}
      {input.isFinalizing && (
        <p className="recording-assist" aria-live="polite">
          Ne ferme pas l'onglet. Le WAV et les métadonnées sont en préparation.
        </p>
      )}
    </div>
  );
}

function FreeCaptureSurface(input: { readonly transcript: string }) {
  const preview = createTranscriptPreview(input.transcript);
  const words = preview.split(/\s+/).filter(Boolean);

  return (
    <>
      <p
        aria-label={
          preview.length > 0 ? preview : "En attente de mots reconnus"
        }
        aria-live="polite"
        className="karaoke-line free-capture-line"
        data-testid="free-capture-words"
      >
        {words.map((word, index) => (
          <span
            className={`karaoke-word ${index === words.length - 1 ? "is-current" : "is-past"}`}
            key={`${word}-${index}`}
            style={{ "--word-delay": `${index * 18}ms` } as CSSProperties}
          >
            {word}
          </span>
        ))}
      </p>
      <div className="free-capture-guidance">
        <p>
          Parle, chante ou capture l'environnement. Arrête manuellement quand la
          prise est complète.
        </p>
        <small>
          Limite de {formatCaptureDurationLimit(FREE_CAPTURE_MAX_DURATION_MS)}{" "}
          pour préserver la mémoire de l'appareil.
        </small>
      </div>
    </>
  );
}

function RecordingElapsedTime(input: { readonly running: boolean }) {
  const startedAtRef = useRef(performance.now());
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!input.running) {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAtRef.current);
    }, 250);

    return () => window.clearInterval(timer);
  }, [input.running]);

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    <time
      className="recording-cue recording-elapsed"
      dateTime={`PT${totalSeconds}S`}
    >
      {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
    </time>
  );
}

export const KaraokeText = memo(function KaraokeText(input: {
  readonly activeWordIndex: number;
  readonly words: readonly string[];
}) {
  const lineRef = useRef<HTMLParagraphElement | null>(null);
  const activeWordIndexRef = useRef(input.activeWordIndex);
  const characterStyleValuesRef = useRef<
    readonly { readonly detail: string; readonly motion: string }[]
  >([]);
  const renderedPositionRef = useRef({
    progress: 0,
    wordIndex: input.activeWordIndex,
  });
  const visualLines = useMemo(
    () => createKaraokeVisualLines(input.words),
    [input.words],
  );
  const wordStartIndexes = useMemo(() => {
    let nextIndex = 0;

    return input.words.map((word) => {
      const startIndex = nextIndex;

      nextIndex += Array.from(word).length;
      return startIndex;
    });
  }, [input.words]);

  useEffect(() => {
    activeWordIndexRef.current = input.activeWordIndex;
  }, [input.activeWordIndex]);

  useEffect(() => {
    const line = lineRef.current;

    if (line === null || input.words.length === 0) {
      return;
    }

    const characters = Array.from(
      line.querySelectorAll<HTMLElement>(".karaoke-char"),
    );

    characterStyleValuesRef.current = [];
    renderedPositionRef.current = {
      progress: liveReadingGuideSignal.wordProgress,
      wordIndex: liveReadingGuideSignal.wordIndex,
    };

    let frameId = 0;
    let lastStyleUpdateAt = -Infinity;

    function animate(now: number) {
      if (now - lastStyleUpdateAt < KARAOKE_STYLE_UPDATE_INTERVAL_MS) {
        frameId = window.requestAnimationFrame(animate);
        return;
      }

      lastStyleUpdateAt = now;
      const energy = getLiveAudioLevel();
      const signalWordIndex = Math.max(
        activeWordIndexRef.current,
        Math.min(input.words.length - 1, liveReadingGuideSignal.wordIndex),
      );
      const targetProgress =
        signalWordIndex === liveReadingGuideSignal.wordIndex
          ? liveReadingGuideSignal.wordProgress
          : 0;
      const renderedPosition = renderedPositionRef.current;

      if (renderedPosition.wordIndex !== signalWordIndex) {
        renderedPosition.wordIndex = signalWordIndex;
        renderedPosition.progress = Math.min(0.22, targetProgress);
      } else {
        const smoothing =
          liveReadingGuideSignal.source === "voice-activity" ? 0.34 : 0.22;

        renderedPosition.progress +=
          (targetProgress - renderedPosition.progress) * smoothing;
      }

      const activeWord = input.words[signalWordIndex] ?? "";
      const activeWordLength = Math.max(1, Array.from(activeWord).length);
      const activeWordStart = wordStartIndexes[signalWordIndex] ?? 0;
      const characterFront =
        activeWordStart +
        renderedPosition.progress * Math.max(0, activeWordLength - 1);
      const sigma = 1.18 + energy * 0.5;
      const nextStyleValues: {
        readonly detail: string;
        readonly motion: string;
      }[] = [];

      characters.forEach((character, characterIndex) => {
        const index = Number(character.dataset.charIndex ?? 0);
        const wordIndex = Number(character.dataset.wordIndex ?? 0);
        const distance = Math.abs(index - characterFront);
        const focus = Math.exp(-(distance * distance) / (2 * sigma * sigma));
        const trail =
          wordIndex === signalWordIndex && index < characterFront
            ? Math.max(0, 1 - distance / 5.5) * 0.12
            : 0;
        const base =
          wordIndex < signalWordIndex
            ? 0.42
            : wordIndex === signalWordIndex
              ? 0.28
              : wordIndex === signalWordIndex + 1
                ? 0.2
                : 0.12;
        const breath =
          wordIndex === signalWordIndex || wordIndex === signalWordIndex + 1
            ? Math.sin(now * 0.0014 - index * 0.17) * (0.012 + energy * 0.025)
            : 0;
        const motion = Math.max(
          0,
          Math.min(1, base + focus * (0.98 - base) + trail + breath),
        );
        const detail = Math.max(
          0,
          Math.min(1, base * 0.62 + focus * 0.78 + trail + energy * 0.04),
        );
        const nextValues = {
          detail: detail.toFixed(3),
          motion: motion.toFixed(3),
        };
        const previousValues = characterStyleValuesRef.current[characterIndex];

        if (previousValues?.motion !== nextValues.motion) {
          character.style.setProperty("--motion-wave", nextValues.motion);
        }

        if (previousValues?.detail !== nextValues.detail) {
          character.style.setProperty("--detail-wave", nextValues.detail);
        }

        nextStyleValues.push(nextValues);
      });

      characterStyleValuesRef.current = nextStyleValues;
      frameId = window.requestAnimationFrame(animate);
    }

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
      characterStyleValuesRef.current = [];
    };
  }, [input.words, wordStartIndexes]);

  return (
    <p
      className="karaoke-line"
      aria-label={input.words.join(" ")}
      ref={lineRef}
    >
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
              {Array.from(word).map((character, letterIndex) => {
                const characterIndex =
                  (wordStartIndexes[wordIndex] ?? 0) + letterIndex;

                return (
                  <span
                    className="karaoke-char"
                    data-char-index={characterIndex}
                    data-word-index={wordIndex}
                    key={`${character}-${letterIndex}`}
                  >
                    {character}
                  </span>
                );
              })}
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
