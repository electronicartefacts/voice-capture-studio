import type { DubbingMediaSource } from "./types";

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;

export function createYouTubeDubbingSource(
  input: string,
): DubbingMediaSource | null {
  const videoId = parseYouTubeVideoId(input);

  if (videoId === null) {
    return null;
  }

  return {
    kind: "youtube",
    name: "Vidéo YouTube",
    url: input.trim(),
    videoId,
  };
}

export function parseYouTubeVideoId(input: string): string | null {
  const candidate = input.trim();

  if (YOUTUBE_ID_PATTERN.test(candidate)) {
    return candidate;
  }

  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
  let videoId: string | null = null;

  if (hostname === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (
    hostname === "youtube.com" ||
    hostname === "m.youtube.com" ||
    hostname === "music.youtube.com" ||
    hostname === "youtube-nocookie.com"
  ) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else {
      const [route, id] = url.pathname.split("/").filter(Boolean);

      if (["embed", "shorts", "live"].includes(route ?? "")) {
        videoId = id ?? null;
      }
    }
  }

  return videoId !== null && YOUTUBE_ID_PATTERN.test(videoId) ? videoId : null;
}

export function createYouTubeEmbedUrl(input: {
  readonly autoplay: boolean;
  readonly endSeconds?: number | null;
  readonly muted: boolean;
  readonly source: Extract<DubbingMediaSource, { readonly kind: "youtube" }>;
  readonly startSeconds?: number;
}): string {
  const parameters = new URLSearchParams({
    autoplay: input.autoplay ? "1" : "0",
    controls: "1",
    mute: input.muted ? "1" : "0",
    playsinline: "1",
    rel: "0",
  });
  const startSeconds = Math.max(0, Math.floor(input.startSeconds ?? 0));
  const endSeconds = Math.floor(input.endSeconds ?? 0);

  if (startSeconds > 0) {
    parameters.set("start", String(startSeconds));
  }

  if (endSeconds > startSeconds) {
    parameters.set("end", String(endSeconds));
  }

  return `https://www.youtube-nocookie.com/embed/${input.source.videoId}?${parameters.toString()}`;
}

export function formatMediaTime(seconds: number): string {
  const boundedSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(boundedSeconds / 3600);
  const minutes = Math.floor((boundedSeconds % 3600) / 60);
  const remainingSeconds = boundedSeconds % 60;
  const minuteLabel = hours > 0 ? String(minutes).padStart(2, "0") : minutes;

  return [
    ...(hours > 0 ? [String(hours)] : []),
    String(minuteLabel),
    String(remainingSeconds).padStart(2, "0"),
  ].join(":");
}
