import assert from "node:assert/strict";
import test from "node:test";
import {
  createYouTubeDubbingSource,
  createYouTubeEmbedUrl,
  formatMediaTime,
  parseYouTubeVideoId,
} from "../src/app/shell/dubbingMedia";

test("YouTube links normalize into privacy-enhanced dubbing embeds", () => {
  const id = "dQw4w9WgXcQ";

  assert.equal(parseYouTubeVideoId(`https://youtu.be/${id}?t=42`), id);
  assert.equal(
    parseYouTubeVideoId(`https://www.youtube.com/watch?v=${id}`),
    id,
  );
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(parseYouTubeVideoId("https://example.com/video"), null);
  assert.equal(parseYouTubeVideoId(id), id);
  assert.equal(parseYouTubeVideoId(`https://m.youtube.com/embed/${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://music.youtube.com/live/${id}`), id);
  assert.equal(
    parseYouTubeVideoId(`https://www.youtube-nocookie.com/embed/${id}`),
    id,
  );
  assert.equal(parseYouTubeVideoId("pas une url"), null);
  assert.equal(parseYouTubeVideoId("https://youtube.com/watch"), null);
  assert.equal(parseYouTubeVideoId("https://youtu.be/trop-court"), null);
  assert.equal(createYouTubeDubbingSource("https://example.com/video"), null);

  const source = createYouTubeDubbingSource(`https://youtu.be/${id}`);

  assert.ok(source?.kind === "youtube");
  const embedUrl = new URL(
    createYouTubeEmbedUrl({
      autoplay: true,
      endSeconds: 49.8,
      muted: true,
      source,
      startSeconds: 42.4,
    }),
  );

  assert.equal(embedUrl.hostname, "www.youtube-nocookie.com");
  assert.equal(embedUrl.pathname, `/embed/${id}`);
  assert.equal(embedUrl.searchParams.get("autoplay"), "1");
  assert.equal(embedUrl.searchParams.get("mute"), "1");
  assert.equal(embedUrl.searchParams.get("start"), "42");
  assert.equal(embedUrl.searchParams.get("end"), "49");

  const manualEmbedUrl = new URL(
    createYouTubeEmbedUrl({
      autoplay: false,
      endSeconds: 4,
      muted: false,
      source,
      startSeconds: 8,
    }),
  );

  assert.equal(manualEmbedUrl.searchParams.get("autoplay"), "0");
  assert.equal(manualEmbedUrl.searchParams.get("mute"), "0");
  assert.equal(manualEmbedUrl.searchParams.has("start"), true);
  assert.equal(manualEmbedUrl.searchParams.has("end"), false);
});

test("media time labels stay compact for studio cueing", () => {
  assert.equal(formatMediaTime(0), "0:00");
  assert.equal(formatMediaTime(65), "1:05");
  assert.equal(formatMediaTime(3_725), "1:02:05");
});
