import assert from "node:assert/strict";
import test from "node:test";
import { getAmbientRenderingBudget } from "../src/app/system/renderingBudget";

test("ambient rendering preserves the decor but yields freshness to a visible page scroll", () => {
  assert.equal(
    getAmbientRenderingBudget({
      isCapturing: false,
      isPageVisible: true,
      isScrolling: true,
    }),
    "constrained",
  );
});

test("capture feedback stays available while the capture screen is active", () => {
  assert.equal(
    getAmbientRenderingBudget({
      isCapturing: true,
      isPageVisible: true,
      isScrolling: true,
    }),
    "full",
  );
});

test("hidden pages always suspend ambient rendering", () => {
  assert.equal(
    getAmbientRenderingBudget({
      isCapturing: true,
      isPageVisible: false,
      isScrolling: false,
    }),
    "paused",
  );
});
