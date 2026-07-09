import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecordingFileName,
  createTakeId,
} from "../src/app/audio/recordingFileName";
import type { SessionId } from "../src/domains/sessions";

test("recording file names are unique per take inside the same session", () => {
  const sessionId = "session.2026-07-09T08:01:00.000Z" as SessionId;
  const firstTakeId = createTakeId(new Date("2026-07-09T08:01:30.000Z"));
  const secondTakeId = createTakeId(new Date("2026-07-09T08:02:30.000Z"));
  const firstFileName = createRecordingFileName({
    extension: "wav",
    sessionId,
    takeId: firstTakeId,
  });
  const secondFileName = createRecordingFileName({
    extension: "wav",
    sessionId,
    takeId: secondTakeId,
  });

  assert.notEqual(firstFileName, secondFileName);
  assert.match(firstFileName, /^[a-zA-Z0-9._-]+\.wav$/);
  assert.match(secondFileName, /^[a-zA-Z0-9._-]+\.wav$/);
  assert.equal(firstFileName.includes(":"), false);
  assert.equal(secondFileName.includes(":"), false);
});
