import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceLoadingWaveMotion,
  beginLoadingWave,
  cancelLoadingWave,
  finishLoadingWave,
  getLoadingWaveSnapshot,
  mapLocalAnalysisToLoadingProgress,
  resetLoadingWaveForTests,
  runWithLoadingWave,
  updateLoadingWave,
} from "../src/app/rendering/loadingWaveSignal";

test.afterEach(resetLoadingWaveForTests);

test("determinate loading advances monotonically and lingers at completion", () => {
  beginLoadingWave("models", "Modèles", 0.1);
  const started = getLoadingWaveSnapshot();
  updateLoadingWave("models", 0.65);
  updateLoadingWave("models", 0.3);
  const advanced = getLoadingWaveSnapshot();
  finishLoadingWave("models");
  const completed = getLoadingWaveSnapshot();

  assert.equal(started.active, true);
  assert.equal(advanced.progress, 0.65);
  assert.equal(completed.progress, 1);
  assert.ok(completed.opacity > 0);
});

test("async loading helpers complete on success and disappear on failure", async () => {
  await runWithLoadingWave("save", "Sauvegarde", async () => "ok");
  assert.equal(getLoadingWaveSnapshot().progress, 1);

  await assert.rejects(() =>
    runWithLoadingWave("restore", "Restauration", async () => {
      throw new Error("broken");
    }),
  );
  assert.notEqual(getLoadingWaveSnapshot().label, "Restauration");
});

test("local model stages map onto the complete left-to-right journey", () => {
  assert.ok(
    Math.abs(
      mapLocalAnalysisToLoadingProgress({
        stage: "loading-model",
        progressPercent: 50,
      }) - 0.21,
    ) < Number.EPSILON,
  );
  assert.equal(
    mapLocalAnalysisToLoadingProgress({ stage: "transcribing" }),
    0.52,
  );
  assert.equal(
    mapLocalAnalysisToLoadingProgress({ stage: "validating-result" }),
    0.94,
  );
});

test("indeterminate loading moves without pretending to reach completion", () => {
  beginLoadingWave("export", "Export");
  const started = getLoadingWaveSnapshot();
  const later = getLoadingWaveSnapshot(30_000);

  assert.ok(started.progress >= 0.035);
  assert.ok(later.progress > started.progress);
  assert.ok(later.progress <= 0.9);
});

test("the most recently updated operation drives the single background wave", () => {
  beginLoadingWave("first", "Premier", 0.2);
  beginLoadingWave("second", "Second", 0.4);
  updateLoadingWave("first", 0.7);

  assert.equal(getLoadingWaveSnapshot().label, "Premier");
  cancelLoadingWave("first");
  assert.equal(getLoadingWaveSnapshot().label, "Second");
});

test("visual loading motion glides toward milestones without stepping", () => {
  let motion = { progress: 0, velocity: 0 };

  motion = advanceLoadingWaveMotion({
    ...motion,
    target: 0.65,
    deltaMs: 16,
    complete: false,
  });

  assert.ok(motion.progress > 0);
  assert.ok(motion.progress < 0.01);

  let previous = motion.progress;
  for (let frame = 0; frame < 120; frame += 1) {
    motion = advanceLoadingWaveMotion({
      ...motion,
      target: 0.65,
      deltaMs: 16,
      complete: false,
    });
    assert.ok(motion.progress >= previous);
    assert.ok(motion.progress <= 0.65);
    previous = motion.progress;
  }
});

test("completion accelerates smoothly until the curve reaches 100 percent", () => {
  let motion = { progress: 0.42, velocity: 0.12 };

  for (let frame = 0; frame < 180; frame += 1) {
    motion = advanceLoadingWaveMotion({
      ...motion,
      target: 1,
      deltaMs: 16,
      complete: true,
    });
  }

  assert.ok(motion.progress > 0.999);
  assert.ok(motion.progress <= 1);
});
