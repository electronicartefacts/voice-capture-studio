import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCompatibilityScore,
  describeAudioInputs,
  type RuntimeCheck,
} from "../src/app/system/runtimeDiagnostics";

test("audio input diagnostics distinguish deferred discovery, no device, and device count", () => {
  assert.equal(
    describeAudioInputs(null),
    "Le navigateur ne peut pas encore lister les entrées audio.",
  );
  assert.equal(describeAudioInputs(0), "Aucune entrée audio détectée.");
  assert.equal(describeAudioInputs(1), "1 entrée audio détectée.");
  assert.equal(describeAudioInputs(3), "3 entrées audio détectées.");
});

function check(
  id: RuntimeCheck["id"],
  status: RuntimeCheck["status"],
): RuntimeCheck {
  return { id, label: id, status, detail: "", action: "" };
}

test("compatibility score favors a complete capture and durable export path", () => {
  const score = calculateCompatibilityScore([
    check("secure-context", "ready"),
    check("microphone", "ready"),
    check("input-devices", "ready"),
    check("audio-engine", "ready"),
    check("workspace-storage", "ready"),
    check("recording-storage", "ready"),
    check("folder-export", "ready"),
    check("downloads", "ready"),
    check("screen-lock", "ready"),
    check("speech-recognition", "ready"),
    check("speech-synthesis", "ready"),
    check("background-processing", "ready"),
    check("hardware-rendering", "ready"),
  ]);

  assert.deepEqual(score, { value: 100, label: "optimal" });
});

test("compatibility score reports a blocked capture path even with extras", () => {
  const score = calculateCompatibilityScore([
    check("secure-context", "ready"),
    check("microphone", "blocked"),
    check("audio-engine", "ready"),
    check("downloads", "ready"),
    check("hardware-rendering", "ready"),
  ]);

  assert.equal(score.label, "blocked");
  assert.ok(score.value < 50);
});
