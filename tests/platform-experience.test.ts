import assert from "node:assert/strict";
import test from "node:test";
import {
  getVisibleViewportHeight,
  isStandaloneDisplayMode,
} from "../src/app/system/platformExperience";

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
