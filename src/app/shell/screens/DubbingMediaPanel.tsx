import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link2, Trash2, Upload, Volume2, VolumeX } from "lucide-react";
import type { DubbingMediaSource } from "../types";
import { DubbingMediaStage } from "./DubbingMediaStage";

export function DubbingMediaPanel(input: {
  readonly cueSeconds: number;
  readonly muted: boolean;
  readonly onClear: () => void;
  readonly onCueSecondsChange: (seconds: number) => void;
  readonly onLocalVideo: (file: File) => void;
  readonly onMutedChange: (muted: boolean) => void;
  readonly onYouTubeUrl: (url: string) => void;
  readonly source: DubbingMediaSource | null;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [youtubeUrl, setYouTubeUrl] = useState("");

  function submitYouTubeUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (youtubeUrl.trim().length === 0) {
      return;
    }

    input.onYouTubeUrl(youtubeUrl);
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (file !== undefined) {
      input.onLocalVideo(file);
    }
  }

  return (
    <section className="local-corpus-panel dubbing-media-panel">
      <div className="local-corpus-header dubbing-media-header">
        <div>
          <p className="soft-label">Image de référence</p>
          <strong>{input.source?.name ?? "Aucune scène chargée"}</strong>
        </div>
        {input.source !== null && (
          <button
            aria-label="Retirer la vidéo"
            className="quiet-button icon-only"
            onClick={input.onClear}
            type="button"
          >
            <Trash2 aria-hidden="true" size={17} />
          </button>
        )}
      </div>

      <div className="backing-track-actions dubbing-source-actions">
        <button
          className="folder-button compact"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Upload aria-hidden="true" size={17} />
          <span>Choisir une vidéo</span>
        </button>
        <input
          accept="video/*,.mp4,.m4v,.mov,.webm,.ogv"
          className="sr-only"
          onChange={handleFileSelection}
          ref={fileInputRef}
          type="file"
        />
        <form className="youtube-source-form" onSubmit={submitYouTubeUrl}>
          <label className="voice-name-field">
            <span className="sr-only">Lien YouTube</span>
            <input
              inputMode="url"
              onChange={(event) => setYouTubeUrl(event.target.value)}
              placeholder="Coller un lien YouTube"
              type="url"
              value={youtubeUrl}
            />
          </label>
          <button className="folder-button compact" type="submit">
            <Link2 aria-hidden="true" size={17} />
            <span>Relier</span>
          </button>
        </form>
      </div>

      {input.source !== null && (
        <>
          <DubbingMediaStage
            autoplay={false}
            endSeconds={null}
            muted={input.muted}
            source={input.source}
            startSeconds={input.cueSeconds}
          />
          <div className="backing-track-controls dubbing-transport-options">
            <label className="voice-name-field dubbing-cue-field">
              <span>Départ de la scène</span>
              <span>
                <input
                  min={0}
                  onChange={(event) =>
                    input.onCueSecondsChange(
                      Math.max(0, Number(event.target.value) || 0),
                    )
                  }
                  step={1}
                  type="number"
                  value={input.cueSeconds}
                />
                <em>secondes</em>
              </span>
            </label>
            <label className="inline-toggle dubbing-audio-toggle">
              <input
                checked={!input.muted}
                onChange={(event) => input.onMutedChange(!event.target.checked)}
                type="checkbox"
              />
              {input.muted ? (
                <VolumeX aria-hidden="true" size={16} />
              ) : (
                <Volume2 aria-hidden="true" size={16} />
              )}
              <span>Son de la scène</span>
            </label>
          </div>
        </>
      )}

      <p className="coach-note">
        {input.source?.kind === "youtube"
          ? "YouTube reste en ligne et n'est jamais copié dans le workspace. Utilise un casque pour éviter la repisse."
          : "La vidéo reste sur cet appareil. Charge un SRT ou VTT pour reprendre automatiquement ses timecodes."}
      </p>
    </section>
  );
}
