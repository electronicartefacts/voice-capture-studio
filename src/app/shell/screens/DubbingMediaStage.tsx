import { useEffect, useMemo, useRef } from "react";
import { Clapperboard, Clock3 } from "lucide-react";
import { createYouTubeEmbedUrl, formatMediaTime } from "../dubbingMedia";
import type { DubbingMediaSource } from "../types";

export function DubbingMediaStage(input: {
  readonly autoplay: boolean;
  readonly className?: string;
  readonly endSeconds: number | null;
  readonly muted: boolean;
  readonly source: DubbingMediaSource;
  readonly startSeconds: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const startSeconds = Math.max(0, input.startSeconds);
  const endSeconds =
    input.endSeconds !== null && input.endSeconds > startSeconds
      ? input.endSeconds
      : null;
  const embedUrl = useMemo(
    () =>
      input.source.kind === "youtube"
        ? createYouTubeEmbedUrl({
            autoplay: input.autoplay,
            endSeconds,
            muted: input.muted,
            source: input.source,
            startSeconds,
          })
        : null,
    [endSeconds, input.autoplay, input.muted, input.source, startSeconds],
  );

  useEffect(() => {
    const video = videoRef.current;

    if (video === null) {
      return;
    }

    const cueVideo = () => {
      if (Math.abs(video.currentTime - startSeconds) > 0.18) {
        video.currentTime = startSeconds;
      }

      if (input.autoplay) {
        void video.play().catch(() => undefined);
      }
    };

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      cueVideo();
    } else {
      video.addEventListener("loadedmetadata", cueVideo, { once: true });
    }

    return () => video.removeEventListener("loadedmetadata", cueVideo);
  }, [input.autoplay, input.source, startSeconds]);

  function stopAtCueEnd() {
    const video = videoRef.current;

    if (
      video !== null &&
      endSeconds !== null &&
      video.currentTime >= endSeconds
    ) {
      video.pause();
      video.currentTime = endSeconds;
    }
  }

  return (
    <section
      aria-label="Image de référence"
      className={["dubbing-media-stage", input.className]
        .filter(Boolean)
        .join(" ")}
      data-media-kind={input.source.kind}
    >
      <div className="dubbing-media-frame">
        {input.source.kind === "local-video" ? (
          <video
            autoPlay={input.autoplay}
            controls
            muted={input.muted}
            onTimeUpdate={stopAtCueEnd}
            playsInline
            preload="metadata"
            ref={videoRef}
            src={input.source.url}
          />
        ) : (
          <iframe
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            loading={input.autoplay ? "eager" : "lazy"}
            referrerPolicy="strict-origin-when-cross-origin"
            src={embedUrl ?? undefined}
            title="Vidéo YouTube de référence"
          />
        )}
      </div>
      <div className="local-corpus-footer dubbing-media-caption">
        <span>
          <Clapperboard aria-hidden="true" size={16} />
          {input.source.name}
        </span>
        <span>
          <Clock3 aria-hidden="true" size={15} />
          {formatMediaTime(startSeconds)}
          {endSeconds === null ? "" : ` → ${formatMediaTime(endSeconds)}`}
        </span>
      </div>
    </section>
  );
}
