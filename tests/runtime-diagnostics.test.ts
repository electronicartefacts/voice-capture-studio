import assert from "node:assert/strict";
import test from "node:test";
import { describeAudioInputs } from "../src/app/system/runtimeDiagnostics";

test("audio input diagnostics distinguish deferred discovery, no device, and device count", () => {
  assert.equal(
    describeAudioInputs(null),
    "Le navigateur ne peut pas encore lister les entrées audio.",
  );
  assert.equal(describeAudioInputs(0), "Aucune entrée audio détectée.");
  assert.equal(describeAudioInputs(1), "1 entrée audio détectée.");
  assert.equal(describeAudioInputs(3), "3 entrées audio détectées.");
});
