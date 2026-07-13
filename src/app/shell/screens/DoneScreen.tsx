import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  AudioLines,
  Database,
  Download,
  Home,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  StepForward,
} from "lucide-react";
import type { RecordedTake } from "@domains/sessions";
import {
  createReviewWordTimings,
  findActiveReviewWordIndex,
} from "../../audio/reviewWordTimings";
import {
  analyzeTakeAudio,
  isLocalAnalysisSupported,
} from "../../analysis/localTakeAnalysis";
import type {
  LocalAnalysisProgress,
  LocalTakeAnalysis,
} from "../../analysis/types";
import {
  REVIEW_WAVEFORM_BAR_COUNT,
  closeAmbientAudioContext,
  type WindowWithAudioContext,
} from "../audioEnvironment";
import { createTakeCoachNote, formatPercent } from "../helpers";

export function ListeningReviewSurface(input: {
  readonly audioUrl: string | null;
  readonly fileName: string | null;
  readonly onBeforePlayback: () => void;
  readonly onEnergyChange: (level: number) => void;
  readonly onProgressChange: (progress: number) => void;
  readonly take: RecordedTake | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackTimeRef = useRef<HTMLElement | null>(null);
  const progressClipRef = useRef<SVGRectElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const scrubbingPointerRef = useRef<number | null>(null);
  const onEnergyChangeRef = useRef(input.onEnergyChange);
  const onProgressChangeRef = useRef(input.onProgressChange);
  const smoothedPlaybackEnergyRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    Math.max(0, (input.take?.durationMs ?? 0) / 1000),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const waveformId = useId().replace(/:/g, "");
  const wordTimings = useMemo(
    () => createReviewWordTimings(input.take),
    [input.take],
  );
  const [decodedBars, setDecodedBars] = useState<
    readonly ReviewWaveformBar[] | null
  >(null);
  const waveformBars = useMemo(
    () => decodedBars ?? createPlaceholderWaveformBars(),
    [decodedBars],
  );
  useEffect(() => {
    setDecodedBars(null);

    if (input.audioUrl === null) {
      return;
    }

    let cancelled = false;

    void extractReviewWaveformBars(input.audioUrl).then((bars) => {
      if (!cancelled && bars !== null) {
        setDecodedBars(bars);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [input.audioUrl]);
  const durationSeconds = Math.max(
    duration,
    (input.take?.durationMs ?? 0) / 1000,
  );
  const playbackProgress =
    durationSeconds <= 0
      ? 0
      : Math.max(0, Math.min(1, currentTime / durationSeconds));
  const activeWordIndex = findActiveReviewWordIndex(
    wordTimings,
    currentTime * 1000,
  );

  useEffect(() => {
    onEnergyChangeRef.current = input.onEnergyChange;
    onProgressChangeRef.current = input.onProgressChange;
  }, [input.onEnergyChange, input.onProgressChange]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(Math.max(0, (input.take?.durationMs ?? 0) / 1000));
    setIsPlaying(false);
    setLoopEnabled(false);
    smoothedPlaybackEnergyRef.current = 0;
    onProgressChangeRef.current(0);
    onEnergyChangeRef.current(0);
  }, [input.audioUrl, input.take]);

  function syncPlaybackSurface(nextTime: number) {
    const progress =
      durationSeconds <= 0
        ? 0
        : Math.max(0, Math.min(1, nextTime / durationSeconds));

    waveformRef.current?.style.setProperty(
      "--review-progress",
      String(progress),
    );
    progressClipRef.current?.setAttribute("width", String(progress));

    if (playbackTimeRef.current !== null) {
      playbackTimeRef.current.textContent = formatPlaybackTime(nextTime);
    }
  }

  useEffect(() => {
    syncPlaybackSurface(currentTime);
  }, [currentTime, durationSeconds]);

  useEffect(() => {
    if (!isPlaying) {
      onEnergyChangeRef.current(0.04);
      return;
    }

    let frameId = 0;

    // The halo and filament must trace the take actually being heard, not an
    // invented pulse: decoded per-bucket loudness is the true amplitude at
    // this instant of playback, so a plosive or a silence reads exactly as
    // loud or as quiet on screen as it does through the speaker.
    function animatePlaybackEnergy() {
      const audio = audioRef.current;
      const progress =
        audio === null || durationSeconds <= 0
          ? playbackProgress
          : audio.currentTime / durationSeconds;
      if (audio !== null) {
        syncPlaybackSurface(audio.currentTime);
      }
      const barIndex = Math.max(
        0,
        Math.min(
          waveformBars.length - 1,
          Math.floor(progress * waveformBars.length),
        ),
      );
      const measuredEnergy = waveformBars[barIndex].rmsPercent / 100;

      smoothedPlaybackEnergyRef.current +=
        (measuredEnergy - smoothedPlaybackEnergyRef.current) * 0.35;
      onEnergyChangeRef.current(
        Math.min(1, 0.04 + smoothedPlaybackEnergyRef.current * 0.92),
      );
      frameId = window.requestAnimationFrame(animatePlaybackEnergy);
    }

    frameId = window.requestAnimationFrame(animatePlaybackEnergy);

    return () => window.cancelAnimationFrame(frameId);
  }, [durationSeconds, isPlaying, playbackProgress, waveformBars]);

  function updateTime(nextTime: number) {
    const boundedTime = Math.max(0, Math.min(durationSeconds, nextTime));

    setCurrentTime(boundedTime);
    onProgressChangeRef.current(
      durationSeconds <= 0
        ? 0
        : Math.max(0, Math.min(1, boundedTime / durationSeconds)),
    );
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;
    const nextDuration =
      audio === null || !Number.isFinite(audio.duration)
        ? Math.max(0, (input.take?.durationMs ?? 0) / 1000)
        : audio.duration;

    setDuration(nextDuration);
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;

    if (audio === null) {
      return;
    }

    updateTime(audio.currentTime);
  }

  function seekToProgress(nextProgress: number) {
    const audio = audioRef.current;
    const nextTime = Math.max(0, Math.min(1, nextProgress)) * durationSeconds;

    if (audio !== null) {
      audio.currentTime = nextTime;
    }

    updateTime(nextTime);
  }

  function seekToWord(index: number) {
    const timing = wordTimings[index];

    if (timing === undefined) {
      return;
    }

    seekToProgress(
      durationSeconds <= 0 ? 0 : timing.startMs / 1000 / durationSeconds,
    );
  }

  function seekWaveformFromClientX(element: HTMLDivElement, clientX: number) {
    const bounds = element.getBoundingClientRect();

    if (bounds.width === 0) {
      return;
    }

    seekToProgress((clientX - bounds.left) / bounds.width);
  }

  function handleWaveformPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }

    event.preventDefault();
    scrubbingPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsScrubbing(true);
    seekWaveformFromClientX(event.currentTarget, event.clientX);

    if (event.pointerType === "touch") {
      navigator.vibrate?.(8);
    }
  }

  function handleWaveformPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (scrubbingPointerRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    seekWaveformFromClientX(event.currentTarget, event.clientX);
  }

  function finishWaveformScrubbing(event: PointerEvent<HTMLDivElement>) {
    if (scrubbingPointerRef.current !== event.pointerId) {
      return;
    }

    scrubbingPointerRef.current = null;
    setIsScrubbing(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWaveformKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.1 : 0.025;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekToProgress(playbackProgress - step);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      seekToProgress(playbackProgress + step);
    }

    if (event.key === "Home") {
      event.preventDefault();
      seekToProgress(0);
    }

    if (event.key === "End") {
      event.preventDefault();
      seekToProgress(1);
    }
  }

  async function togglePlayback() {
    const audio = audioRef.current;

    if (audio === null) {
      return;
    }

    if (isPlaying) {
      audio.pause();
      return;
    }

    input.onBeforePlayback();

    if (durationSeconds > 0 && currentTime >= durationSeconds - 0.05) {
      audio.currentTime = 0;
      updateTime(0);
    }

    await audio.play().catch(() => undefined);
  }

  function replay() {
    const audio = audioRef.current;

    if (audio !== null) {
      audio.currentTime = 0;
    }

    updateTime(0);
  }

  if (input.take === null && input.audioUrl === null) {
    return (
      <section className="listening-review" aria-label="Écoute de la prise">
        <p className="soft-label">Écoute</p>
        <p className="empty-export-state">
          La prise apparaîtra ici quand le fichier audio sera disponible.
        </p>
      </section>
    );
  }

  const reviewFileName =
    input.fileName ?? input.take?.fileName ?? "Capture audio";
  const takeReference =
    input.take === null
      ? "LIBRE"
      : String(input.take.id)
          .replace(/^take[._-]?/i, "")
          .slice(0, 8)
          .toUpperCase();
  const technicalFormat = input.take?.quality.technical ?? null;

  return (
    <section className="listening-review" aria-label="Écoute de la prise">
      {input.audioUrl !== null && (
        <audio
          loop={loopEnabled}
          onEnded={() => {
            setIsPlaying(false);
            onEnergyChangeRef.current(0);
          }}
          onLoadedMetadata={handleLoadedMetadata}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onTimeUpdate={handleTimeUpdate}
          playsInline
          preload="metadata"
          ref={audioRef}
          src={input.audioUrl}
        />
      )}
      <div className="listening-header">
        <div className="take-identity">
          <p className="soft-label">Moniteur de prise</p>
          <h2>
            {input.take === null ? "Capture" : "Prise"}{" "}
            <span>{takeReference}</span>
          </h2>
          <p className="take-file-name" title={reviewFileName}>
            {reviewFileName}
          </p>
        </div>
      </div>
      <div
        aria-label="Surface de lecture de la prise"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(playbackProgress * 100)}
        aria-valuetext={`${formatPlaybackTime(currentTime)} sur ${formatPlaybackTime(durationSeconds)}`}
        className={`playback-waveform${isScrubbing ? " is-scrubbing" : ""}`}
        onKeyDown={handleWaveformKeyboard}
        onLostPointerCapture={finishWaveformScrubbing}
        onPointerCancel={finishWaveformScrubbing}
        onPointerDown={handleWaveformPointerDown}
        onPointerMove={handleWaveformPointerMove}
        onPointerUp={finishWaveformScrubbing}
        role="slider"
        ref={waveformRef}
        style={
          {
            "--review-progress": playbackProgress,
            cursor: isScrubbing ? "grabbing" : "ew-resize",
            touchAction: "none",
          } as CSSProperties
        }
        tabIndex={0}
      >
        <span aria-hidden="true" className="waveform-format">
          <span>
            {technicalFormat === null
              ? "Audio local"
              : `${technicalFormat.sampleRateHz / 1000} kHz · ${technicalFormat.bitDepth}-bit`}
          </span>
          <span>WAVE / PCM</span>
        </span>
        <svg
          aria-hidden="true"
          className="review-waveform-svg"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <defs>
            <clipPath
              clipPathUnits="objectBoundingBox"
              id={`${waveformId}-progress`}
            >
              <rect height="1" ref={progressClipRef} width={playbackProgress} />
            </clipPath>
          </defs>
          <g className="waveform-bars-base">
            {waveformBars.map((bar, index) => {
              const step = 100 / waveformBars.length;
              const height = Math.max(2, bar.heightPercent * 0.72);

              return (
                <rect
                  className={bar.silent ? "is-silent" : undefined}
                  height={height}
                  key={index}
                  rx="0.36"
                  width={Math.max(0.34, step * 0.62)}
                  x={index * step + step * 0.19}
                  y={(100 - height) / 2}
                />
              );
            })}
          </g>
          <g
            className="waveform-bars-played"
            clipPath={`url(#${waveformId}-progress)`}
          >
            {waveformBars.map((bar, index) => {
              const step = 100 / waveformBars.length;
              const height = Math.max(2, bar.heightPercent * 0.72);

              return (
                <rect
                  className={bar.silent ? "is-silent" : undefined}
                  height={height}
                  key={index}
                  rx="0.36"
                  width={Math.max(0.34, step * 0.62)}
                  x={index * step + step * 0.19}
                  y={(100 - height) / 2}
                />
              );
            })}
          </g>
        </svg>
        <span
          aria-hidden="true"
          className="review-playhead"
          style={
            isScrubbing
              ? {
                  boxShadow:
                    "0 0 26px 4px color-mix(in srgb, var(--accent-a) 72%, transparent)",
                  width: 3,
                }
              : undefined
          }
        />
        <span aria-hidden="true" className="waveform-time-scale">
          <span>0:00</span>
          <span>{formatPlaybackTime(durationSeconds)}</span>
        </span>
      </div>
      <div className="playback-controls">
        <div className="playback-time" aria-label="Temps de lecture">
          <strong ref={playbackTimeRef}>
            {formatPlaybackTime(currentTime)}
          </strong>
          <span>/ {formatPlaybackTime(durationSeconds)}</span>
        </div>
        <button
          className="transport-button transport-primary"
          disabled={input.audioUrl === null}
          onClick={() => void togglePlayback()}
          type="button"
        >
          {isPlaying ? (
            <Pause aria-hidden="true" size={18} />
          ) : (
            <Play aria-hidden="true" size={18} />
          )}
          <span>{isPlaying ? "Pause" : "Écouter"}</span>
        </button>
        <button
          aria-label="Recommencer la lecture"
          className="transport-icon-button"
          disabled={input.audioUrl === null}
          onClick={replay}
          title="Recommencer la lecture"
          type="button"
        >
          <RotateCcw aria-hidden="true" size={17} />
        </button>
        <button
          aria-label="Lire en boucle"
          aria-pressed={loopEnabled}
          className="transport-icon-button"
          disabled={input.audioUrl === null}
          onClick={() => setLoopEnabled((enabled) => !enabled)}
          title="Lire en boucle"
          type="button"
        >
          <Repeat2 aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="transcript-panel">
        <div className="transcript-header">
          <p className="soft-label">Transcription</p>
          <span>{wordTimings.length} mots · synchronisée</span>
        </div>
        <div className="review-transcript" aria-label="Transcript synchronisé">
          {wordTimings.map((timing, index) => (
            <button
              className={[
                "review-word",
                index === activeWordIndex ? "is-active" : "",
                index < activeWordIndex ? "is-spoken" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${timing.word}-${index}`}
              onClick={() => seekToWord(index)}
              type="button"
            >
              {timing.word}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatPlaybackTime(seconds: number): string {
  const boundedSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(boundedSeconds / 60);
  const remainingSeconds = Math.floor(boundedSeconds % 60);

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export type ReviewWaveformBar = {
  readonly heightPercent: number;
  readonly rmsPercent: number;
  readonly silent: boolean;
};

function createPlaceholderWaveformBars(): readonly ReviewWaveformBar[] {
  return Array.from({ length: REVIEW_WAVEFORM_BAR_COUNT }, (_, index) => {
    const center = 1 - Math.abs(index / (REVIEW_WAVEFORM_BAR_COUNT - 1) - 0.5);
    const heightPercent = 10 + center * 12;

    return {
      heightPercent,
      rmsPercent: heightPercent,
      silent: false,
    };
  });
}

async function extractReviewWaveformBars(
  audioUrl: string,
): Promise<readonly ReviewWaveformBar[] | null> {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as WindowWithAudioContext).webkitAudioContext;

  if (AudioContextConstructor === undefined) {
    return null;
  }

  try {
    const response = await fetch(audioUrl);
    const encodedAudio = await response.arrayBuffer();
    const audioContext = new AudioContextConstructor();

    try {
      const decoded = await audioContext.decodeAudioData(encodedAudio);
      const samples = decoded.getChannelData(0);

      if (samples.length === 0) {
        return null;
      }

      const bucketSize = Math.max(
        1,
        Math.floor(samples.length / REVIEW_WAVEFORM_BAR_COUNT),
      );
      const buckets: { readonly peak: number; readonly rms: number }[] = [];
      let maxPeak = 0;
      let maxRms = 0;

      for (
        let bucketIndex = 0;
        bucketIndex < REVIEW_WAVEFORM_BAR_COUNT;
        bucketIndex += 1
      ) {
        const start = bucketIndex * bucketSize;
        const end = Math.min(samples.length, start + bucketSize);
        let peak = 0;
        let sumSquares = 0;

        for (let index = start; index < end; index += 1) {
          const sample = Math.abs(samples[index]);

          peak = Math.max(peak, sample);
          sumSquares += sample * sample;
        }

        const rms = Math.sqrt(sumSquares / Math.max(1, end - start));

        maxPeak = Math.max(maxPeak, peak);
        maxRms = Math.max(maxRms, rms);
        buckets.push({ peak, rms });
      }

      if (maxPeak <= 0) {
        return null;
      }

      return buckets.map((bucket) => ({
        heightPercent: Math.max(6, Math.round((bucket.peak / maxPeak) * 100)),
        rmsPercent: maxRms <= 0 ? 0 : Math.round((bucket.rms / maxRms) * 100),
        silent: bucket.rms < 0.004,
      }));
    } finally {
      await closeAmbientAudioContext(audioContext);
    }
  } catch {
    return null;
  }
}

export function DoneScreen(input: {
  readonly downloadUrl: string | null;
  readonly fileName: string | null;
  readonly hasNextPrompt: boolean;
  readonly isFreeCapture?: boolean;
  readonly isContinuousLyricsCapture?: boolean;
  readonly location: string | null;
  readonly metadataDownloadUrl: string | null;
  readonly message: string;
  readonly nextRecommendation: string | null;
  readonly onAgain: () => void;
  readonly onHome: () => void;
  readonly onNext: () => void;
  readonly onBeforePlayback: () => void;
  readonly onPlaybackEnergyChange: (level: number) => void;
  readonly onPlaybackProgressChange: (progress: number) => void;
  readonly onLocalAnalysis: (analysis: LocalTakeAnalysis) => void;
  readonly onRetake: () => void;
  readonly language: string;
  readonly progressLabel: string | null;
  readonly take: RecordedTake | null;
}) {
  const isKeeper = input.take?.quality.verdict === "pass";
  const integrityHash = input.take?.media?.sha256 ?? null;

  return (
    <div className="focus-card" aria-live="polite">
      <div className="result-hero">
        <div className="result-heading">
          {input.progressLabel !== null && (
            <p className="soft-label">{input.progressLabel}</p>
          )}
          <h1>Écoute la prise.</h1>
          {input.take !== null && (
            <span className={`verdict-chip is-${isKeeper ? "pass" : "retake"}`}>
              {isKeeper ? "Prise utilisable" : "À reprendre"}
            </span>
          )}
        </div>
        <p className="result-message">{input.message}</p>
      </div>
      <ListeningReviewSurface
        audioUrl={input.downloadUrl}
        fileName={input.fileName}
        onBeforePlayback={input.onBeforePlayback}
        onEnergyChange={input.onPlaybackEnergyChange}
        onProgressChange={input.onPlaybackProgressChange}
        take={input.take}
      />
      <section
        className="result-command-panel"
        aria-label="Actions de la prise"
      >
        <div className="result-primary-actions">
          {input.isFreeCapture ? (
            <button
              className="launch-button"
              onClick={input.onAgain}
              type="button"
            >
              <Play aria-hidden="true" size={19} />
              <span>
                {input.isContinuousLyricsCapture
                  ? "Reprendre les paroles"
                  : "Nouvelle capture libre"}
              </span>
            </button>
          ) : !isKeeper ? (
            <>
              <button
                className="launch-button"
                onClick={input.onRetake}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={19} />
                <span>Refaire cette prise</span>
              </button>
              {input.hasNextPrompt && (
                <button
                  className="folder-button"
                  onClick={input.onNext}
                  type="button"
                >
                  <StepForward aria-hidden="true" size={19} />
                  <span>Passer sans valider</span>
                </button>
              )}
            </>
          ) : input.hasNextPrompt ? (
            <button
              className="launch-button"
              onClick={input.onNext}
              type="button"
            >
              <StepForward aria-hidden="true" size={19} />
              <span>Phrase suivante</span>
            </button>
          ) : (
            <button
              className="launch-button"
              onClick={input.onAgain}
              type="button"
            >
              <Play aria-hidden="true" size={19} />
              <span>Nouvelle session</span>
            </button>
          )}
          {isKeeper && (
            <button
              className="folder-button"
              onClick={input.onRetake}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={19} />
              <span>Refaire cette prise</span>
            </button>
          )}
          {!input.isFreeCapture &&
            ((!isKeeper && !input.hasNextPrompt) ||
              (isKeeper && input.hasNextPrompt)) && (
              <button
                className="folder-button"
                onClick={input.onAgain}
                type="button"
              >
                <Play aria-hidden="true" size={19} />
                <span>Nouvelle session</span>
              </button>
            )}
          <button
            className="quiet-button result-home-action"
            onClick={input.onHome}
            type="button"
          >
            <Home aria-hidden="true" size={17} />
            <span>Accueil</span>
          </button>
        </div>
        <div className="result-export-actions" aria-label="Téléchargements">
          {input.downloadUrl !== null && input.fileName !== null && (
            <a
              className="download-action"
              download={input.fileName}
              href={input.downloadUrl}
            >
              <Download aria-hidden="true" size={18} />
              <span>Télécharger le WAV</span>
            </a>
          )}
          {input.metadataDownloadUrl !== null && (
            <a
              className="folder-button"
              download="voice.capture_session.json"
              href={input.metadataDownloadUrl}
            >
              <Download aria-hidden="true" size={18} />
              <span>Télécharger le JSON</span>
            </a>
          )}
          {input.downloadUrl === null && input.metadataDownloadUrl === null && (
            <p className="empty-export-state">
              Les liens de téléchargement apparaissent ici quand le navigateur
              ne peut pas écrire directement dans le dossier.
            </p>
          )}
        </div>
      </section>
      {input.take !== null && (
        <details className="take-score progressive-review">
          <summary>
            <strong>Qualité et détails de prise</strong>
            <span>{isKeeper ? "Utilisable" : "À reprendre"}</span>
          </summary>
          <p>{input.take.review.directorNotes}</p>
          <p className="coach-note">
            {createTakeCoachNote(input.take, input.nextRecommendation)}
          </p>
          <dl>
            <div>
              <dt>Pic</dt>
              <dd>{input.take.quality.technical.peakDbfs} dBFS</dd>
            </div>
            <div>
              <dt>LUFS</dt>
              <dd>{input.take.quality.technical.integratedLufs}</dd>
            </div>
            <div>
              <dt>SNR</dt>
              <dd>{input.take.quality.technical.snrDb} dB</dd>
            </div>
            <div>
              <dt>True peak estimé</dt>
              <dd>{input.take.quality.technical.estimatedTruePeakDbfs} dBFS</dd>
            </div>
            <div>
              <dt>Activité vocale</dt>
              <dd>
                {formatPercent(
                  input.take.quality.technical.activeSpeechRatio * 100,
                )}
              </dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>
                {input.take.quality.technical.sampleRateHz / 1000} kHz /{" "}
                {input.take.quality.technical.bitDepth}-bit
              </dd>
            </div>
            <div>
              <dt>Transcript</dt>
              <dd>
                {formatPercent(
                  input.take.quality.performance.transcriptMatch * 100,
                )}
              </dd>
            </div>
            <div>
              <dt>Alignement</dt>
              <dd>
                {formatPercent(
                  (input.take.quality.performance.alignmentConfidence ?? 0) *
                    100,
                )}
              </dd>
            </div>
            <div>
              <dt>Intégrité WAV</dt>
              <dd title={integrityHash ?? undefined}>
                {integrityHash === null
                  ? "Indisponible (prise historique)"
                  : `SHA-256 ${integrityHash.slice(0, 12)}…`}
              </dd>
            </div>
            <div>
              <dt>Phonèmes</dt>
              <dd>
                {input.take.quality.performance.phonemeInventoryCount ?? 0}
              </dd>
            </div>
            <div>
              <dt>Liens mot/phonème</dt>
              <dd>
                {formatPercent(
                  (input.take.quality.performance.wordPhonemeLinkRate ?? 0) *
                    100,
                )}
              </dd>
            </div>
          </dl>
          <div>
            {input.take.quality.gates.map((gate) => (
              <small className={`gate-${gate.status}`} key={gate.id}>
                {gate.label}: {gate.status}
              </small>
            ))}
          </div>
        </details>
      )}
      {input.take !== null &&
        input.downloadUrl !== null &&
        isLocalAnalysisSupported() && (
          <LocalAnalysisPanel
            audioUrl={input.downloadUrl}
            expectedText={input.take.transcript.spokenText}
            language={input.language}
            onAnalysis={input.onLocalAnalysis}
            takeId={input.take.id}
          />
        )}
      {(input.location !== null || input.fileName !== null) && (
        <div className="file-receipt">
          <Database aria-hidden="true" size={18} />
          <div>
            {input.location !== null && <strong>{input.location}</strong>}
            {input.fileName !== null && <span>{input.fileName}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

type LocalAnalysisState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly progress: LocalAnalysisProgress }
  | { readonly status: "done"; readonly analysis: LocalTakeAnalysis }
  | { readonly status: "error"; readonly message: string };

function LocalAnalysisPanel(input: {
  readonly audioUrl: string;
  readonly expectedText: string;
  readonly language: string;
  readonly takeId: string;
  readonly onAnalysis: (analysis: LocalTakeAnalysis) => void;
}) {
  const [state, setState] = useState<LocalAnalysisState>({ status: "idle" });

  useEffect(() => {
    setState({ status: "idle" });
  }, [input.takeId]);

  async function runAnalysis() {
    setState({
      status: "running",
      progress: { stage: "loading-model", progressPercent: 0 },
    });

    try {
      const audioBlob = await (await fetch(input.audioUrl)).blob();
      const analysis = await analyzeTakeAudio({
        audioBlob,
        expectedText: input.expectedText,
        language: input.language,
        onProgress: (progress) => setState({ status: "running", progress }),
      });

      setState({ status: "done", analysis });
      input.onAnalysis(analysis);
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "L'analyse locale a échoué.",
      });
    }
  }

  return (
    <section
      aria-label="Analyse locale de la prise"
      className="local-analysis-panel"
      data-testid="local-analysis"
    >
      <div className="local-analysis-heading">
        <p className="soft-label">Analyse locale (IA sur l'appareil)</p>
        <p>
          Whisper vérifie le transcript et un détecteur de parole mesure les
          silences, directement dans le navigateur. Aucune donnée ne quitte
          l'appareil; les modèles (~45 Mo) se téléchargent depuis ce site à la
          première utilisation puis restent en cache.
        </p>
      </div>

      {state.status === "idle" && (
        <button
          className="folder-button"
          data-testid="local-analysis-run"
          onClick={() => void runAnalysis()}
          type="button"
        >
          <AudioLines aria-hidden="true" size={18} />
          <span>Analyser la prise</span>
        </button>
      )}

      {state.status === "running" && (
        <p aria-live="polite" className="local-analysis-progress">
          {formatAnalysisProgress(state.progress)}
        </p>
      )}

      {state.status === "error" && (
        <div className="local-analysis-error" role="alert">
          <p>{state.message}</p>
          <button
            className="quiet-button standalone"
            onClick={() => void runAnalysis()}
            type="button"
          >
            <span>Réessayer</span>
          </button>
        </div>
      )}

      {state.status === "done" && (
        <dl data-testid="local-analysis-result">
          <div>
            <dt>Transcript Whisper</dt>
            <dd>
              {state.analysis.transcript.length === 0
                ? "Aucune parole reconnue."
                : state.analysis.transcript}
            </dd>
          </div>
          <div>
            <dt>Correspondance au texte</dt>
            <dd>
              {state.analysis.expectedWordCount === 0
                ? "—"
                : `${state.analysis.matchedWordCount}/${state.analysis.expectedWordCount} mots (${formatPercent(
                    (state.analysis.matchedWordCount /
                      state.analysis.expectedWordCount) *
                      100,
                  )})`}
            </dd>
          </div>
          <div>
            <dt>Parole détectée</dt>
            <dd>
              {state.analysis.speechSegments.length === 0
                ? "Aucun segment de parole détecté."
                : `${formatAnalysisSeconds(
                    state.analysis.segmentSummary.speechDurationMs,
                  )} sur ${formatAnalysisSeconds(
                    state.analysis.segmentSummary.totalDurationMs,
                  )} (${state.analysis.speechSegments.length} segment${
                    state.analysis.speechSegments.length > 1 ? "s" : ""
                  })`}
            </dd>
          </div>
          <div>
            <dt>Repères acoustiques Whisper</dt>
            <dd>
              {state.analysis.whisperWords.length === 0
                ? "Aucun repère de mot exploitable."
                : `${state.analysis.whisperWords.length} mot${state.analysis.whisperWords.length > 1 ? "s" : ""} horodaté${state.analysis.whisperWords.length > 1 ? "s" : ""} depuis le signal.`}
            </dd>
          </div>
          <div>
            <dt>Accord des méthodes locales</dt>
            <dd>
              {state.analysis.alignmentComparison.medianBoundaryDeltaMs === null
                ? "Preuves insuffisantes pour comparer les frontières."
                : `${state.analysis.alignmentComparison.status} · ${Math.round(state.analysis.alignmentComparison.matchRate * 100)} % des mots reliés · écart médian ${state.analysis.alignmentComparison.medianBoundaryDeltaMs} ms`}
            </dd>
          </div>
          {state.analysis.speechSegments.length > 0 && (
            <div>
              <dt>Silences de bord</dt>
              <dd>
                {formatAnalysisSeconds(
                  state.analysis.segmentSummary.leadingSilenceMs,
                )}{" "}
                au début,{" "}
                {formatAnalysisSeconds(
                  state.analysis.segmentSummary.trailingSilenceMs,
                )}{" "}
                à la fin
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

function formatAnalysisProgress(progress: LocalAnalysisProgress): string {
  if (progress.stage === "loading-model") {
    return progress.progressPercent === 0
      ? "Préparation des modèles locaux…"
      : `Chargement des modèles locaux… ${progress.progressPercent}%`;
  }

  if (progress.stage === "transcribing") {
    return "Transcription locale en cours…";
  }

  return "Mesure des segments de parole…";
}

function formatAnalysisSeconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)} s`;
}
