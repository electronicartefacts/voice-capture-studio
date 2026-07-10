import assert from "node:assert/strict";
import test from "node:test";
import { getAmbientRenderingBudget } from "../src/app/system/renderingBudget";

test("ambient rendering pauses decorative work during a visible page scroll", () => {
  assert.equal(
    getAmbientRenderingBudget({
      isCapturing: false,
      isPageVisible: true,
      isScrolling: true,
      isDeviceConstrained: false,
    }),
    "paused",
  );
});

test("capture feedback stays available while the capture screen is active", () => {
  assert.equal(
    getAmbientRenderingBudget({
      isCapturing: true,
      isPageVisible: true,
      isScrolling: true,
      isDeviceConstrained: false,
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
      isDeviceConstrained: false,
    }),
    "paused",
  );
});

test("sustained device strain lowers idle fidelity instead of stalling", () => {
  assert.equal(
    getAmbientRenderingBudget({
      isCapturing: false,
      isPageVisible: true,
      isScrolling: false,
      isDeviceConstrained: true,
    }),
    "constrained",
  );
});

test("capture feedback ignores measured device strain, the invariant curve never degrades", () => {
  assert.equal(
    getAmbientRenderingBudget({
      isCapturing: true,
      isPageVisible: true,
      isScrolling: false,
      isDeviceConstrained: true,
    }),
    "full",
  );
});

test("scroll suppression takes precedence over the constrained tier while idle", () => {
  assert.equal(
    getAmbientRenderingBudget({
      isCapturing: false,
      isPageVisible: true,
      isScrolling: true,
      isDeviceConstrained: true,
    }),
    "paused",
  );
});
