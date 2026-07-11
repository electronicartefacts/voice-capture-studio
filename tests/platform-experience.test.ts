import assert from "node:assert/strict";
import test from "node:test";
import {
  getViewportEdgePull,
  getVisibleViewportHeight,
  isStandaloneDisplayMode,
} from "../src/app/system/platformExperience";

test("edge pull only responds beyond the matching viewport boundary", () => {
  assert.deepEqual(
    getViewportEdgePull({
      scrollTop: 0,
      scrollHeight: 1800,
      viewportHeight: 800,
      touchStartY: 120,
      touchY: 168,
    }),
    { top: 0.5, bottom: 0 },
  );
  assert.deepEqual(
    getViewportEdgePull({
      scrollTop: 1000,
      scrollHeight: 1800,
      viewportHeight: 800,
      touchStartY: 168,
      touchY: 72,
    }),
    { top: 0, bottom: 1 },
  );
  assert.deepEqual(
    getViewportEdgePull({
      scrollTop: 400,
      scrollHeight: 1800,
      viewportHeight: 800,
      touchStartY: 120,
      touchY: 180,
    }),
    { top: 0, bottom: 0 },
  );
});

test("visible viewport uses VisualViewport for browser chrome and keyboard changes", () => {
  assert.equal(
    getVisibleViewportHeight({
      layoutViewportHeight: 844,
      visualViewportHeight: 512.4,
    }),
    512,
  );
  assert.equal(getVisibleViewportHeight({ layoutViewportHeight: 844 }), 844);
});

test("visible viewport never returns an unusable CSS height", () => {
  assert.equal(
    getVisibleViewportHeight({
      layoutViewportHeight: 0,
      visualViewportHeight: Number.NaN,
    }),
    1,
  );
});

test("standalone mode includes the iOS navigator signal", () => {
  assert.equal(
    isStandaloneDisplayMode({
      displayModeMatches: false,
      navigatorStandalone: true,
    }),
    true,
  );
  assert.equal(isStandaloneDisplayMode({ displayModeMatches: false }), false);
});
