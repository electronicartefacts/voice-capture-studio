import assert from "node:assert/strict";
import test from "node:test";
import { createFramePaceMonitor } from "../src/app/system/framePaceMonitor";

function feedFrames(
  monitor: ReturnType<typeof createFramePaceMonitor>,
  input: { readonly count: number; readonly intervalMs: number; start: number },
): { readonly last: boolean; readonly now: number } {
  let now = input.start;
  let last = false;

  for (let index = 0; index < input.count; index += 1) {
    now += input.intervalMs;
    last = monitor.recordFrame(now);
  }

  return { last, now };
}

test("stays unconstrained under sustained 60fps pacing", () => {
  const monitor = createFramePaceMonitor();
  const { last } = feedFrames(monitor, {
    count: 60,
    intervalMs: 1000 / 60,
    start: 0,
  });

  assert.equal(last, false);
});

test("flags sustained sub-36fps pacing as constrained", () => {
  const monitor = createFramePaceMonitor();
  const { last } = feedFrames(monitor, {
    count: 60,
    intervalMs: 1000 / 24,
    start: 0,
  });

  assert.equal(last, true);
});

test("recovers once pacing sustains above the exit threshold", () => {
  const monitor = createFramePaceMonitor();
  const strained = feedFrames(monitor, {
    count: 60,
    intervalMs: 1000 / 24,
    start: 0,
  });

  assert.equal(strained.last, true);

  const recovered = feedFrames(monitor, {
    count: 120,
    intervalMs: 1000 / 60,
    start: strained.now,
  });

  assert.equal(recovered.last, false);
});

test("a large gap from a backgrounded tab is ignored rather than read as strain", () => {
  const monitor = createFramePaceMonitor();

  feedFrames(monitor, { count: 30, intervalMs: 1000 / 60, start: 0 });

  const afterGap = monitor.recordFrame(30_000);

  assert.equal(afterGap, false);
});
